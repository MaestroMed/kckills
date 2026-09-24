/// <reference lib="webworker" />
/**
 * Worker de simulation des étendards : la physique du tissu (Verlet,
 * ~1,5 ms par étendard et par image) tourne hors du thread principal, qui ne
 * fait plus que recopier positions + normales dans la géométrie. Un seul
 * worker pour les deux étendards du header.
 *
 * Horloge : le thread principal envoie un « tick » par image affichée avec
 * le temps écoulé ; le worker avance à pas fixe (1/120 s, accumulateur) puis
 * renvoie un tableau entrelacé [px, py, pz, nx, ny, nz, ao] par sommet.
 * ao = occlusion des plis, estimée par la courbure (laplacien projeté sur la
 * normale) : un sommet au fond d'un creux reçoit moins de lumière.
 *
 * Vent « ressenti » : vitesse de base modulée par une respiration lente
 * (somme de sinus incommensurables) et par des rafales aléatoires
 * (attaque ~0,7 s, tenue ~1,3 s, relâche ~2,5 s), direction qui dérive
 * doucement. Le champ turbulent voyage avec le vent (cloth-sim).
 */
import { Cloth, type ClothSpec, type WindState } from "./cloth-sim";

type Init = {
  type: "init";
  id: string;
  spec: ClothSpec;
  wind: WindState;
  seed: number;
};
type Msg =
  | Init
  | { type: "tick"; id: string; dt: number }
  | { type: "wind"; id: string; speed?: number; turbulence?: number }
  | { type: "gust"; id: string; strength?: number }
  | { type: "dispose"; id: string };

interface Gust {
  start: number;
  amp: number;
}

interface Sim {
  cloth: Cloth;
  wind: WindState;
  baseSpeed: number;
  baseDirX: number;
  t: number;
  acc: number;
  nextGust: number;
  gusts: Gust[];
  seed: number;
  out: Float32Array;
  /** Voisins directs (arêtes du maillage), en liste compacte. */
  nbStart: Int32Array;
  nbList: Int32Array;
}

const STRIDE = 7;

function buildNeighbors(index: Uint32Array, count: number): { nbStart: Int32Array; nbList: Int32Array } {
  const sets: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  for (let k = 0; k < index.length; k += 3) {
    const a = index[k];
    const b = index[k + 1];
    const c = index[k + 2];
    sets[a].add(b).add(c);
    sets[b].add(a).add(c);
    sets[c].add(a).add(b);
  }
  const nbStart = new Int32Array(count + 1);
  let total = 0;
  for (let i = 0; i < count; i++) {
    nbStart[i] = total;
    total += sets[i].size;
  }
  nbStart[count] = total;
  const nbList = new Int32Array(total);
  for (let i = 0; i < count; i++) {
    let o = nbStart[i];
    for (const v of sets[i]) nbList[o++] = v;
  }
  return { nbStart, nbList };
}

const sims = new Map<string, Sim>();
const STEP = 1 / 120;

function rand(sim: Sim): number {
  // xorshift déterministe par étendard (les deux ne soufflent pas en même temps)
  let x = sim.seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  sim.seed = x;
  return ((x >>> 0) % 100000) / 100000;
}

function gustEnvelope(age: number): number {
  const attack = 0.7;
  const hold = 1.3;
  const release = 2.5;
  if (age < 0) return 0;
  if (age < attack) {
    const k = age / attack;
    return k * k * (3 - 2 * k);
  }
  if (age < attack + hold) return 1;
  const r = (age - attack - hold) / release;
  return r >= 1 ? 0 : 1 - r * r * (3 - 2 * r);
}

function advanceWind(sim: Sim): number {
  const t = sim.t;
  // respiration lente, jamais nulle
  const breath =
    0.18 * Math.sin(t * 0.41 + 1.3) + 0.12 * Math.sin(t * 0.73 + 0.2) + 0.08 * Math.sin(t * 1.37 + 2.1);
  if (t >= sim.nextGust) {
    sim.gusts.push({ start: t, amp: 0.55 + rand(sim) * 0.75 });
    sim.nextGust = t + 7 + rand(sim) * 9;
  }
  let gust = 0;
  sim.gusts = sim.gusts.filter((g) => t - g.start < 5);
  for (const g of sim.gusts) gust += g.amp * gustEnvelope(t - g.start);
  sim.wind.speed = sim.baseSpeed * (1 + breath + gust);
  sim.wind.dir[0] = sim.baseDirX + 0.25 * Math.sin(t * 0.23 + 0.7) + 0.2 * gust;
  return gust;
}

