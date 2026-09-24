/**
 * Dessin de l'étendard, une fois au montage, dans une texture RGBA :
 *   R = masque or (broderie : bordure, filet, logo, losanges)
 *   G = direction des fils / π (0..1) — satin perpendiculaire à la bordure,
 *       point de tige le long du filet, satin à 45° dans le logo
 *   B = relief de la broderie (dôme du satin, logo rembourré plus haut)
 *   A = silhouette en queue d'aronde
 *
 * Le tissage du drap et les fils eux-mêmes sont procéduraux dans le shader
 * (nets à toutes les tailles) : la texture ne porte que le dessin. Flou
 * maison (boîte séparable) plutôt que ctx.filter, absent de certains
 * Safari. Fonctionne sur canvas DOM comme sur OffscreenCanvas.
 */

export interface BannerShape {
  /** Largeur / hauteur physiques (m) : seul le rapport compte ici. */
  width: number;
  height: number;
  /** Hauteur de la pointe de l'encoche, fraction de la hauteur depuis le bas. */
  notch: number;
}

export interface BannerArt {
  width: number;
  height: number;
  data: Uint8Array;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): { c: AnyCanvas; ctx: Ctx } {
  const c: AnyCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = c.getContext("2d", { willReadFrequently: true }) as Ctx | null;
  if (!ctx) throw new Error("canvas 2d indisponible");
  return { c, ctx };
}

function alphaOf(ctx: Ctx, w: number, h: number): Float32Array {
  const src = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = src[i * 4 + 3] / 255;
  return out;
}

function redOf(ctx: Ctx, w: number, h: number): Float32Array {
  const src = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = src[i * 4] / 255;
  return out;
}

/** Flou gaussien approché : trois passes de boîte séparables. */
function blur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius / 1.7));
  const a = Float32Array.from(src);
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1);
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

