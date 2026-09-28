/**
 * Vue 3D d'une piste de logo (labo) : les tracés SVG de logo-marks sont
 * extrudés en or massif biseauté, le cœur en gemme bleue KC, le fond d'écu
 * en émail. Même environnement « arène » et mêmes rayons de lumière que les
 * étendards ; la pièce oscille lentement comme sur un présentoir.
 */
import * as THREE from "three/webgpu";
import {
  color,
  dot,
  exp,
  max,
  min,
  normalize,
  pass,
  positionLocal,
  positionViewDirection,
  pow,
  renderOutput,
  saturate,
  screenUV,
  smoothstep,
  uniform,
  vec4,
  float,
  normalView,
} from "three/tsl";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { buildStageEnvironment } from "@/components/banner/banner-engine";
import type { LogoConcept, Tone } from "./logo-marks";

export interface LogoHandle {
  setConcept(c: LogoConcept): void;
  sweep(): void;
  dispose(): void;
}

const DEPTH: Record<Tone, number> = { goldLight: 30, goldDark: 24, gem: 38, gemLight: 42, gemDark: 34, plate: 10 };

export async function mountLogo3D(canvas: HTMLCanvasElement, initial: LogoConcept): Promise<LogoHandle> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.environment = buildStageEnvironment(renderer);
  scene.environmentIntensity = 1.0;
  const key = new THREE.DirectionalLight(0xffe4c0, 2.2);
  key.position.set(-2, 2.5, 3);
  const rim = new THREE.DirectionalLight(0x7fe3ff, 1.1);
  rim.position.set(2.5, 0.5, -2);
  scene.add(key, rim);

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 0, 5.2);

  // ── rayon de lumière : bande qui traverse la pièce, l'or s'embrase ──
  const uSweepC = uniform(-10);
  const uSweepOn = uniform(0);
  const bandAt = () => {
    const d = dot(positionLocal.xy, vec4(0.8, -0.6, 0, 0).xy).sub(uSweepC);
    return exp(d.mul(d).mul(-1 / (2 * 38 * 38))).mul(uSweepOn);
  };
  const goldMat = (hex: number, rough: number) => {
    const m = new THREE.MeshPhysicalNodeMaterial({ color: hex, metalness: 1, roughness: rough });
    const V = positionViewDirection;
    const fres = pow(saturate(float(1).sub(dot(normalize(normalView), V))), 2);
    m.emissiveNode = color(0xffd48a).mul(bandAt()).mul(fres.mul(1.6).add(0.35));
    return m;
  };
  const gemMat = (hex: number, glow: number) =>
    new THREE.MeshPhysicalNodeMaterial({
      color: hex,
      metalness: 0,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      emissive: 0x0a2a8c,
      emissiveIntensity: glow,
    });
  const mats: Record<Tone, THREE.Material> = {
    goldLight: goldMat(0xf2dca0, 0.2),
    goldDark: goldMat(0xcfa55c, 0.28),
    gem: gemMat(0x1f5cff, 0.35),
    gemLight: gemMat(0x6fb8ff, 0.5),
    gemDark: gemMat(0x0a2fa8, 0.25),
    plate: new THREE.MeshPhysicalNodeMaterial({
      color: 0x1640b0,
      roughness: 0.4,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      emissive: 0x061a55,
      emissiveIntensity: 0.45,
    }),
  };

  const loader = new SVGLoader();
  const holder = new THREE.Group();
  scene.add(holder);
  let current: THREE.Group | null = null;
  const build = (c: LogoConcept) => {
    if (current) {
      holder.remove(current);
      current.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const g = new THREE.Group();
    for (const part of c.parts) {
      const data = loader.parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="${part.d}"/></svg>`);
      const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p));
      const geo = new THREE.ExtrudeGeometry(shapes, {
        depth: DEPTH[part.tone],
        bevelEnabled: true,
        bevelThickness: part.tone === "plate" ? 2 : 5,
        bevelSize: part.tone === "plate" ? 1.5 : 3.5,
        bevelSegments: 3,
        curveSegments: 6,
      });
      g.add(new THREE.Mesh(geo, mats[part.tone]));
    }
    // SVG : y vers le bas, origine en haut à gauche → centré, y retourné, ~2 unités de haut
    g.position.set(-256, -256, 0);
    const pivot = new THREE.Group();
    pivot.add(g);
    pivot.scale.set(1 / 256, -1 / 256, 1 / 256);
    current = pivot;
    holder.add(pivot);
  };
  build(initial);

  // ── post : bloom discret, éteint avant les bords ──
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const scenePass = pass(scene, camera, { samples: 4 });
  const col = scenePass.getTextureNode("output");
  const glow = bloom(col, 0.35, 0.25, 0.9);
  const edgeFade = smoothstep(0, 0.12, min(screenUV.x, screenUV.x.oneMinus())).mul(
    smoothstep(0, 0.12, min(screenUV.y, screenUV.y.oneMinus())),
  );
  const ldr = renderOutput(vec4(col.rgb.add(glow.rgb.mul(edgeFade)), col.a), THREE.NeutralToneMapping, THREE.SRGBColorSpace);
  pipeline.outputNode = vec4(ldr.rgb, max(ldr.a, max(ldr.r, max(ldr.g, ldr.b))));

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  let sweepStart = -1;
  let nextAuto = performance.now() + 1800;
  const sweep = () => {
    sweepStart = performance.now();
  };
  const t0 = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const t = (now - t0) / 1000;
    holder.rotation.y = 0.5 * Math.sin(t * 0.45);
    holder.rotation.x = 0.08 * Math.sin(t * 0.31);
    if (now > nextAuto) {
      sweep();
      nextAuto = now + 5000 + Math.random() * 4000;
    }
    const k = sweepStart < 0 ? 2 : (now - sweepStart) / 1400;
    if (k >= 0 && k <= 1) {
      uSweepC.value = -420 + 840 * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
      uSweepOn.value = 1;
    } else uSweepOn.value = 0;
    pipeline.render();
  });

  return {
    setConcept: build,
    sweep,
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      current?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      Object.values(mats).forEach((m) => m.dispose());
      pipeline.dispose();
      renderer.dispose();
    },
  };
}
