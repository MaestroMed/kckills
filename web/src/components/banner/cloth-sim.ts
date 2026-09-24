/**
 * Simulation de tissu (Verlet + contraintes de distance) pour l'étendard KC.
 *
 * Topologie « queue d'aronde » : la grille est découpée en V sous la pointe
 * de l'encoche, et les sommets de la colonne centrale sont dédoublés sous la
 * pointe, si bien que les deux pans flottent indépendamment (un rectangle
 * plein avec une encoche seulement transparente relierait les deux pans).
 *
 * Vent : force aérodynamique par triangle, quadratique en vitesse relative
 * (F = k·|w|·(w·n)·n·aire), avec un champ turbulent (bruit 3D) qui se
 * déplace avec le vent et des rafales. Pas de collision (un étendard pend
 * dans le vide) ; le bord haut est cousu sur la tringle.
 *
 * Tout est en unités « mètres » : étendard de 0,8 × 1,9 m, gravité 9,81.
 * Le tableau `pos` est partagé tel quel avec l'attribut position de la
 * géométrie (zéro copie par image).
 */

export interface ClothSpec {
  width: number;
  height: number;
  /** Nombre de cellules en largeur (pair : l'axe central est une ligne de grille). */
  cols: number;
  rows: number;
  /** Hauteur de la pointe de l'encoche, en fraction de la hauteur depuis le bas. */
  notch: number;
}

export interface WindState {
  /** Direction moyenne (normalisée à l'usage). */
  dir: [number, number, number];
  /** Vitesse moyenne (m/s). */
  speed: number;
  /** Intensité de la turbulence (fraction de la vitesse). */
  turbulence: number;
  /** Décalage du champ de vent (m) : deux étendards éloignés ne reçoivent pas la même rafale au même instant. */
  offsetX: number;
}

// ─── Bruit de valeur 3D (léger, sans dépendance) ────────────────────────────
function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h & 0xffff) / 0xffff;
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const zf = smooth(z - zi);
  const c000 = hash3(xi, yi, zi);
  const c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi);
  const c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1);
  const c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1);
  const c111 = hash3(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * xf;
  const x10 = c010 + (c110 - c010) * xf;
  const x01 = c001 + (c101 - c001) * xf;
  const x11 = c011 + (c111 - c011) * xf;
  const y0 = x00 + (x10 - x00) * yf;
  const y1 = x01 + (x11 - x01) * yf;
  return (y0 + (y1 - y0) * zf) * 2 - 1; // [-1, 1]
}

export class Cloth {
  readonly spec: ClothSpec;
  readonly count: number;
  readonly pos: Float32Array;
  readonly prev: Float32Array;
  readonly uv: Float32Array;
  readonly index: Uint32Array;
  /** Positions de repos (sur le plan z = 0), pour l'ancrage et le reset. */
  private readonly rest: Float32Array;
  private readonly invMass: Float32Array;
  private readonly acc: Float32Array;
  /** Vent échantillonné par sommet (une fois par image, pas par sous-pas). */
  private readonly windField: Float32Array;
  private readonly cA: Int32Array;
  private readonly cB: Int32Array;
  private readonly cLen: Float32Array;
  private readonly cK: Float32Array;
  private readonly pinned: Int32Array;
  private readonly tris: Uint32Array;
  /** 1 / masse d'un sommet (tissu léger, 0,2 kg/m², aire d'un triangle de grille). */
  private readonly massInv: number;

  gravity = 9.81;
  /** Coefficient aérodynamique global (réglé par balayage : ~12° d'inclinaison moyenne à 1,2 m/s). */
  drag = 0.2;
  damping = 0.992;
  iterations = 8;
  /** Angle de balancement de la tringle autour de son point d'attache (rad). */
  rodAngle = 0;

