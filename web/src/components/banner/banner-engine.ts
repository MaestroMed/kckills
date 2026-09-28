/**
 * Étendard KC — moteur de rendu (three.js WebGPU + TSL, repli WebGL2 auto).
 *
 * - Tissu simulé dans un worker (cloth.worker.ts) : vent physique, rafales.
 * - Drap bleu KC : sergé procédural (fils de chaîne/trame en relief), reflet
 *   de velours (sheen), marbrure légère de teinture.
 * - Broderie or (bordure satin, filet au point de tige, logo KC, losanges
 *   Hextech) : métal anisotrope orienté le long des fils, relief en dôme,
 *   fils individuels procéduraux (nets en grand, lissés sans moiré en petit).
 * - Rayons de lumière : à intervalles aléatoires, une bande de lumière
 *   balaie l'étendard (gauche puis droite, comme un projecteur qui passe) ;
 *   l'or s'embrase au passage (reflet de Kajiya-Kay le long des fils) et le
 *   bloom fait briller les éclats.
 * - Éclairage de scène : environnement « arène » généré (PMREM), clé chaude,
 *   contre-jour cyan, remplissage violet — les lumières du hero.
 * - Météo (lib/mood) : vent, rafales, lumière, cadence des rayons, éclairs et
 *   usure du drap suivent la forme de la KC. L'usure (0..1) effiloche les
 *   bords (surtout les pointes de la queue d'aronde), perce des trous aux
 *   lèvres brûlées, encrasse le bas, fait passer la teinture et ternit l'or
 *   par plaques ; tout est procédural, piloté par un seul uniforme.
 */
import * as THREE from "three/webgpu";
import {
  abs,
  attribute,
  bitangentViewFrame,
  color,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  hash,
  max,
  mix,
  mod,
  min,
  mx_noise_float,
  normalize,
  normalView,
  pass,
  positionLocal,
  positionViewDirection,
  pow,
  renderOutput,
  saturate,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  tangentViewFrame,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { WEATHER, type WeatherSettings } from "@/lib/mood/presets";
import {
  setSky,
  strikeEnvelope,
  subscribeStrike,
  subscribeSweep,
  SWEEP_MS,
  type StrikeEvent,
  type SweepEvent,
} from "@/lib/mood/sky";
import { loadLogo, paintBanner, type BannerArt } from "./banner-art";
import type { ClothSpec, WindState } from "./cloth-sim";

export const SHAPE = { width: 0.8, height: 1.9, notch: 0.15 };

export type BannerVariant = "header" | "lab";

const VARIANTS: Record<BannerVariant, { cols: number; rows: number; texW: number }> = {
  header: { cols: 16, rows: 40, texW: 512 },
  lab: { cols: 24, rows: 58, texW: 1024 },
};

export interface BannerOptions {
  side: "left" | "right";
  variant: BannerVariant;
  /** Échelle fixe (px CSS par mètre) ; sinon l'étendard remplit la hauteur du canvas. */
  pxPerMeter?: number;
  /** Marge au-dessus de la tringle, en px CSS. */
  topMarginPx?: number;
  /** Météo au montage (appliquée d'emblée, sans transition). */
  weather?: WeatherSettings;
  onReady?: () => void;
}

export interface BannerHandle {
  dispose(): void;
  setPaused(paused: boolean): void;
  setWind(speed: number): void;
  gust(strength?: number): void;
  /** Change de temps : lumière, usure et vent glissent vers les nouvelles valeurs. */
  setWeather(w: WeatherSettings): void;
}

// ─── dessin partagé (une texture par résolution, peinte une seule fois) ─────
const artCache = new Map<number, Promise<BannerArt>>();
function getArt(texW: number): Promise<BannerArt> {
  let p = artCache.get(texW);
  if (!p) {
    p = loadLogo("/images/kc-logo.png").then((logo) => paintBanner(texW, SHAPE, logo));
    artCache.set(texW, p);
  }
  return p;
}

// ─── worker de simulation partagé ───────────────────────────────────────────
type WorkerMsg =
  | { type: "ready"; id: string; count: number; uv: Float32Array; index: Uint32Array; frame: Float32Array }
  | { type: "frame"; id: string; frame: Float32Array; rod: number };
let simWorker: Worker | null = null;
const simListeners = new Map<string, (m: WorkerMsg) => void>();
function getWorker(): Worker {
  if (!simWorker) {
    simWorker = new Worker(new URL("./cloth.worker.ts", import.meta.url), { type: "module" });
    simWorker.onmessage = (e: MessageEvent<WorkerMsg>) => simListeners.get(e.data.id)?.(e.data);
  }
  return simWorker;
}

// ─── environnement « arène » pour les reflets de l'or ────────────────────────
export function buildStageEnvironment(renderer: THREE.WebGPURenderer): THREE.Texture {
  const env = new THREE.Scene();
  const domeMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  const dirY = normalize(positionLocal).y;
  domeMat.colorNode = mix(color(0x020308), color(0x0c1238), smoothstep(-0.3, 0.9, dirY));
  env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), domeMat));
  const panel = (w: number, h: number, c: number, intensity: number, pos: [number, number, number]) => {
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    m.colorNode = color(c).mul(intensity);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.position.set(...pos);
    mesh.lookAt(0, 0, 0);
    env.add(mesh);
  };
  panel(6, 1.6, 0xffdcaa, 9, [0, 6, 4]); // softbox chaud au-dessus, devant
  panel(1.2, 5, 0xc4e4ff, 3.5, [7, 1, -1]); // bande froide à droite (peu saturée : l’or reflété ne vire pas au vert)
  panel(1.4, 5, 0x8a3dff, 3.5, [-7, 1.5, 1]); // lavis violet à gauche
  panel(3, 0.35, 0xffffff, 14, [-2, 5, 6]); // barres de projecteurs (éclats)
  panel(3, 0.35, 0xffffff, 12, [3, 4.5, 5.5]);
  panel(8, 2, 0x0b1a4a, 1.2, [0, -5, 3]); // sol bleuté
  // grand réflecteur chaud face à l'étendard : l'or garde sa chaleur au repos
  // sans éclairer le drap (un diélectrique mat reflète peu l'environnement)
  panel(5, 3, 0xffc978, 4.5, [0.5, 1.2, 7]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  return rt.texture;
}

