/**
 * « L'Écrin » en 3D — moteur de présentation du logo (three.js WebGPU + TSL,
 * repli WebGL2 automatique).
 *
 * - Éclats taillés : bipyramides à 8 facettes (crête au milieu), or poli dans
 *   un environnement « joaillerie » (bandes lumineuses fines → reflets nets
 *   sur chaque facette).
 * - Cristal Hextech taille brillant : réfraction, dispersion, irisation, cœur
 *   d'énergie qui respire, halo et rayons de lumière (diffusion radiale en
 *   post-traitement, depuis la position écran du cristal).
 * - Poussière : 8 000 particules calculées sur le GPU (compute TSL), tourbillon
 *   lent autour du cristal, scintillement, gerbe à l'allumage.
 * - Animation : les éclats convergent, le cristal s'allume (flash, onde de
 *   choc, gerbe), puis flottement, pulsation, rayons qui passent sur l'or, et
 *   la pièce qui s'incline vers la souris. prefers-reduced-motion : pièce
 *   assemblée, immobile.
 */
import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  Loop,
  acos,
  color,
  cos,
  deltaTime,
  dot,
  exp,
  float,
  hash,
  instanceIndex,
  instancedArray,
  length,
  max,
  min,
  mix,
  mx_noise_vec3,
  normalView,
  normalize,
  pass,
  positionLocal,
  positionViewDirection,
  pow,
  renderOutput,
  saturate,
  screenUV,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { CREST_SPEC, gemRing, shardPoints, type CrestSpec, type P } from "./logo-marks";

export interface LogoHandle {
  setSpec(s: CrestSpec): void;
  /** Rejoue l'assemblage : les éclats convergent, le cristal s'allume. */
  assemble(): void;
  sweep(): void;
  dispose(): void;
}

/**
 * Lueur additive. La forme vient de l'ALPHA du colorNode (dégradé rond), pas
 * d'un alpha à 1 sur tout le quad : sinon le canvas devient opaque sur un carré.
 */
function glowBlend<T extends THREE.Material>(m: T): T {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  return m;
}

const to3 = (p: P, z = 0) => new THREE.Vector3((p[0] - 256) / 256, -(p[1] - 256) / 256, z);

/** Géométrie à facettes plates (non indexée), faces orientées vers l'extérieur de `center`. */
function facetedGeometry(tris: [THREE.Vector3, THREE.Vector3, THREE.Vector3][], center: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const [a, b, d] of tris) {
    e1.subVectors(b, a);
    e2.subVectors(d, a);
    n.crossVectors(e1, e2);
    c.copy(a).add(b).add(d).multiplyScalar(1 / 3).sub(center);
    const [p, q, r] = n.dot(c) >= 0 ? [a, b, d] : [a, d, b];
    pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Éclat : bipyramide allongée, crête avant plus haute que l'arrière. Géométrie centrée sur son milieu. */
function shardGeometry(s: CrestSpec["shards"][number]) {
  const { a, b, l, r, m } = shardPoints(s);
  const M = to3(m);
  const h = (s.hw / 256) * 0.95;
  const A = to3(a).sub(M);
  const B = to3(b).sub(M);
  const L = to3(l).sub(M);
  const R = to3(r).sub(M);
  const T = new THREE.Vector3(0, 0, h);
  const D = new THREE.Vector3(0, 0, -h * 0.55);
  const geo = facetedGeometry(
    [
      [A, L, T],
      [L, B, T],
      [B, R, T],
      [R, A, T],
      [A, L, D],
      [L, B, D],
      [B, R, D],
      [R, A, D],
    ],
    new THREE.Vector3(),
  );
  return { geo, center: M };
}

/** Cristal taille brillant : table, couronne (8), pavillon (8). Centré sur l'origine. */
function gemGeometry(g: CrestSpec["gem"]) {
  const C = to3(g.c);
  const girdle = gemRing(g).map((p) => to3(p).sub(C));
  const crownH = (g.rx / 256) * 0.62;
  const table = gemRing(g, 0.46, g.ry * 0.08).map((p) => to3(p, crownH).sub(new THREE.Vector3(C.x, C.y, 0)));
  const tableC = new THREE.Vector3(0, (g.ry * 0.08) / 256, crownH);
  const apex = new THREE.Vector3(0, 0, -(g.rx / 256) * 1.25);
  const tris: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    tris.push([table[i], table[j], tableC]);
    tris.push([girdle[i], girdle[j], table[j]]);
    tris.push([girdle[i], table[j], table[i]]);
    tris.push([girdle[i], apex, girdle[j]]);
  }
  return { geo: facetedGeometry(tris, new THREE.Vector3(0, 0, 0.02)), center: C };
}