function writeFrame(sim: Sim): Float32Array {
  const { cloth, out, nbStart, nbList } = sim;
  const pos = cloth.pos;
  const idx = cloth.index;
  const n = cloth.count;
  // normales de sommet : somme des normales de faces (pondérées par l'aire)
  for (let i = 0; i < n; i++) {
    out[i * STRIDE + 3] = 0;
    out[i * STRIDE + 4] = 0;
    out[i * STRIDE + 5] = 0;
  }
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k];
    const b = idx[k + 1];
    const c = idx[k + 2];
    const ax = pos[a * 3];
    const ay = pos[a * 3 + 1];
    const az = pos[a * 3 + 2];
    const e1x = pos[b * 3] - ax;
    const e1y = pos[b * 3 + 1] - ay;
    const e1z = pos[b * 3 + 2] - az;
    const e2x = pos[c * 3] - ax;
    const e2y = pos[c * 3 + 1] - ay;
    const e2z = pos[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      out[v * STRIDE + 3] += nx;
      out[v * STRIDE + 4] += ny;
      out[v * STRIDE + 5] += nz;
    }
  }
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    const px = pos[i * 3];
    const py = pos[i * 3 + 1];
    const pz = pos[i * 3 + 2];
    out[o] = px;
    out[o + 1] = py;
    out[o + 2] = pz;
    const l = Math.hypot(out[o + 3], out[o + 4], out[o + 5]) || 1;
    const nx = out[o + 3] / l;
    const ny = out[o + 4] / l;
    const nz = out[o + 5] / l;
    out[o + 3] = nx;
    out[o + 4] = ny;
    out[o + 5] = nz;
    // cavité : moyenne des voisins moins le sommet, projetée sur la normale
    let mx = 0;
    let my = 0;
    let mz = 0;
    const s0 = nbStart[i];
    const s1 = nbStart[i + 1];
    for (let k = s0; k < s1; k++) {
      const v = nbList[k] * 3;
      mx += pos[v];
      my += pos[v + 1];
      mz += pos[v + 2];
    }
    const cnt = Math.max(1, s1 - s0);
    const concave = ((mx / cnt - px) * nx + (my / cnt - py) * ny + (mz / cnt - pz) * nz);
    // la normale est orientée vers +z (face avant) : creux vu de face = concave > 0
    out[o + 6] = Math.max(0, Math.min(1, 1 - Math.max(0, concave) * 42));
  }
  return out;
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const msg = e.data;
  if (msg.type === "init") {
    const cloth = new Cloth(msg.spec);
    const sim: Sim = {
      cloth,
      wind: { ...msg.wind, dir: [...msg.wind.dir] as [number, number, number] },
      baseSpeed: msg.wind.speed,
      baseDirX: msg.wind.dir[0],
      t: 0,
      acc: 0,
      nextGust: 3 + (msg.seed % 5),
      gusts: [],
      seed: msg.seed || 1,
      out: new Float32Array(cloth.count * STRIDE),
      ...buildNeighbors(cloth.index, cloth.count),
    };
    // l'étendard part posé, pas en planche
    cloth.settle(2.5, sim.wind);
    sims.set(msg.id, sim);
    const frame = writeFrame(sim);
    self.postMessage({
      type: "ready",
      id: msg.id,
      count: cloth.count,
      uv: cloth.uv,
      index: cloth.index,
      frame,
    });
    return;
  }
  const sim = sims.get(msg.id);
  if (!sim) return;
  if (msg.type === "tick") {
    sim.acc += Math.min(msg.dt, 0.1);
    let steps = 0;
    while (sim.acc >= STEP && steps < 4) {
      const gust = advanceWind(sim);
      sim.cloth.rodAngle = 0.018 * Math.sin(sim.t * 0.63) + 0.02 * gust;
      sim.cloth.sampleWind(sim.t, sim.wind);
      sim.cloth.step(STEP);
      sim.t += STEP;
      sim.acc -= STEP;
      steps++;
    }
    if (steps === 4) sim.acc = 0; // onglet ralenti : on ne rattrape pas
    self.postMessage({ type: "frame", id: msg.id, frame: writeFrame(sim), rod: sim.cloth.rodAngle });
  } else if (msg.type === "wind") {
    if (msg.speed !== undefined) sim.baseSpeed = msg.speed;
    if (msg.turbulence !== undefined) sim.wind.turbulence = msg.turbulence;
  } else if (msg.type === "gust") {
    sim.gusts.push({ start: sim.t, amp: msg.strength ?? 1.2 });
  } else if (msg.type === "dispose") {
    sims.delete(msg.id);
  }
};