export async function paintBanner(texW: number, shape: BannerShape, logo: ImageBitmap | HTMLImageElement): Promise<BannerArt> {
  const W = texW;
  const H = Math.round((texW * shape.height) / shape.width);
  const apexY = H * (1 - shape.notch);
  const pts: [number, number][] = [
    [0, 0],
    [W, 0],
    [W, H],
    [W / 2, apexY],
    [0, H],
  ];
  const outline = (ctx: Ctx) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };

  // Proportions de la broderie (en fraction de la largeur).
  const hem = 0.035 * W; // lisière de drap nu
  const band = 0.072 * W; // bordure satin épaisse
  const gap = 0.03 * W;
  const line = 0.013 * W; // filet fin
  const lineIn = hem + band + gap;

  /** Région à une distance [inner, outer] du bord, à l'intérieur de la silhouette. */
  const paintBand = (inner: number, outer: number) => {
    const { c, ctx } = makeCanvas(W, H);
    ctx.save();
    outline(ctx);
    ctx.clip();
    ctx.lineJoin = "miter";
    ctx.miterLimit = 12;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2 * outer;
    outline(ctx);
    ctx.stroke();
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = 2 * inner;
    outline(ctx);
    ctx.stroke();
    ctx.restore();
    return { c, ctx };
  };

  // ── silhouette ──
  const shapeCv = makeCanvas(W, H);
  shapeCv.ctx.fillStyle = "#fff";
  outline(shapeCv.ctx);
  shapeCv.ctx.fill();
  const alpha = alphaOf(shapeCv.ctx, W, H);

  // ── bordure et filet ──
  const bandCv = paintBand(hem, hem + band);
  const lineCv = paintBand(lineIn, lineIn + line);
  const bandMask = alphaOf(bandCv.ctx, W, H);
  const lineMask = alphaOf(lineCv.ctx, W, H);

  // ── logo KC (satin à 45°) ──
  const logoSize = 0.64 * W;
  const logoCx = W / 2;
  const logoCy = 0.46 * H;
  const logoCv = makeCanvas(W, H);
  logoCv.ctx.drawImage(logo as CanvasImageSource, logoCx - logoSize / 2, logoCy - logoSize / 2, logoSize, logoSize);
  const logoMask = alphaOf(logoCv.ctx, W, H);

  // ── losanges Hextech au-dessus et au-dessous du logo, avec leurs filets ──
  const ornCv = makeCanvas(W, H);
  const diamond = (cy: number, r: number) => {
    const ctx = ornCv.ctx;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(W / 2, cy - r * 1.35);
    ctx.lineTo(W / 2 + r, cy);
    ctx.lineTo(W / 2, cy + r * 1.35);
    ctx.lineTo(W / 2 - r, cy);
    ctx.closePath();
    ctx.fill();
    // filets qui partent des pointes
    ctx.fillRect(W / 2 - r * 4.2, cy - line * 0.35, r * 2.6, line * 0.7);
    ctx.fillRect(W / 2 + r * 1.6, cy - line * 0.35, r * 2.6, line * 0.7);
  };
  diamond(0.19 * H, 0.05 * W);
  diamond(0.705 * H, 0.05 * W);
  const ornMask = alphaOf(ornCv.ctx, W, H);

  // ── direction des fils ──
  const angleCv = makeCanvas(W, H);
  const actx = angleCv.ctx;
  const gray = (v: number) => {
    const g = Math.round(Math.min(1, Math.max(0, v)) * 255);
    return `rgb(${g},${g},${g})`;
  };
  // angle UV (u à droite, v vers le haut) d'un vecteur canvas (y vers le bas), ramené dans [0, π)
  const uvAngle = (dx: number, dy: number) => {
    let a = Math.atan2(-dy, dx);
    while (a < 0) a += Math.PI;
    while (a >= Math.PI) a -= Math.PI;
    return a / Math.PI;
  };
  actx.lineCap = "butt";
  actx.save();
  outline(actx);
  actx.clip();
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    // bordure : satin PERPENDICULAIRE au bord
    actx.strokeStyle = gray(uvAngle(-dy, dx));
    actx.lineWidth = 2 * (hem + band + 2);
    actx.beginPath();
    actx.moveTo(x0, y0);
    actx.lineTo(x1, y1);
    actx.stroke();
  }
  actx.restore();
  const angleBand = redOf(actx, W, H);
  actx.clearRect(0, 0, W, H);
  actx.save();
  outline(actx);
  actx.clip();
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    // filet : point de tige LE LONG du bord
    actx.strokeStyle = gray(uvAngle(x1 - x0, y1 - y0));
    actx.lineWidth = 2 * (lineIn + line + 2);
    actx.beginPath();
    actx.moveTo(x0, y0);
    actx.lineTo(x1, y1);
    actx.stroke();
  }
  actx.restore();
  const angleLine = redOf(actx, W, H);

  // ── relief (dôme du satin), en fraction ──
  const reliefBand = blur(bandMask, W, H, band * 0.22);
  const reliefLine = blur(lineMask, W, H, line * 0.45);
  const reliefLogo = blur(logoMask, W, H, 0.012 * W);
  const reliefOrn = blur(ornMask, W, H, 0.008 * W);

  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const b = bandMask[i];
    const l = lineMask[i];
    const g = logoMask[i];
    const o = ornMask[i];
    const gold = Math.max(b, l, g, o);
    let angle = 0.25; // logo : 45°
    if (b >= Math.max(l, g, o)) angle = angleBand[i];
    else if (l >= Math.max(g, o)) angle = angleLine[i];
    else if (o > g) angle = 0; // losanges : satin horizontal
    const relief = Math.max(reliefBand[i] * b, reliefLine[i] * l * 0.6, reliefLogo[i] * g * 1.15, reliefOrn[i] * o * 0.8);
    data[i * 4] = Math.round(gold * 255);
    data[i * 4 + 1] = Math.round(angle * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, relief) * 255);
    data[i * 4 + 3] = Math.round(alpha[i] * 255);
  }
  return { width: W, height: H, data };
}

export async function loadLogo(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`logo ${res.status}`);
  return createImageBitmap(await res.blob());
}