/** Environnement « joaillerie » : noir profond, fines bandes lumineuses (reflets nets), contre-jour bleu. */
function buildJewelEnvironment(renderer: THREE.WebGPURenderer): THREE.Texture {
  const env = new THREE.Scene();
  const domeMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  domeMat.colorNode = mix(color(0x010207), color(0x060c26), smoothstep(-0.4, 1, normalize(positionLocal).y));
  env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), domeMat));
  const strip = (w: number, h: number, c: number, k: number, pos: [number, number, number]) => {
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    m.colorNode = color(c).mul(k);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.position.set(...pos);
    mesh.lookAt(0, 0, 0);
    env.add(mesh);
  };
  strip(0.5, 7, 0xfff1d6, 7, [-4.5, 1, 5]); // bande verticale chaude, gauche
  strip(0.4, 7, 0xfff4e6, 6, [4, 0.5, 5.5]); // bande verticale neutre, droite
  strip(0.35, 5, 0xffd9a0, 5, [5.5, -1.5, 3.5]); // bande chaude basse, droite
  strip(8, 0.45, 0xfff4e0, 6, [0, 5, 4]); // bande horizontale haute
  strip(6, 2.5, 0xffc070, 2.2, [0, 1.5, 7]); // grand réflecteur doré de face
  strip(1.2, 6, 0xffe6c4, 2.2, [6.5, 0, -3.5]); // contre-jour blanc chaud (le bleu appartient au cristal)
  strip(1.2, 6, 0xfff0dc, 1.8, [-6.5, 0, -3.5]); // contre-jour blanc, gauche
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.012);
  pmrem.dispose();
  return rt.texture;
}