  constructor(spec: ClothSpec) {
    this.spec = spec;
    const { width: W, height: H, cols, rows, notch } = spec;
    const half = cols / 2;
    // Une cellule (i, j) est dans l'encoche si ses quatre coins le sont.
    const insideNotch = (u: number, v: number) => v < notch && Math.abs(u - 0.5) < 0.5 * (1 - v / notch) - 1e-6;
    const cellKept = (i: number, j: number) => {
      const corners: [number, number][] = [
        [i, j],
        [i + 1, j],
        [i, j + 1],
        [i + 1, j + 1],
      ];
      return !corners.every(([ci, cj]) => insideNotch(ci / cols, 1 - cj / rows));
    };

    // Sommets : (i, j, side) ; side = 1 pour la copie droite de la colonne centrale sous la pointe.
    const map = new Map<string, number>();
    const px: number[] = [];
    const puv: number[] = [];
    const key = (i: number, j: number, s: number) => `${i},${j},${s}`;
    const vertexOf = (i: number, j: number, rightCell: boolean) => {
      const v = 1 - j / rows;
      const split = i === half && v < notch;
      const s = split && rightCell ? 1 : 0;
      const k = key(i, j, s);
      let id = map.get(k);
      if (id === undefined) {
        id = px.length / 3;
        map.set(k, id);
        px.push(-W / 2 + (i / cols) * W, -(j / rows) * H, 0);
        puv.push(i / cols, v);
      }
      return id;
    };

    const tri: number[] = [];
    const edges = new Map<string, [number, number]>();
    const addEdge = (a: number, b: number) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!edges.has(k)) edges.set(k, [a, b]);
    };
    const shear: [number, number][] = [];
    // Grille des sommets utilisés, pour les contraintes de flexion. Seuls les
    // sommets dédoublés (colonne centrale sous la pointe) dépendent du côté :
    // au-dessus de la pointe, la flexion traverse l'axe central (sinon le
    // tissu y plierait comme une charnière).
    const grid = new Map<string, number>();
    const gridKey = (i: number, j: number, side: number) =>
      `${i},${j},${i === half && 1 - j / rows < notch ? side : 0}`;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (!cellKept(i, j)) continue;
        const right = i >= half;
        const a = vertexOf(i, j, right);
        const b = vertexOf(i + 1, j, right);
        const c = vertexOf(i, j + 1, right);
        const d = vertexOf(i + 1, j + 1, right);
        for (const [gi, gj, id] of [
          [i, j, a],
          [i + 1, j, b],
          [i, j + 1, c],
          [i + 1, j + 1, d],
        ] as const) {
          grid.set(gridKey(gi, gj, right ? 1 : 0), id);
        }
        // face avant vers +z (caméra)
        tri.push(a, c, b, b, c, d);
        addEdge(a, b);
        addEdge(a, c);
        addEdge(b, d);
        addEdge(c, d);
        shear.push([a, d], [b, c]);
      }
    }
    const ek = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    const bendSet = new Set<string>();
    for (const side of [0, 1]) {
      for (let j = 0; j <= rows; j++) {
        for (let i = 0; i <= cols; i++) {
          const a = grid.get(gridKey(i, j, side));
          if (a === undefined) continue;
          const h1 = grid.get(gridKey(i + 1, j, side));
          const h2 = grid.get(gridKey(i + 2, j, side));
          // les deux arêtes de la chaîne doivent exister (pas de pont par-dessus l'encoche)
          if (h1 !== undefined && h2 !== undefined && edges.has(ek(a, h1)) && edges.has(ek(h1, h2))) bendSet.add(ek(a, h2));
          const v1 = grid.get(gridKey(i, j + 1, side));
          const v2 = grid.get(gridKey(i, j + 2, side));
          if (v1 !== undefined && v2 !== undefined && edges.has(ek(a, v1)) && edges.has(ek(v1, v2))) bendSet.add(ek(a, v2));
        }
      }
    }

    const bend = [...bendSet].map((k) => k.split("_").map(Number) as [number, number]);

    this.count = px.length / 3;
    this.pos = new Float32Array(px);
    this.prev = new Float32Array(px);
    this.rest = new Float32Array(px);
    this.uv = new Float32Array(puv);
    this.index = new Uint32Array(tri);
    this.tris = this.index;
    this.acc = new Float32Array(this.count * 3);
    this.windField = new Float32Array(this.count * 3);
    this.massInv = 1 / ((W / cols) * (H / rows) * 0.5 * 0.2);
    this.invMass = new Float32Array(this.count).fill(1);

    const pins: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (Math.abs(this.rest[i * 3 + 1]) < 1e-6) {
        pins.push(i);
        this.invMass[i] = 0;
      }
    }
    this.pinned = new Int32Array(pins);

    const all: [number, number, number][] = [
      ...[...edges.values()].map(([a, b]) => [a, b, 1] as [number, number, number]),
      ...shear.map(([a, b]) => [a, b, 0.7] as [number, number, number]),
      ...bend.map(([a, b]) => [a, b, 0.18] as [number, number, number]),
    ];
    this.cA = new Int32Array(all.map((c) => c[0]));
    this.cB = new Int32Array(all.map((c) => c[1]));
    this.cK = new Float32Array(all.map((c) => c[2]));
    this.cLen = new Float32Array(all.length);
    for (let k = 0; k < all.length; k++) {
      const a = this.cA[k] * 3;
      const b = this.cB[k] * 3;
      this.cLen[k] = Math.hypot(px[b] - px[a], px[b + 1] - px[a + 1], px[b + 2] - px[a + 2]);
    }
  }

  /**
   * Échantillonne le champ de vent (moyen + turbulence qui voyage avec lui)
   * sur chaque sommet. Une fois par image : le bruit est le poste le plus cher.
   */
  sampleWind(t: number, wind: WindState): void {
    const { pos, windField } = this;
    const dl = Math.hypot(wind.dir[0], wind.dir[1], wind.dir[2]) || 1;
    const bx = (wind.dir[0] / dl) * wind.speed;
    const by = (wind.dir[1] / dl) * wind.speed;
    const bz = (wind.dir[2] / dl) * wind.speed;
    const turb = wind.speed * wind.turbulence;
    const adv = t * 1.4;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      const qx = (pos[o] + wind.offsetX) * 1.3 - adv;
      const qy = pos[o + 1] * 1.3;
      const qz = pos[o + 2] * 1.3 + t * 0.35;
      windField[o] = bx + turb * noise3(qx, qy, qz);
      windField[o + 1] = by + turb * 0.35 * noise3(qx + 31.7, qy, qz);
      windField[o + 2] = bz + turb * noise3(qx, qy + 17.3, qz + 5.1);
    }
  }

  /** Un pas de simulation (dt fixe, en secondes). Appeler sampleWind() avant, une fois par image. */
  step(dt: number): void {
    const { pos, prev, acc, invMass, tris, windField } = this;
    const n = this.count;
    acc.fill(0);
    for (let i = 0; i < n; i++) acc[i * 3 + 1] = -this.gravity;

    // ── vent : force par triangle ──
    const inv = 1 / dt;
    for (let k = 0; k < tris.length; k += 3) {
      const a = tris[k] * 3;
      const b = tris[k + 1] * 3;
      const c = tris[k + 2] * 3;
      const e1x = pos[b] - pos[a];
      const e1y = pos[b + 1] - pos[a + 1];
      const e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a];
      const e2y = pos[c + 1] - pos[a + 1];
      const e2z = pos[c + 2] - pos[a + 2];
      // normale non normalisée (|N| = 2 × aire)
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl < 1e-9) continue;
      const wx = (windField[a] + windField[b] + windField[c]) / 3;
      const wy = (windField[a + 1] + windField[b + 1] + windField[c + 1]) / 3;
      const wz = (windField[a + 2] + windField[b + 2] + windField[c + 2]) / 3;
      // vitesse du triangle (Verlet : (pos - prev) / dt)
      const vx = ((pos[a] - prev[a] + pos[b] - prev[b] + pos[c] - prev[c]) / 3) * inv;
      const vy = ((pos[a + 1] - prev[a + 1] + pos[b + 1] - prev[b + 1] + pos[c + 1] - prev[c + 1]) / 3) * inv;
      const vz = ((pos[a + 2] - prev[a + 2] + pos[b + 2] - prev[b + 2] + pos[c + 2] - prev[c + 2]) / 3) * inv;
      const rx = wx - vx;
      const ry = wy - vy;
      const rz = wz - vz;
      const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
      // F = k·|r|·(r·n̂)·n̂·aire ; n̂ = N/nl, aire = nl/2 → F = k·|r|·(r·N)·N/(2·nl)
      const s = (this.drag * rl * (rx * nx + ry * ny + rz * nz)) / (2 * nl);
      // un tiers de la force par sommet, divisé par la masse d'un sommet
      const fx = (s * nx * this.massInv) / 3;
      const fy = (s * ny * this.massInv) / 3;
      const fz = (s * nz * this.massInv) / 3;
      acc[a] += fx;
      acc[a + 1] += fy;
      acc[a + 2] += fz;
      acc[b] += fx;
      acc[b + 1] += fy;
      acc[b + 2] += fz;
      acc[c] += fx;
      acc[c + 1] += fy;
      acc[c + 2] += fz;
    }

    // ── intégration de Verlet ──
    const dt2 = dt * dt;
    const damp = this.damping;
    for (let i = 0; i < n; i++) {
      if (invMass[i] === 0) continue;
      const o = i * 3;
      for (let d = 0; d < 3; d++) {
        const p = pos[o + d];
        const v = (p - prev[o + d]) * damp;
        prev[o + d] = p;
        pos[o + d] = p + v + acc[o + d] * dt2;
      }
    }

    // ── ancrage sur la tringle (qui se balance autour de son centre) ──
    this.applyPins();

    // ── contraintes ──
    const { cA, cB, cLen, cK } = this;
    const m = cA.length;
    for (let it = 0; it < this.iterations; it++) {
      for (let k = 0; k < m; k++) {
        const a = cA[k] * 3;
        const b = cB[k] * 3;
        const wa = invMass[cA[k]];
        const wb = invMass[cB[k]];
        const ws = wa + wb;
        if (ws === 0) continue;
        const dx = pos[b] - pos[a];
        const dy = pos[b + 1] - pos[a + 1];
        const dz = pos[b + 2] - pos[a + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-9) continue;
        const diff = ((len - cLen[k]) / (len * ws)) * cK[k];
        pos[a] += dx * diff * wa;
        pos[a + 1] += dy * diff * wa;
        pos[a + 2] += dz * diff * wa;
        pos[b] -= dx * diff * wb;
        pos[b + 1] -= dy * diff * wb;
        pos[b + 2] -= dz * diff * wb;
      }
    }
  }

  applyPins(): void {
    const cos = Math.cos(this.rodAngle);
    const sin = Math.sin(this.rodAngle);
    const { pos, prev, rest, pinned } = this;
    for (let k = 0; k < pinned.length; k++) {
      const o = pinned[k] * 3;
      const x = rest[o];
      const y = rest[o + 1];
      pos[o] = x * cos - y * sin;
      pos[o + 1] = x * sin + y * cos;
      pos[o + 2] = 0;
      prev[o] = pos[o];
      prev[o + 1] = pos[o + 1];
      prev[o + 2] = 0;
    }
  }

  /** Laisse le tissu se poser (évite l'étendard « planche » à la première image). */
  settle(seconds: number, wind: WindState, dt = 1 / 120): void {
    for (let t = 0; t < seconds; t += dt) {
      this.sampleWind(t, wind);
      this.step(dt);
    }
  }
}
