"use client";

/**
 * StageFrame — Wave 36 / desktop wide-stage (≥1024) bounded 9:16 cinema box.
 *
 * ── THE ROOT-CAUSE THIS FIXES ─────────────────────────────────────────
 * On /scroll today no bounded 9:16 stage exists. FeedPlayerPool's <video>
 * is `width:100%; objectFit:contain` inside a `fixed inset-0` root, so on a
 * 1920px desktop the clip is blown edge-to-edge, pickSrc swaps to the 16:9
 * horizontal to fill the void, and the action rail strands at the screen
 * edge. This component builds the FRAME the pool lives inside, so the
 * pool's `width:100%` / `clientHeight` resolve to a real 9:16 box — NOT the
 * viewport. The existing translate3d snap math is reused verbatim (the
 * frame introduces no horizontal offset; the pool stays `absolute inset-0`
 * of THIS box).
 *
 * ── LAYOUT ────────────────────────────────────────────────────────────
 * The center column is `display:grid; place-items:center; block-size:100dvh;
 * padding:24px`. We MEASURE that column (ResizeObserver) and compute the
 * largest 9:16 (or 16:9 in cinema) box that fits inside it, in concrete
 * pixels. The frame's width + height are those pixels — `.scroll-stage`
 * (globals.css) supplies the radius + signature bloom (gold rim + cinematic
 * drop + KC-blue halo).
 *
 * Concrete-px sizing is deliberate: it lets the cinema transition be a SMOOTH
 * Motion spring on the numeric width/height (Motion interpolates px cleanly).
 * Animating `aspect-ratio` / `calc()` / `min()` strings would fall back to a
 * hard cut because Motion can't tween those — so we resolve them to numbers
 * here and tween those instead.
 *
 * ── HERO GOLD TREATMENT ───────────────────────────────────────────────
 * ONE hero gold accent only: the `.border-gold-top` L-bracket + 4×
 * CornerLosange (the VSRoulette recipe) riding the frame, plus the single
 * `.scroll-stage` bloom. BEHIND the frame (the pillarbox fill) a
 * Hextech-native backdrop — a low-opacity static tint + a faint losange
 * lattice + a kill-pulse hairline down one gutter. NEVER a live `blur(60px)`
 * of the video (a GPU-melting SaaS cliché, off-brand).
 *
 * ── CINEMA MODE ───────────────────────────────────────────────────────
 * `cinema` flips the target box 9:16 → 16:9 and Motion springs the numeric
 * width/height. We NEVER use the `layout` prop / AnimatePresence layout
 * animations — domAnimation (the LazyMotion feature set in Providers)
 * excludes them and they CRASH the feed (task #36). Reduced motion → instant.
 *
 * INTERFACE: export function StageFrame({ children, cinema })
 *   children = the FeedPlayerPool subtree (rendered INSIDE the frame).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { m, useReducedMotion, useSpring } from "motion/react";

interface StageFrameProps {
  children: React.ReactNode;
  /** Cinema mode — expand the 9:16 stage to a 16:9 landscape box. */
  cinema?: boolean;
}

const PAD = 24; // padding-block + padding-inline of the center column (px)

