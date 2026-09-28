/**
 * Logo KCKILLS — « L'Écrin » (piste D du labo, choisie par Mehdi le 28/09/2026).
 *
 * Deux K se font face, taillés en éclats d'or ; leurs bras dessinent le
 * losange Hextech qui enserre un cristal bleu KC. Marque ORIGINALE : elle
 * reprend les codes de la KC et de Pentakill (symétrie métal, lames, le
 * chiffre cinq) sans reprendre leurs logos, qui appartiennent à Karmine Corp
 * et à Riot Games.
 *
 * Une seule description (`CrestSpec`, viewBox 512×512) sert à tout :
 *   - le SVG 2D (facettes calculées, éclairées d'en haut à gauche) ;
 *   - la 3D du labo (bipyramides taillées, cristal taille brillant).
 * `CREST_SMALL_SPEC` : version dessinée pour 16-48 px (moins de pièces, plus
 * épaisses, cristal plus grand).
 */

export type P = [number, number];

export interface ShardSpec {
  /** Pointes de l'éclat. */
  a: P;
  b: P;
  /** Demi-largeur au milieu. */
  hw: number;
}
export interface GemSpec {
  c: P;
  rx: number;
  ry: number;
}
export interface CrestSpec {
  id: "crest" | "crest-small";
  name: string;
  shards: ShardSpec[];
  gem: GemSpec;
}

export const CREST_SPEC: CrestSpec = {
  id: "crest",
  name: "L'Écrin",
  shards: [
    // K de gauche : fût en deux éclats
    { a: [92, 60], b: [92, 246], hw: 28 },
    { a: [92, 266], b: [92, 452], hw: 28 },
    // K de droite, en miroir
    { a: [420, 60], b: [420, 246], hw: 28 },
    { a: [420, 266], b: [420, 452], hw: 28 },
    // leurs bras : quatre éclats qui dessinent le losange Hextech
    { a: [118, 240], b: [246, 92], hw: 26 },
    { a: [394, 240], b: [266, 92], hw: 26 },
    { a: [118, 272], b: [246, 420], hw: 26 },
    { a: [394, 272], b: [266, 420], hw: 26 },
  ],
  gem: { c: [256, 256], rx: 46, ry: 66 },
};

export const CREST_SMALL_SPEC: CrestSpec = {
  id: "crest-small",
  name: "L'Écrin — petites tailles",
  shards: [
    { a: [90, 44], b: [90, 468], hw: 40 },
    { a: [422, 44], b: [422, 468], hw: 40 },
    { a: [128, 236], b: [246, 84], hw: 36 },
    { a: [384, 236], b: [266, 84], hw: 36 },
    { a: [128, 276], b: [246, 428], hw: 36 },
    { a: [384, 276], b: [266, 428], hw: 36 },
  ],
  gem: { c: [256, 256], rx: 58, ry: 84 },
};

// ─── géométrie 2D ───────────────────────────────────────────────────────────
export const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
export const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
export const unit = (a: P): P => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};
export const perp = (a: P): P => [-a[1], a[0]];

/** Points d'un éclat : pointes, flancs, centre (la crête vue de face). */
export function shardPoints(s: ShardSpec) {
  const m = mul(add(s.a, s.b), 0.5);
  const n = mul(perp(unit(sub(s.b, s.a))), s.hw);
  return { a: s.a, b: s.b, l: add(m, n), r: sub(m, n), m };
}

/** Pourtour du cristal (rondiste) : 8 points sur l'ellipse ; `scale` < 1 et `lift` pour la table. */
export function gemRing(g: GemSpec, scale = 1, lift = 0): P[] {
  return Array.from({ length: 8 }, (_, i) => {
    const t = (i / 8) * Math.PI * 2 - Math.PI / 2;
    return [g.c[0] + Math.cos(t) * g.rx * scale, g.c[1] + Math.sin(t) * g.ry * scale - lift] as P;
  });
}

// ─── rendu 2D : facettes classées par l'éclairage ────────────────────────────
export type GoldTone = "g1" | "g2" | "g3" | "g4";
export type GemTone = "j1" | "j2" | "j3" | "j4";
export type Tone = GoldTone | GemTone;
export interface LogoPart {
  d: string;
  tone: Tone;
}

const path = (pts: P[]) => `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")} Z`;
/** Lumière 2D venant d'en haut à gauche. */
const LIGHT: P = unit([-0.7, -1]);

function facetTone<T extends Tone>(tri: [P, P, P], center: P, tones: [T, T, T, T]): T {
  // normale « sortante » approchée : du centre de la pièce vers le milieu de la facette
  const fc = mul(add(add(tri[0], tri[1]), tri[2]), 1 / 3);
  const out = unit(sub(fc, center));
  const lit = out[0] * LIGHT[0] + out[1] * LIGHT[1]; // -1..1
  if (lit > 0.45) return tones[0];
  if (lit > 0) return tones[1];
  if (lit > -0.45) return tones[2];
  return tones[3];
}

export function crestParts(spec: CrestSpec): LogoPart[] {
  const parts: LogoPart[] = [];
  const golds: [GoldTone, GoldTone, GoldTone, GoldTone] = ["g1", "g2", "g3", "g4"];
  for (const s of spec.shards) {
    const { a, b, l, r, m } = shardPoints(s);
    const tris: [P, P, P][] = [
      [a, l, m],
      [l, b, m],
      [b, r, m],
      [r, a, m],
    ];
    for (const t of tris) parts.push({ d: path(t), tone: facetTone(t, m, golds) });
  }
  // cristal : table (octogone) + 8 facettes de couronne
  const gems: [GemTone, GemTone, GemTone, GemTone] = ["j1", "j2", "j3", "j4"];
  const girdle = gemRing(spec.gem);
  const table = gemRing(spec.gem, 0.46, spec.gem.ry * 0.08);
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    parts.push({ d: path([girdle[i], girdle[j], table[j], table[i]]), tone: facetTone([girdle[i], girdle[j], table[j]], spec.gem.c, gems) });
  }
  parts.push({ d: path(table), tone: "j2" });
  return parts;
}