export async function mountLogo3D(canvas: HTMLCanvasElement, initial: CrestSpec = CREST_SPEC): Promise<LogoHandle> {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.environment = buildJewelEnvironment(renderer);
  const key = new THREE.DirectionalLight(0xfff0dc, 1.6);
  key.position.set(-2, 3, 4);
  const rim = new THREE.DirectionalLight(0x5aa8ff, 0.8);
  rim.position.set(3, -1, -3);
  // remplissage doux : aucune facette ne tombe au noir complet
  const fill = new THREE.HemisphereLight(0xffe2b8, 0x10204a, 0.55);
  scene.add(key, rim, fill);

  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
  camera.position.set(0, 0, 6.2);

  // ── uniformes de mise en scène ──
  const uSweepC = uniform(-10);
  const uSweepOn = uniform(0);
  const uIgnite = uniform(0); // flash d'allumage (0..1)
  const uCore = uniform(0); // intensité du cœur d'énergie
  const uBurst = uniform(0); // gerbe de particules
  const uRays = uniform(0); // rayons depuis le cristal
  const uRing = uniform(0); // onde de choc (opacité)
  const uDust = uniform(reduced ? 0.6 : 0.25); // luminosité de la poussière

  // ── or poli ──
  const goldMat = new THREE.MeshPhysicalNodeMaterial({ color: 0xe9b95e, metalness: 1, roughness: 0.13 });
  {
    const d = dot(positionLocal.xy, vec2(0.8, -0.6)).sub(uSweepC);
    const band = exp(d.mul(d).mul(-1 / (2 * 0.12 * 0.12))).mul(uSweepOn);
    const fres = pow(saturate(float(1).sub(dot(normalize(normalView), positionViewDirection))), 2.2);
    goldMat.emissiveNode = color(0xffd48a).mul(band.mul(fres.mul(2.2).add(0.4)).add(uIgnite.mul(0.35)));
  }

  // ── cristal Hextech ──
  const gemMat = new THREE.MeshPhysicalNodeMaterial({
    color: 0x3b7bff,
    metalness: 0,
    roughness: 0.03,
    transmission: 1,
    thickness: 0.32,
    ior: 2.1,
    dispersion: 4.5,
    attenuationColor: 0x1b4dff,
    attenuationDistance: 0.35,
    iridescence: 0.3,
    iridescenceIOR: 1.35,
    clearcoat: 1,
    clearcoatRoughness: 0,
  });
  {
    const facing = saturate(dot(normalize(normalView), positionViewDirection));
    gemMat.emissiveNode = color(0x39c6ff).mul(uCore.mul(0.035).mul(facing.pow(2).add(0.25)).add(uIgnite.mul(1.2)));
  }
  // cœur OPAQUE et très lumineux : le cristal le réfracte, le bloom le fait rayonner
  const coreMat = new THREE.MeshBasicNodeMaterial();
  coreMat.colorNode = color(0x7fe6ff).mul(uCore);

  // halo derrière le cristal
  const haloMat = glowBlend(new THREE.SpriteNodeMaterial());
  {
    const d = length(uv().sub(0.5)).mul(2);
    const fall = pow(saturate(float(1).sub(d)), 2.6);
    haloMat.colorNode = vec4(color(0x2f8dff).mul(uCore.mul(0.07).add(uIgnite.mul(1.2))), fall);
  }
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(0.78, 0.98, 1);
  halo.position.z = -0.2;

  // onde de choc
  const ringMat = glowBlend(new THREE.MeshBasicNodeMaterial());
  ringMat.colorNode = vec4(color(0xb8f2ff).mul(4), uRing.mul(uRing));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.0, 128), ringMat);
  ring.position.z = 0.05;
  ring.visible = false;

  const holder = new THREE.Group();
  scene.add(holder);

  type Piece = { obj: THREE.Object3D; home: THREE.Vector3; from: THREE.Vector3; spin: THREE.Euler; delay: number };
  let pieces: Piece[] = [];
  let gemGroup: THREE.Group | null = null;
  let crest: THREE.Group | null = null;

  const build = (spec: CrestSpec) => {
    if (crest) {
      holder.remove(crest);
      crest.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const group = new THREE.Group();
    pieces = spec.shards.map((s, i) => {
      const { geo, center } = shardGeometry(s);
      const mesh = new THREE.Mesh(geo, goldMat);
      mesh.position.copy(center);
      group.add(mesh);
      const from = center
        .clone()
        .setZ(0)
        .normalize()
        .multiplyScalar(2.6)
        .add(new THREE.Vector3(0, 0, 1.8 + (i % 3) * 0.4));
      return {
        obj: mesh,
        home: center.clone(),
        from,
        spin: new THREE.Euler((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2),
        delay: 0.05 * i + Math.random() * 0.12,
      };
    });
    const { geo, center } = gemGeometry(spec.gem);
    const gg = new THREE.Group();
    gg.position.copy(center);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry((spec.gem.rx / 256) * 0.42, 1), coreMat);
    core.scale.set(1, spec.gem.ry / spec.gem.rx, 0.6);
    gg.add(halo, core, new THREE.Mesh(geo, gemMat), ring);
    group.add(gg);
    holder.add(group);
    gemGroup = gg;
    crest = group;
  };
  build(initial);

  // ── poussière (compute GPU) ──
  const COUNT = 8000;
  const pPos = instancedArray(COUNT, "vec3");
  const pVel = instancedArray(COUNT, "vec3");
  const pSeed = instancedArray(COUNT, "vec4");
  const initDust = Fn(() => {
    const i = instanceIndex;
    const r1 = hash(i);
    const r2 = hash(i.add(7919));
    const r3 = hash(i.add(3571));
    const theta = r1.mul(Math.PI * 2);
    const phi = acos(r2.mul(2).sub(1));
    const rad = mix(0.25, 2.8, pow(r3, 0.55));
    pPos.element(i).assign(vec3(sin(phi).mul(cos(theta)).mul(rad).mul(1.35), sin(phi).mul(sin(theta)).mul(rad), cos(phi).mul(rad).mul(0.55)));
    pVel.element(i).assign(vec3(0));
    pSeed.element(i).assign(vec4(mix(0.004, 0.02, pow(hash(i.add(17)), 3)), hash(i.add(31)), hash(i.add(53)).mul(Math.PI * 2), hash(i.add(97))));
  })().compute(COUNT);
  const updateDust = Fn(() => {
    const p = pPos.element(instanceIndex);
    const v = pVel.element(instanceIndex);
    const n = mx_noise_vec3(p.mul(0.85).add(vec3(0, 0, time.mul(0.06))));
    const swirl = vec3(p.y.negate(), p.x, 0).mul(0.07);
    const rise = vec3(0, 0.015, 0);
    const dist = length(p).max(0.05);
    const radial = normalize(p).mul(uBurst.mul(2.6)).div(dist.mul(1.4).add(0.25));
    v.assign(mix(v, n.mul(0.11).add(swirl).add(rise).add(radial), 0.06));
    p.addAssign(v.mul(deltaTime.min(0.05)));
    // trop loin : réapparaît près du cristal, comme une poussière qui s'en échappe
    If(dist.greaterThan(3.1), () => {
      p.assign(normalize(p).mul(0.3));
    });
  })().compute(COUNT);
  await renderer.computeAsync(initDust);

  const dustMat = glowBlend(new THREE.SpriteNodeMaterial());
  {
    const s = pSeed.toAttribute();
    const pp = pPos.toAttribute();
    dustMat.positionNode = pp;
    const twinkle = sin(time.mul(2.4).add(s.z)).mul(0.5).add(0.5);
    const near = smoothstep(1.6, 0.15, length(pp));
    dustMat.scaleNode = s.x.mul(mix(0.55, 1.45, twinkle));
    const d = length(uv().sub(0.5));
    const spot = pow(saturate(float(1).sub(d.mul(2))), 1.8);
    const tint = mix(color(0xffd79a), color(0x74dcff), max(smoothstep(0.55, 0.95, s.y), near.mul(0.7)));
    dustMat.colorNode = vec4(tint.mul(mix(0.35, 2.4, twinkle)).mul(near.mul(2.6).add(0.5)).mul(uDust.mul(3).add(uBurst.mul(3))), spot);
  }
  const dust = new THREE.Sprite(dustMat);
  dust.count = COUNT;
  dust.frustumCulled = false;
  scene.add(dust);

  // ── post : bloom + rayons depuis le cristal ──
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const scenePass = pass(scene, camera, { samples: 4 });
  const col = scenePass.getTextureNode("output");
  const glow = bloom(col, 0.42, 0.3, 0.92);
  // r186 : la méthode JS est getTextureNode() ; les types (en retard) déclarent getTexture().
  const glowTex = (glow as unknown as { getTextureNode: () => ReturnType<typeof glow.getTexture> }).getTextureNode();
  const uCenter = uniform(new THREE.Vector2(0.5, 0.5));
  const rays = Fn(() => {
    const acc = vec3(0).toVar();
    const coord = screenUV.toVar();
    const delta = coord.sub(uCenter).mul(0.9 / 40);
    const decay = float(1).toVar();
    Loop(40, () => {
      coord.subAssign(delta);
      acc.addAssign(glowTex.sample(coord).rgb.mul(decay));
      decay.mulAssign(0.955);
    });
    return acc.mul(uRays.div(40));
  })();
  const edgeFade = smoothstep(0, 0.1, min(screenUV.x, screenUV.x.oneMinus())).mul(smoothstep(0, 0.1, min(screenUV.y, screenUV.y.oneMinus())));
  const hdr = col.rgb.add(glow.rgb.add(rays).mul(edgeFade));
  const ldr = renderOutput(vec4(hdr, col.a), THREE.NeutralToneMapping, THREE.SRGBColorSpace);
  pipeline.outputNode = vec4(ldr.rgb, max(ldr.a, max(ldr.r, max(ldr.g, ldr.b))));

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // la pièce garde sa taille à l'écran quelle que soit la largeur
    camera.position.z = Math.max(5.4, 6.2 / Math.min(1, camera.aspect));
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // ── souris : la pièce s'incline vers le pointeur ──
  const target = new THREE.Vector2();
  const onPointer = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    target.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  // ── chronologie ──
  const easeOutExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
  const easeOutBack = (x: number) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);
  let tAsm = reduced ? 99 : 0;
  let tNow = 0;
  let sweepStart = -1;
  let nextSweep = 4.5;
  const sweep = () => {
    sweepStart = tNow;
  };
  let last = performance.now();
  const gemWorld = new THREE.Vector3();

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tNow += dt;
    tAsm += dt;

    // assemblage des éclats
    for (const p of pieces) {
      const k = Math.min(1, Math.max(0, (tAsm - p.delay) / 1.15));
      const e = easeOutExpo(k);
      p.obj.position.copy(p.home).addScaledVector(p.from, 1 - e);
      p.obj.rotation.set(p.spin.x * (1 - e), p.spin.y * (1 - e), p.spin.z * (1 - e));
    }
    // allumage du cristal (à 1,05 s)
    const ti = tAsm - 1.05;
    if (gemGroup) {
      const g = ti <= 0 ? 0.001 : Math.min(1, easeOutBack(Math.min(1, ti / 0.45)));
      gemGroup.scale.setScalar(Math.max(0.001, g));
      gemGroup.rotation.y = ti <= 0 ? 0 : (1 - Math.min(1, ti / 0.6)) * 2.4;
    }
    const pulse = reduced ? 0 : Math.sin(tNow * 2.1) * 0.5 + Math.sin(tNow * 3.7) * 0.2;
    uIgnite.value = ti > 0 ? Math.exp(-ti * 3.2) * Math.min(1, ti * 12) : 0;
    uCore.value = ti > 0 ? Math.min(1, ti * 4) * (6 + pulse * 1.6) + uIgnite.value * 30 : 0;
    uBurst.value = ti > 0 ? Math.exp(-ti * 1.7) * Math.min(1, ti * 20) : 0;
    uRays.value = ti > 0 ? 0.32 + Math.exp(-ti * 1.2) * 1.3 : 0;
    ring.visible = ti > 0.05 && ti < 1.3;
    if (ring.visible) {
      const k = (ti - 0.05) / 1.25;
      ring.scale.setScalar(0.25 + k * 3.2);
      uRing.value = (1 - k) * (1 - k);
    }

    // flottement + inclinaison vers la souris
    if (!reduced) {
      holder.position.y = Math.sin(tNow * 0.8) * 0.025;
      holder.rotation.y += (target.x * 0.32 + Math.sin(tNow * 0.35) * 0.18 - holder.rotation.y) * 0.05;
      holder.rotation.x += (target.y * 0.22 - holder.rotation.x) * 0.05;
    }

    // rayons de lumière sur l'or
    if (tNow > nextSweep) {
      sweep();
      nextSweep = tNow + 6 + Math.random() * 4;
    }
    const ks = sweepStart < 0 ? 2 : (tNow - sweepStart) / 1.3;
    if (ks >= 0 && ks <= 1) {
      uSweepC.value = -1.7 + 3.4 * (ks < 0.5 ? 2 * ks * ks : 1 - Math.pow(-2 * ks + 2, 2) / 2);
      uSweepOn.value = 1;
    } else uSweepOn.value = 0;

    // centre des rayons = position écran du cristal
    if (gemGroup) {
      gemGroup.getWorldPosition(gemWorld).project(camera);
      uCenter.value.set(gemWorld.x * 0.5 + 0.5, 0.5 - gemWorld.y * 0.5);
    }

    if (!reduced) renderer.compute(updateDust);
    pipeline.render();
  });

  return {
    setSpec(s: CrestSpec) {
      build(s);
      tAsm = reduced ? 99 : 0;
    },
    assemble() {
      tAsm = reduced ? 99 : 0;
    },
    sweep,
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener("pointermove", onPointer);
      ro.disconnect();
      crest?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      [goldMat, gemMat, coreMat, haloMat, ringMat, dustMat].forEach((m) => m.dispose());
      pipeline.dispose();
      renderer.dispose();
    },
  };
}
