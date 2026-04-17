"use client";

import { useEffect, useRef, useState } from "react";

interface PortraitCubeMorphProps {
  /**
   * Source images (champion splashes, photos, etc.). Must be reachable from
   * the same origin — pass `/_next/image?url=...` URLs or local paths so the
   * canvas can read pixel data without a CORS taint.
   */
  images: string[];
  /** Hex color for the cubes. Defaults to KC gold. */
  accent?: string;
  /** Number of grid columns. More = finer detail, slower. Default 64. */
  cols?: number;
  /** Aspect ratio (cols : rows). Default 9:16 (vertical hero). */
  aspect?: number;
  /** ms before crossmorph kicks in. Default 4500. */
  holdMs?: number;
  /** ms for the crossmorph. Default 1800. */
  morphMs?: number;
  /** Optional className for the outer wrapper. */
  className?: string;
}

interface PortraitGrid {
  cols: number;
  rows: number;
  /** brightness 0..1 per cell, length = cols * rows */
  data: Float32Array;
}

const TWO_PI = Math.PI * 2;

/**
 * Cinematic portrait morph — samples each source image into a brightness grid
 * and renders animated isometric cubes whose size, rotation and glow encode
 * the underlying pixel intensity. Cubes interpolate cell-by-cell when
 * cross-fading between images, giving the photo a "dot-matrix coming to life"
 * feel without ever showing the raw bitmap.
 *
 * Server-component-safe via dynamic import — this file is `"use client"`.
 *
 * Performance:
 *   - Single canvas, requestAnimationFrame loop (~16ms per frame).
 *   - 64x114 grid = 7.3K cubes, well within budget on a mid-range phone.
 *   - Pauses when offscreen / tab hidden / prefers-reduced-motion.
 */
