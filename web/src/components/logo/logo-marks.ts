/**
 * Pistes de logo KCKILLS (labo, 28/09/2026) — marques ORIGINALES qui
 * reprennent les codes de la KC et de Pentakill (symétrie métal, lames,
 * le chiffre cinq, losanges Hextech) sans reprendre leurs logos, qui
 * appartiennent à Karmine Corp et à Riot Games.
 *
 * Géométrie calculée en code (viewBox 512×512) : chaque marque est une liste
 * de pièces { d, tone }. Le même tracé sert au SVG 2D (favicon, header, OG)
 * et à l'extrusion 3D du labo.
 */

export type Tone = "goldLight" | "goldDark" | "gem" | "plate";
export interface LogoPart {
  d: string;
  tone: Tone;
}
export interface LogoConcept {
  id: "ecu" | "face" | "eclats";
  letter: "A" | "B" | "C";
  name: string;
  idea: string;
  parts: LogoPart[];
}

type P = [number, number];

const path = (pts: P[]) => `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")} Z`;
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const unit = (a: P): P => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};
const perp = (a: P): P => [-a[1], a[0]];

/** Losange (éclat) entre deux pointes a et b, demi-largeur hw au milieu. Deux facettes. */
function shard(a: P, b: P, hw: number): LogoPart[] {
  const m = mul(add(a, b), 0.5);
  const n = mul(perp(unit(sub(b, a))), hw);
  const left = add(m, n);
  const right = sub(m, n);
  return [
    { d: path([a, left, b]), tone: "goldLight" },
    { d: path([a, b, right]), tone: "goldDark" },
  ];
}

/** Lame : barre de a à b, largeur w, pointes effilées de longueur ta / tb. Deux facettes (arête centrale). */
function blade(a: P, b: P, w: number, ta: number, tb: number): LogoPart[] {
  const u = unit(sub(b, a));
  const n = mul(perp(u), w / 2);
  const tipA = sub(a, mul(u, ta));
  const tipB = add(b, mul(u, tb));
  return [
    { d: path([tipA, add(a, n), add(b, n), tipB]), tone: "goldLight" },
    { d: path([tipA, tipB, sub(b, n), sub(a, n)]), tone: "goldDark" },
  ];
}

function gem(c: P, rx: number, ry: number): LogoPart[] {
  return [
    { d: path([[c[0], c[1] - ry], [c[0] + rx, c[1]], [c[0], c[1] + ry]]), tone: "gem" },
    { d: path([[c[0], c[1] - ry], [c[0], c[1] + ry], [c[0] - rx, c[1]]]), tone: "gem" },
  ];
}

// ─── A · L'Écu ──────────────────────────────────────────────────────────────
function ecu(): LogoPart[] {
  const c: P = [256, 272];
  const ang = (i: number) => ((-90 + i * 72) * Math.PI) / 180;
  const at = (r: number, i: number): P => [c[0] + r * Math.cos(ang(i)), c[1] + r * Math.sin(ang(i))];
  const outer = [0, 1, 2, 3, 4].map((i) => at(196, i));
  const inner = [0, 1, 2, 3, 4].map((i) => at(166, i));
  const parts: LogoPart[] = [];
  // anneau or (facettes : moitié haute claire, moitié basse sombre)
  for (let i = 0; i < 5; i++) {
    const j = (i + 1) % 5;
    parts.push({ d: path([outer[i], outer[j], inner[j], inner[i]]), tone: i === 0 || i === 4 ? "goldLight" : "goldDark" });
  }
  parts.push({ d: path(inner), tone: "plate" });
  // cinq pointes, une par sommet : les cinq kills
  for (let i = 0; i < 5; i++) {
    const dir: P = [Math.cos(ang(i)), Math.sin(ang(i))];
    const t = perp(dir);
    const base = at(190, i);
    const tip = at(246, i);
    parts.push({ d: path([add(base, mul(t, 17)), tip, base]), tone: "goldLight" });
    parts.push({ d: path([base, tip, sub(base, mul(t, 17))]), tone: "goldDark" });
  }
  // K taillé en lames
  parts.push(...blade([212, 196], [212, 352], 42, 34, 34));
  parts.push(...blade([238, 270], [326, 180], 38, 0, 24));
  parts.push(...blade([246, 284], [326, 366], 38, 0, 24));
  parts.push(...gem([236, 276], 14, 20));
  return parts;
}

// ─── B · Face-à-face ────────────────────────────────────────────────────────
function face(): LogoPart[] {
  const parts: LogoPart[] = [];
  // deux fûts en lame (les deux K), pointes en haut et en bas
  parts.push(...blade([112, 168], [112, 344], 38, 70, 70));
  parts.push(...blade([400, 168], [400, 344], 38, 70, 70));
  // les bras des deux K se rejoignent : un grand losange Hextech
  const L: P = [134, 256];
  const R: P = [378, 256];
  const T: P = [256, 118];
  const B: P = [256, 394];
  parts.push(...blade(L, T, 30, 0, 26));
  parts.push(...blade(L, B, 30, 0, 26));
  parts.push(...blade(R, T, 30, 0, 26));
  parts.push(...blade(R, B, 30, 0, 26));
  parts.push(...gem([256, 256], 40, 56));
  return parts;
}

// ─── C · Cinq éclats ───────────────────────────────────────────────────────
function eclats(): LogoPart[] {
  return [
    ...shard([176, 52], [176, 246], 40), // fût haut
    ...shard([176, 266], [176, 460], 40), // fût bas
    ...shard([264, 234], [412, 64], 36), // bras haut
    ...shard([264, 278], [412, 448], 36), // bras bas
    ...gem([240, 256], 22, 32), // cœur
  ];
}

export const LOGO_CONCEPTS: LogoConcept[] = [
  { id: "ecu", letter: "A", name: "L'Écu", idea: "Blason pentagonal, cinq pointes pour les cinq kills, K taillé en lames.", parts: ecu() },
  { id: "face", letter: "B", name: "Face-à-face", idea: "Deux K se font face ; leurs bras dessinent un losange Hextech. Symétrie de logo métal.", parts: face() },
  { id: "eclats", letter: "C", name: "Cinq éclats", idea: "Un K fait de cinq éclats de gemme Hextech : un par kill.", parts: eclats() },
];