export function StageFrame({ children, cinema = false }: StageFrameProps) {
  const reduce = useReducedMotion();
  // Available content box of the center column (column size minus padding).
  const [avail, setAvail] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const colElRef = useRef<HTMLDivElement | null>(null);

  // Measure the column's content box. Done via a CALLBACK ref so the very
  // first attach measures synchronously (no 0-collapse frame), plus a
  // ResizeObserver for the wide-stage grid resolving + window resizes.
  const measure = useCallback((el: HTMLElement) => {
    const w = Math.max(0, el.clientWidth - PAD * 2);
    const h = Math.max(0, el.clientHeight - PAD * 2);
    setAvail((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);

  const setColRef = useCallback(
    (el: HTMLDivElement | null) => {
      colElRef.current = el;
      if (el) measure(el);
    },
    [measure],
  );

  useEffect(() => {
    const el = colElRef.current;
    if (!el) return;
    const onResize = () => measure(el);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onResize);
      ro.observe(el);
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [measure]);

  // Fit the largest AR-correct box inside the available content box.
  const ar = cinema ? 16 / 9 : 9 / 16; // width / height
  const { w: boxW, h: boxH } = fitBox(avail.w, avail.h, ar);

  // Spring the concrete px dimensions via MotionValues bound to `style`.
  // This is the reliable Motion pattern for animating width/height smoothly
  // WITHOUT the `layout` prop (domAnimation excludes it → crash) and WITHOUT
  // relying on `animate` having a baseline (which silently no-ops when the
  // element starts at a 0 box). Reduced-motion → a stiff/critically-damped
  // config that settles in ~1 frame (effectively instant).
  const spring = reduce
    ? { stiffness: 1000, damping: 100, mass: 0.2 }
    : { stiffness: 210, damping: 30, mass: 0.9 };
  const wMv = useSpring(boxW, spring);
  const hMv = useSpring(boxH, spring);
  useEffect(() => {
    // Before the first real measurement, jump (no animation from 0). After,
    // set() so the cinema 9:16↔16:9 change springs.
    if (boxW <= 0 || boxH <= 0) return;
    if (wMv.get() === 0) {
      wMv.jump(boxW);
      hMv.jump(boxH);
    } else {
      wMv.set(boxW);
      hMv.set(boxH);
    }
    // The pool's itemHeight is measured (in ScrollFeedV2) off the feedStage
    // wrapper, which is `absolute inset-0` of THIS frame. When the frame size
    // changes (first measure, window resize, cinema toggle) the pool must
    // re-measure or its <video> height/translate3d math stays anchored to the
    // stale viewport height. ScrollFeedV2 already listens for `resize`, so we
    // nudge it on the next frame once the frame box is committed — this wins
    // the first-paint race between the frame's sizing and the pool's RO read.
    const raf = requestAnimationFrame(() => {
      try {
        window.dispatchEvent(new Event("resize"));
      } catch {
        /* no-op in non-DOM envs */
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [boxW, boxH, wMv, hMv]);

  const measured = boxW > 0 && boxH > 0;

  return (
    // Center column — the parent grid track. place-items:center keeps the
    // frame dead-center horizontally + vertically inside the stage area.
    <div
      ref={setColRef}
      className="relative grid place-items-center overflow-hidden"
      style={{ blockSize: "100dvh", padding: PAD }}
    >
      {/* ── PILLARBOX FILL (behind the frame) — Hextech-native, no live
          blur. A low-opacity static tint + losange lattice + a kill-pulse
          hairline down the right gutter. pointer-events-none so it never
          intercepts the pool's gestures. ───────────────────────────── */}
      <StageBackdrop />

      {/* ── THE FRAME ── the bounded 9:16 (or 16:9 in cinema) hero box.
          The pool root (children) is `absolute inset-0` of THIS element,
          so its width:100% / clientHeight resolve to the frame, NOT the
          viewport — the translate3d snap math is reused verbatim. Width +
          height are spring MotionValues (concrete px) bound to `style`. */}
      <m.div
        className="scroll-stage relative"
        // Width/height come from the spring MotionValues. Before the first
        // measurement (measured=false) we fall back to a CSS 9:16 box sized to
        // the column height so the frame is never a 0-collapse on first paint.
        style={
          measured
            ? { width: wMv, height: hMv }
            : { aspectRatio: "9 / 16", height: "calc(100dvh - 48px)", width: "auto" }
        }
      >
        {/* The pool subtree — lives INSIDE the frame. */}
        {children}

        {/* ── HERO GOLD TREATMENT ── the ONE accent. An L-bracket
            (.border-gold-top = gold top+left 2px) hugging the top-left
            corner, plus 4 corner losanges. ABOVE the pool video but
            pointer-events-none so it never blocks taps. */}
        <span
          aria-hidden
          className="border-gold-top pointer-events-none absolute left-0 top-0 z-[40]"
          style={{
            width: 56,
            height: 56,
            borderTopLeftRadius: "var(--stage-radius)",
          }}
        />
        <CornerLosange position="tl" />
        <CornerLosange position="tr" />
        <CornerLosange position="bl" />
        <CornerLosange position="br" />
      </m.div>
    </div>
  );
}

/** Largest box of aspect ratio `ar` (= width/height) fitting in (availW,
 *  availH). Width-bound when the available box is "wider" than the target,
 *  height-bound otherwise. Returns {0,0} before the column is measured. */
function fitBox(availW: number, availH: number, ar: number): { w: number; h: number } {
  if (availW <= 0 || availH <= 0) return { w: 0, h: 0 };
  const availAr = availW / availH;
  if (availAr > ar) {
    // Column is wider than the target → the box is height-bound.
    const h = availH;
    const w = h * ar;
    return { w, h };
  }
  // Column is taller/narrower → width-bound.
  const w = availW;
  const h = w / ar;
  return { w, h };
}

// ════════════════════════════════════════════════════════════════════
// Pillarbox backdrop — static tint + losange lattice + kill-pulse hairline.
// Hextech-native. NEVER a blur(60px) of the live frame.
// ════════════════════════════════════════════════════════════════════

function StageBackdrop() {
  const reduce = useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      {/* (1) Low-opacity static tint — a faint gold bloom from the top over
          the deep navy floor. Matches the .scroll-hall language so the
          pillarbox reads as part of the same lit hall, never pure black. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(200,170,110,0.05), transparent 60%)",
        }}
      />
      {/* (2) Faint hextech losange lattice — a tiled diamond grid at very
          low opacity. Pure CSS gradients, no image request. */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.05,
          backgroundImage:
            "linear-gradient(45deg, var(--gold) 0.5px, transparent 0.5px)," +
            "linear-gradient(-45deg, var(--gold) 0.5px, transparent 0.5px)",
          backgroundSize: "26px 26px",
          maskImage:
            "radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 85%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 85%)",
        }}
      />
      {/* (3) Kill-pulse hairline down the right gutter — a thin vertical
          gold gradient that breathes (reduced-motion → static). A quiet
          "the hall is alive" signal, not a distraction. */}
      {reduce ? (
        <span
          className="absolute inset-y-[12%] right-6 w-px"
          style={{
            background:
              "linear-gradient(to bottom, transparent, var(--gold), transparent)",
            opacity: 0.3,
          }}
        />
      ) : (
        <m.span
          className="absolute inset-y-[12%] right-6 w-px"
          style={{
            background:
              "linear-gradient(to bottom, transparent, var(--gold), transparent)",
          }}
          animate={{ opacity: [0.18, 0.42, 0.18] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// CornerLosange — VSRoulette recipe (rotate-45 gold diamond) pinned to a
// frame corner. ABOVE the pool, pointer-events-none.
// ════════════════════════════════════════════════════════════════════

function CornerLosange({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  const map: Record<string, string> = {
    tl: "top-2 left-2",
    tr: "top-2 right-2",
    bl: "bottom-2 left-2",
    br: "bottom-2 right-2",
  };
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute z-[40] ${map[position]}`}
      style={{
        width: 8,
        height: 8,
        transform: "rotate(45deg)",
        background: "linear-gradient(135deg, var(--gold-bright), var(--gold))",
        boxShadow: "0 0 10px rgba(200,170,110,0.6)",
      }}
    />
  );
}