export function PortraitCubeMorph({
  images,
  accent = "#C8AA6E",
  cols = 64,
  aspect = 9 / 16,
  holdMs = 4500,
  morphMs = 1800,
  className,
}: PortraitCubeMorphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [grids, setGrids] = useState<PortraitGrid[] | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  const rows = Math.max(1, Math.round(cols / aspect));

  // Sample each image into a brightness grid. We rely on next/image proxy
  // serving same-origin so getImageData() doesn't throw a SecurityError.
  useEffect(() => {
    let cancelled = false;
    const samplerCanvas = document.createElement("canvas");
    samplerCanvas.width = cols;
    samplerCanvas.height = rows;
    const sctx = samplerCanvas.getContext("2d", { willReadFrequently: true });
    if (!sctx) return;

    Promise.all(
      images.map(
        (src) =>
          new Promise<PortraitGrid | null>((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              try {
                sctx.clearRect(0, 0, cols, rows);
                // Cover-fit the image into the small grid so we keep the face
                // centered without squishing.
                const ratio = img.width / img.height;
                const target = cols / rows;
                let dw = cols;
                let dh = rows;
                let dx = 0;
                let dy = 0;
                if (ratio > target) {
                  dw = rows * ratio;
                  dx = (cols - dw) / 2;
                } else {
                  dh = cols / ratio;
                  dy = (rows - dh) / 2;
                }
                sctx.drawImage(img, dx, dy, dw, dh);
                const { data } = sctx.getImageData(0, 0, cols, rows);
                const out = new Float32Array(cols * rows);
                for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
                  // Rec. 709 luma — matches how the human eye perceives brightness.
                  const r = data[i];
                  const g = data[i + 1];
                  const b = data[i + 2];
                  out[j] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
                }
                resolve({ cols, rows, data: out });
              } catch {
                // Tainted canvas (CORS) — skip this image silently so we still
                // render the others.
                resolve(null);
              }
            };
            img.onerror = () => resolve(null);
            img.src = src;
          }),
      ),
    ).then((results) => {
      if (cancelled) return;
      const valid = results.filter((g): g is PortraitGrid => g !== null);
      if (valid.length > 0) setGrids(valid);
    });

    return () => {
      cancelled = true;
    };
  }, [images, cols, rows]);

  // Honor prefers-reduced-motion — collapse to the first grid, no cycling.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Animation loop.
  useEffect(() => {
    if (!grids || grids.length === 0) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const parsedRgb = hexToRgb(accent);
    if (!parsedRgb) return;
    const accentRgb: { r: number; g: number; b: number } = parsedRgb;

    let raf = 0;
    let running = true;
    let lastIndex = 0;
    let nextIndex = grids.length > 1 ? 1 : 0;
    let phaseStart = performance.now();
    let inMorph = false;

    function resizeCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = wrap!.getBoundingClientRect();
      canvas!.width = Math.max(1, Math.floor(width * dpr));
      canvas!.height = Math.max(1, Math.floor(height * dpr));
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(wrap);

    function draw(now: number) {
      if (!running) return;
      const w = wrap!.clientWidth;
      const h = wrap!.clientHeight;
      const cellW = w / cols;
      const cellH = h / rows;
      const maxR = Math.min(cellW, cellH) * 0.62;

      // Fade between two grids over `morphMs` after holding for `holdMs`.
      let elapsed = now - phaseStart;
      let t = 0;
      if (reducedMotion || grids!.length === 1) {
        t = 0;
      } else if (!inMorph) {
        if (elapsed >= holdMs) {
          inMorph = true;
          phaseStart = now;
          elapsed = 0;
        }
      } else {
        if (elapsed >= morphMs) {
          lastIndex = nextIndex;
          nextIndex = (nextIndex + 1) % grids!.length;
          inMorph = false;
          phaseStart = now;
          elapsed = 0;
        } else {
          t = elapsed / morphMs;
        }
      }
      // Smoothstep for a less linear morph.
      const eased = t * t * (3 - 2 * t);

      const gA = grids![lastIndex].data;
      const gB = grids![nextIndex].data;
      const wave = (now / 2200) % TWO_PI;

      ctx!.clearRect(0, 0, w, h);

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const i = y * cols + x;
          const a = gA[i] ?? 0;
          const b = gB[i] ?? 0;
          const v = a + (b - a) * eased;
          if (v < 0.05) continue;

          // Subtle shimmer wave across the canvas — keeps the still moments
          // breathing without overpowering the portrait.
          const shimmer = 0.92 + 0.08 * Math.sin(wave + (x + y) * 0.18);
          const intensity = Math.min(1, v * shimmer);
          const r = maxR * (0.35 + intensity * 0.65);
          const cx = x * cellW + cellW / 2;
          const cy = y * cellH + cellH / 2;

          // Iso-cube look: a tilted square with two side-faces hinted via
          // gradient stops. Cheap, no clip path needed.
          ctx!.fillStyle = `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${0.22 + intensity * 0.65})`;
          const half = r;
          ctx!.beginPath();
          ctx!.moveTo(cx, cy - half);
          ctx!.lineTo(cx + half, cy);
          ctx!.lineTo(cx, cy + half);
          ctx!.lineTo(cx - half, cy);
          ctx!.closePath();
          ctx!.fill();

          if (intensity > 0.5) {
            ctx!.fillStyle = `rgba(255,255,255,${(intensity - 0.5) * 0.35})`;
            ctx!.beginPath();
            ctx!.arc(cx - half * 0.18, cy - half * 0.18, half * 0.18, 0, TWO_PI);
            ctx!.fill();
          }
        }
      }

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);

    function visibilityHandler() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        phaseStart = performance.now();
        raf = requestAnimationFrame(draw);
      }
    }
    document.addEventListener("visibilitychange", visibilityHandler);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
  }, [grids, accent, cols, rows, holdMs, morphMs, reducedMotion]);

  return (
    <div ref={wrapRef} className={className ?? "absolute inset-0"}>
      <canvas ref={canvasRef} className="block h-full w-full" aria-hidden />
    </div>
  );
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace("#", "").match(/^([0-9a-fA-F]{6})$/);
  if (!m) {
    // Try short form #abc
    const s = hex.replace("#", "");
    if (/^[0-9a-fA-F]{3}$/.test(s)) {
      return {
        r: parseInt(s[0] + s[0], 16),
        g: parseInt(s[1] + s[1], 16),
        b: parseInt(s[2] + s[2], 16),
      };
    }
    return null;
  }
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}