export async function mountBanner(canvas: HTMLCanvasElement, opts: BannerOptions): Promise<BannerHandle> {
  const variant = VARIANTS[opts.variant];
  const [art] = await Promise.all([getArt(variant.texW)]);

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
  await renderer.init();
  const backendName = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "webgpu" : "webgl2";
  console.info(`[KCBanner] ${opts.variant}/${opts.side} → ${backendName}`);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setClearColor(0x000000, 0);

  // ── météo : état courant (glisse vers la cible à chaque image) ──
  const w0 = opts.weather ?? WEATHER.variable;
  const target = {
    key: new THREE.Color(w0.keyColor),
    keyI: w0.keyIntensity,
    exposure: w0.exposure,
    env: w0.envIntensity,
    wear: w0.wear,
  };
  const cur = { ...target, key: target.key.clone() };
  setSky(w0);

  renderer.toneMappingExposure = cur.exposure;

  const scene = new THREE.Scene();
  scene.environment = buildStageEnvironment(renderer);
  scene.environmentIntensity = cur.env;

  const key = new THREE.DirectionalLight(cur.key, cur.keyI);
  key.position.set(-1.3, 1.2, 2.4);
  const rim = new THREE.DirectionalLight(0xd6ecff, 1.0); // contre-jour froid mais peu saturé : l’or ne vire pas au vert
  rim.position.set(1.8, 0.2, -1.6);
  const fill = new THREE.DirectionalLight(0x8f5cff, 0.55);
  fill.position.set(-2.2, -1, 1);
  // éclair : lumière froide, éteinte hors des frappes
  const flashLight = new THREE.DirectionalLight(0xdfe9ff, 0);
  flashLight.position.set(0.8, 2.4, 1.6);
  scene.add(key, rim, fill, flashLight);

  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 50);

  // ── texture du dessin ──
  // Le dessin est peint haut en premier ; en mémoire, la ligne 0 d'une
  // texture est v = 0 (le bas). On retourne les lignes ici (flipY n'est pas
  // appliqué aux DataTexture par le backend WebGPU).
  const flipped = new Uint8Array(art.data.length);
  const rowBytes = art.width * 4;
  for (let y = 0; y < art.height; y++) {
    flipped.set(art.data.subarray(y * rowBytes, (y + 1) * rowBytes), (art.height - 1 - y) * rowBytes);
  }
  const tex = new THREE.DataTexture(flipped, art.width, art.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;

  // ── uniformes du passage de lumière ──
  const uSweepC = uniform(-10);
  const uSweepDir = uniform(new THREE.Vector2(0.82, -0.57));
  const uSweepOn = uniform(0);
  const uRayDir = uniform(new THREE.Vector3(-0.45, 0.55, 0.7).normalize());
  const uWear = uniform(cur.wear);
  const uTime = uniform(0);

  // ── matériau du drap brodé ──
  const clothMat = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  clothMat.alphaToCoverage = true;
  clothMat.alphaTest = 0.5;
  {
    const UV = uv();
    const s0 = texture(tex, UV);
    const P = UV.mul(vec2(SHAPE.width, SHAPE.height)); // coordonnées physiques (m), y depuis le bas
    const wear = uWear;
    // Usure : la broderie s'élime par plaques (fils d'or arrachés, le drap
    // réapparaît), sans jamais effacer le logo.
    const lossN = mx_noise_float(vec3(P.mul(8), 3.3)).mul(0.5).add(0.5);
    const goldKeep = float(1).sub(wear.mul(0.55).mul(smoothstep(0.42, 0.78, lossN)));
    const gold = s0.r.mul(goldKeep);
    const theta = s0.g.mul(Math.PI);

    // Sergé du drap : fils de chaîne et de trame alternés.
    const weaveD = float(170);
    const w = P.mul(weaveD);
    const cell = floor(w);
    const f = fract(w).sub(0.5);
    const onWarp = mod(cell.x.add(cell.y), 2).lessThan(0.5);
    const profU = sqrt(saturate(float(1).sub(f.x.mul(2).pow2())));
    const profV = sqrt(saturate(float(1).sub(f.y.mul(2).pow2())));
    const aaW = float(1).sub(smoothstep(0.18, 0.42, max(fwidth(w.x), fwidth(w.y))));
    const weaveGrad = select(
      onWarp,
      vec2(f.x.mul(-4).div(profU.max(0.3)), 0),
      vec2(0, f.y.mul(-4).div(profV.max(0.3))),
    ).mul(aaW.mul(0.16));
    const weaveH = select(onWarp, profU, profV);

    // Fils de la broderie : satin orienté par le dessin.
    const dir = vec2(cos(theta), sin(theta));
    const perp = vec2(sin(theta).negate(), cos(theta));
    const threadD = float(250);
    const p = dot(P, perp).mul(threadD);
    const ft = fract(p).sub(0.5);
    const prof = sqrt(saturate(float(1).sub(ft.mul(2).pow2())));
    const aaT = float(1).sub(smoothstep(0.3, 0.8, fwidth(p)));
    // Variation par fil, ramenée à 0,5 quand les fils sont sous le pixel
    // (sinon elle crée des stries parasites en petit).
    const tvar = mix(float(0.5), hash(floor(p).add(theta.mul(97.0))), aaT);
    const profAA = mix(float(0.75), prof, aaT);
    const threadGrad = perp.mul(ft.mul(-4).div(prof.max(0.3)).mul(aaT.mul(0.42)));

    // Relief en dôme de la broderie (différences finies sur le dessin).
    const ex = vec2(1 / art.width, 0);
    const ey = vec2(0, 1 / art.height);
    const hR = texture(tex, UV.add(ex)).b;
    const hL = texture(tex, UV.sub(ex)).b;
    const hU = texture(tex, UV.add(ey)).b;
    const hD = texture(tex, UV.sub(ey)).b;
    const reliefAmp = 0.0055;
    const reliefGrad = vec2(
      hR.sub(hL).div((2 / art.width) * SHAPE.width),
      hU.sub(hD).div((2 / art.height) * SHAPE.height),
    )
      .mul(reliefAmp)
      .mul(goldKeep); // broderie élimée = plus plate

    const grad = reliefGrad.add(weaveGrad.mul(float(1).sub(gold))).add(threadGrad.mul(gold));
    // Repères tangents dérivés des UV (pas d'attribut tangent : le tissu se
    // déforme à chaque image). Les types r186 les déclarent en Node générique.
    const T = normalize(tangentViewFrame as unknown as ReturnType<typeof vec3>);
    const B = normalize(bitangentViewFrame as unknown as ReturnType<typeof vec3>);
    const Np = normalize(normalView.sub(T.mul(grad.x)).sub(B.mul(grad.y)));
    clothMat.normalNode = Np;

    // Damas : treillis de losanges Hextech tissé ton sur ton (satin brillant
    // sur fond mat). Grande échelle, donc lisible en petit comme en grand, sans
    // le moiré d'un tissage fin.
    // Maille en losange allongé (arlequin) : les axes de q sont les diagonales
    // des losanges, les lignes entières de q forment le treillis.
    const q = vec2(P.x.div(0.2).add(P.y.div(0.3)), P.x.div(0.2).sub(P.y.div(0.3)));
    const qf = fract(q).sub(0.5);
    const edge = min(float(0.5).sub(abs(qf.x)), float(0.5).sub(abs(qf.y))); // distance au treillis
    const aaQ = fwidth(q.x).add(fwidth(q.y)).max(1e-4);
    const lattice = float(1).sub(smoothstep(float(0.012), float(0.012).add(aaQ), edge));
    // petit losange concentrique au centre de chaque maille
    const centre = max(abs(qf.x), abs(qf.y));
    const pip = float(1).sub(smoothstep(float(0.075), float(0.075).add(aaQ), centre));
    const damask = max(lattice, pip).mul(float(1).sub(gold));

    // Occlusion des plis, calculée par la simulation (attribut ao).
    const ao = attribute("ao", "float");
    const fold = mix(float(0.5), float(1), ao);

    // Teintes : bleu KC profond marbré, or « fil de soie » qui varie d'un fil à l'autre.
    const mottle = mx_noise_float(vec3(P.mul(2.4), 0.37)).mul(0.5).add(0.5);
    const fabric = mix(color(0x041652), color(0x0a37b8), mottle.mul(0.55).add(0.4))
      .mul(mix(float(1), select(onWarp, float(1.08), float(0.9)), aaW))
      .mul(weaveH.mul(0.12).add(0.9))
      .mul(damask.mul(0.14).add(1));
    const goldCol = mix(color(0x9a6b22), color(0xefcd82), tvar.mul(0.45).add(profAA.mul(0.55)));

    // ── usure ──
    // Distance au bord libre (m), analytique : côtés, et les deux lèvres de
    // l'encoche (demi-plans ; minorant exact près des bords). Le bord cousu
    // sur la tringle ne s'effiloche pas.
    const Wm = SHAPE.width;
    const Hm = SHAPE.height;
    const nH = SHAPE.notch * SHAPE.height;
    const Ln = Math.hypot(Wm / 2, nH);
    const lipL = P.x.mul(-nH / Ln).add(P.y.mul(Wm / 2 / Ln));
    const lipR = P.x.sub(Wm).mul(nH / Ln).add(P.y.mul(Wm / 2 / Ln));
    const edgeDist = min(min(P.x, float(Wm).sub(P.x)), max(max(lipL, lipR), P.y.negate()));
    // Morsure du bord : déchirures franches (bruit large) et effilochure fine,
    // plus profondes aux pointes, qui fouettent au vent.
    const rag = mx_noise_float(vec3(P.mul(7), 1.7))
      .mul(0.65)
      .add(mx_noise_float(vec3(P.mul(31), 4.3)).mul(0.35))
      .mul(0.5)
      .add(0.5);
    const tips = float(1).add(float(1).sub(smoothstep(0, 0.55, P.y)).mul(1.5));
    const topFade = smoothstep(0.02, 0.22, float(Hm).sub(P.y));
    const bite = wear.mul(wear.sqrt()).mul(0.09).mul(rag.mul(1.3).add(0.05)).mul(tips).mul(topFade);
    const aaE = fwidth(edgeDist).max(1e-5);
    const frayAlpha = smoothstep(bite.sub(aaE), bite.add(aaE), edgeDist.add(aaE));
    // Trous : n'apparaissent qu'au-delà d'une usure de 0,35 ; la broderie et
    // le haut de l'étendard résistent mieux.
    const holeN = mx_noise_float(vec3(P.mul(4.6), 9.1))
      .mul(0.75)
      .add(mx_noise_float(vec3(P.mul(18), 2.3)).mul(0.25));
    const holeOn = smoothstep(0.35, 1, wear);
    const holeThr = mix(float(1), float(0.5), holeOn).add(s0.r.mul(0.35)).add(float(1).sub(topFade).mul(0.5));
    const aaH = fwidth(holeN).max(1e-5);
    const holeAlpha = float(1).sub(smoothstep(holeThr.sub(aaH), holeThr.add(aaH), holeN));
    // Lèvres brûlées autour des trous et des déchirures.
    const scorch = max(
      smoothstep(holeThr.sub(0.14), holeThr, holeN).mul(holeOn),
      float(1)
        .sub(smoothstep(bite, bite.add(wear.mul(0.02)).add(1e-4), edgeDist))
        .mul(smoothstep(0.25, 0.8, wear)),
    );
    // Crasse (remontée du sol : davantage en bas) et teinture passée.
    const dirtN = mx_noise_float(vec3(P.mul(3.2), 5.5)).mul(0.5).add(0.5);
    const dirt = smoothstep(0.3, 0.8, dirtN)
      .mul(float(1).sub(smoothstep(0, 0.9, P.y)).mul(0.7).add(0.3))
      .mul(wear);
    const faded = mix(
      fabric,
      vec3(dot(fabric, vec3(0.3, 0.59, 0.11))).mul(vec3(0.8, 0.88, 1.1)).add(fabric.mul(0.25)),
      wear.mul(0.4),
    );
    const fabricWorn = mix(faded, faded.mul(vec3(0.52, 0.46, 0.4)), dirt.mul(0.7));
    const goldWorn = mix(goldCol, goldCol.mul(vec3(0.6, 0.5, 0.38)), wear.mul(0.55).mul(lossN.mul(0.6).add(0.4)));

    clothMat.colorNode = mix(mix(fabricWorn, goldWorn, gold), color(0x100904), scorch.mul(0.85)).mul(fold);
    clothMat.aoNode = ao;
    clothMat.metalnessNode = gold.mul(0.96).mul(float(1).sub(scorch));
    clothMat.roughnessNode = mix(
      mix(mix(float(0.9), float(0.5), damask), float(0.24).add(tvar.mul(0.1)).add(wear.mul(0.22)), gold),
      float(0.95),
      scorch,
    );
    clothMat.sheenNode = mix(color(0x3d6cff).mul(mix(float(0.32), float(0.7), damask)), vec3(0), gold)
      .mul(fold)
      .mul(float(1).sub(scorch))
      .mul(float(1).sub(dirt.mul(0.5)));
    clothMat.sheenRoughnessNode = float(0.36);
    clothMat.anisotropyNode = dir.mul(gold.mul(0.85));
    clothMat.opacityNode = s0.a.mul(frayAlpha).mul(holeAlpha);

    // Passage de lumière : bande + halo, l'or s'embrase le long des fils.
    const d = dot(positionLocal.xy, uSweepDir).sub(uSweepC);
    const ray = exp(d.mul(d).mul(-1 / (2 * 0.085 * 0.085)))
      .add(exp(d.mul(d).mul(-1 / (2 * 0.3 * 0.3))).mul(0.1))
      .mul(uSweepOn);
    const V = positionViewDirection;
    const Hh = normalize(V.add(uRayDir));
    const Tt = normalize(T.mul(dir.x).add(B.mul(dir.y)));
    const tdh = dot(Tt, Hh);
    const kajiya = pow(saturate(float(1).sub(tdh.mul(tdh))), 42);
    const spec = pow(saturate(dot(Np, Hh)), 36);
    const glint = kajiya.mul(tvar.mul(0.6).add(0.4)).add(spec.mul(0.5));
    const fres = pow(saturate(float(1).sub(dot(Np, V))), 2);
    const goldHot = color(0xffd48a).mul(gold).mul(glint.mul(2.6).add(0.22));
    // le drap ne s'éclaire qu'en rasant et sur le satin du damas : le bleu
    // reste profond, c'est l'or et le motif tissé qui accrochent le rayon
    const blueGlow = color(0x3f6dff)
      .mul(float(1).sub(gold))
      .mul(fres.mul(0.45).add(0.05).add(damask.mul(0.3)));
    // Braises au bord des trous, seulement quand l'étendard est en lambeaux.
    const emberRim = smoothstep(holeThr.sub(0.03), holeThr.sub(0.004), holeN).mul(smoothstep(0.6, 0.95, wear));
    const flicker = mx_noise_float(vec3(P.mul(22), uTime.mul(1.7))).mul(0.5).add(0.5);
    const embers = color(0xff5a1e).mul(emberRim).mul(flicker.mul(1.6).add(0.2)).mul(1.4);
    clothMat.emissiveNode = goldHot.add(blueGlow).mul(ray).add(embers);
  }

  // ── tringle en or brossé, avec pommeaux ──
  const rodMat = new THREE.MeshPhysicalNodeMaterial({ color: 0xe7c47c, metalness: 1, roughness: 0.22 });
  rodMat.anisotropyNode = vec2(0, 0.7);
  {
    const d = dot(positionLocal.xy, uSweepDir).sub(uSweepC);
    rodMat.emissiveNode = color(0xffe1a0).mul(exp(d.mul(d).mul(-1 / (2 * 0.1 * 0.1)))).mul(uSweepOn.mul(1.2));
  }
  // Pommeaux : or plus satiné (sinon leurs facettes reflètent les panneaux
  // colorés de l'arène comme des gemmes).
  const gemMat = new THREE.MeshPhysicalNodeMaterial({ color: 0xe0b964, metalness: 1, roughness: 0.38 });
  gemMat.emissiveNode = rodMat.emissiveNode;
  const rod = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, SHAPE.width + 0.1, 24), rodMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 0.012;
  rod.add(bar);
  for (const sx of [-1, 1]) {
    // collerette + pommeau en losange Hextech (octaèdre étiré le long de la tringle)
    const collar = new THREE.Mesh(new THREE.SphereGeometry(0.024, 24, 16), rodMat);
    collar.position.set(sx * (SHAPE.width / 2 + 0.055), 0.012, 0);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.034, 0), gemMat);
    gem.scale.set(1.9, 1, 1);
    gem.position.set(sx * (SHAPE.width / 2 + 0.12), 0.012, 0);
    rod.add(collar, gem);
  }
  scene.add(rod);

  // ── géométrie du tissu, alimentée par le worker ──
  const worker = getWorker();
  const id = `${opts.side}-${opts.variant}-${Math.random().toString(36).slice(2, 8)}`;
  const spec: ClothSpec = { ...SHAPE, cols: variant.cols, rows: variant.rows };
  const wind: WindState = {
    // en miroir : les deux étendards du header ondulent symétriquement
    dir: [opts.side === "left" ? 0.4 : -0.4, 0, -1],
    speed: w0.wind,
    turbulence: w0.turbulence,
    offsetX: opts.side === "left" ? -6.5 : 6.5,
  };

  const ready = new Promise<{ count: number; uv: Float32Array; index: Uint32Array; frame: Float32Array }>((resolve) => {
    simListeners.set(id, (m) => {
      if (m.type === "ready") resolve(m);
    });
  });
  worker.postMessage({
    type: "init",
    id,
    spec,
    wind,
    gustAmp: w0.gustAmp,
    gustEvery: w0.gustEvery,
    seed: opts.side === "left" ? 1337 : 4242,
  });
  const init = await ready;

  const ib = new THREE.InterleavedBuffer(new Float32Array(init.frame), 7);
  ib.setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.InterleavedBufferAttribute(ib, 3, 0));
  geo.setAttribute("normal", new THREE.InterleavedBufferAttribute(ib, 3, 3));
  geo.setAttribute("ao", new THREE.InterleavedBufferAttribute(ib, 1, 6));
  geo.setAttribute("uv", new THREE.BufferAttribute(init.uv, 2));
  geo.setIndex(new THREE.BufferAttribute(init.index, 1));
  const cloth = new THREE.Mesh(geo, clothMat);
  cloth.frustumCulled = false;
  scene.add(cloth);

  let pending: Float32Array | null = null;
  let rodAngle = 0;
  simListeners.set(id, (m) => {
    if (m.type === "frame") {
      pending = m.frame;
      rodAngle = m.rod;
    }
  });

  // ── cadrage ──
  const frame = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    const ppm = opts.pxPerMeter ?? h / (SHAPE.height + 0.55);
    const visH = h / ppm;
    const dist = visH / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const top = (opts.topMarginPx ?? 14) / ppm;
    const cy = -visH / 2 + top;
    camera.aspect = w / h;
    camera.position.set(0, cy, dist);
    camera.lookAt(0, cy, 0);
    camera.updateProjectionMatrix();
  };
  frame();
  const ro = new ResizeObserver(frame);
  ro.observe(canvas);

  // ── post-traitement : bloom sur les éclats de l'or, alpha préservé ──
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const scenePass = pass(scene, camera, { samples: 4 });
  const col = scenePass.getTextureNode("output");
  // Le halo s'éteint en douceur avant les bords du canvas : sinon le cadre le
  // tranche net au passage d'un rayon (effet « bug »). Plus discret en petit.
  const glow = bloom(col, opts.variant === "header" ? 0.22 : 0.4, 0.22, 0.92);
  // la lueur ne sort pas de l'étendard : masquée par sa propre silhouette
  const insideCloth = smoothstep(0.05, 0.6, col.a);
  const edgeFade = smoothstep(0, 0.16, min(screenUV.x, screenUV.x.oneMinus())).mul(
    smoothstep(0, 0.1, min(screenUV.y, screenUV.y.oneMinus())),
  );
  const ldr = renderOutput(
    vec4(col.rgb.add(glow.rgb.mul(edgeFade).mul(insideCloth)), col.a),
    THREE.NeutralToneMapping,
    THREE.SRGBColorSpace,
  );
  pipeline.outputNode = vec4(ldr.rgb, max(ldr.a, max(ldr.r, max(ldr.g, ldr.b))));

  // ── passages de lumière ──
  const sideDelay = opts.side === "right" ? 480 : 0;
  let sweep: (SweepEvent & { start: number }) | null = null;
  const unsubscribe = subscribeSweep((e) => {
    sweep = { ...e, start: e.at + sideDelay };
  });
  const updateSweep = (now: number) => {
    if (!sweep) {
      uSweepOn.value = 0;
      return;
    }
    const k = (now - sweep.start) / SWEEP_MS;
    if (k < 0) {
      uSweepOn.value = 0;
      return;
    }
    if (k > 1) {
      sweep = null;
      uSweepOn.value = 0;
      return;
    }
    const a = sweep.angle;
    uSweepDir.value.set(Math.cos(a), Math.sin(a));
    // étendue de la projection de l'étendard sur l'axe du balayage
    const xs = [-SHAPE.width / 2, SHAPE.width / 2];
    const ys = [0.05, -SHAPE.height];
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of xs)
      for (const y of ys) {
        const s = x * Math.cos(a) + y * Math.sin(a);
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
    const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    uSweepC.value = lo - 0.35 + (hi - lo + 0.7) * eased;
    // enveloppe en cloche : la lumière monte et retombe en douceur
    uSweepOn.value = sweep.strength * Math.pow(Math.sin(Math.PI * k), 0.8);
  };

  // ── éclairs ──
  let strike: StrikeEvent | null = null;
  const unsubscribeStrike = subscribeStrike((e) => {
    strike = e;
    // l'éclair tombe du côté où il frappe
    flashLight.position.set(e.x * 2.2, 2.4, 1.6);
  });
  const updateStrike = (now: number) => {
    if (!strike) {
      flashLight.intensity = 0;
      return;
    }
    const t = (now - strike.at) / 1000;
    if (t > 1.2) {
      strike = null;
      flashLight.intensity = 0;
      return;
    }
    flashLight.intensity = 7 * strike.strength * strikeEnvelope(t);
  };

  // ── météo : glissement vers la cible ──
  const applyWeather = (w: WeatherSettings) => {
    target.key.setHex(w.keyColor);
    target.keyI = w.keyIntensity;
    target.exposure = w.exposure;
    target.env = w.envIntensity;
    target.wear = w.wear;
    worker.postMessage({
      type: "wind",
      id,
      speed: w.wind,
      turbulence: w.turbulence,
      gustAmp: w.gustAmp,
      gustEvery: w.gustEvery,
    });
    setSky(w);
  };
  const easeWeather = (dt: number) => {
    const k = 1 - Math.exp(-dt / 0.9);
    cur.key.lerp(target.key, k);
    cur.keyI += (target.keyI - cur.keyI) * k;
    cur.exposure += (target.exposure - cur.exposure) * k;
    cur.env += (target.env - cur.env) * k;
    cur.wear += (target.wear - cur.wear) * k;
    key.color.copy(cur.key);
    key.intensity = cur.keyI;
    renderer.toneMappingExposure = cur.exposure;
    scene.environmentIntensity = cur.env;
    uWear.value = cur.wear;
  };

  // ── boucle ──
  let last = performance.now();
  let first = true;
  const loop = () => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    worker.postMessage({ type: "tick", id, dt });
    if (pending) {
      (ib.array as Float32Array).set(pending);
      ib.needsUpdate = true;
      pending = null;
    }
    rod.rotation.z = rodAngle;
    easeWeather(Math.min(dt, 0.1));
    uTime.value = (now / 1000) % 3600; // borné : précision du bruit des braises
    updateSweep(now);
    updateStrike(now);
    pipeline.render();
    if (first) {
      first = false;
      opts.onReady?.();
    }
  };
  let paused = false;
  renderer.setAnimationLoop(loop);

  return {
    setPaused(p: boolean) {
      if (p === paused) return;
      paused = p;
      if (p) renderer.setAnimationLoop(null);
      else {
        last = performance.now();
        renderer.setAnimationLoop(loop);
      }
    },
    setWind(speed: number) {
      worker.postMessage({ type: "wind", id, speed });
    },
    gust(strength = 1.2) {
      worker.postMessage({ type: "gust", id, strength });
    },
    setWeather(w: WeatherSettings) {
      applyWeather(w);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      unsubscribe();
      unsubscribeStrike();
      ro.disconnect();
      simListeners.delete(id);
      worker.postMessage({ type: "dispose", id });
      pipeline.dispose();
      geo.dispose();
      clothMat.dispose();
      rodMat.dispose();
      gemMat.dispose();
      tex.dispose();
      renderer.dispose();
    },
  };
}
