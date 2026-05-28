/**
 * HeaderAura — Wave 35 #9 (2026-05-28)
 *
 * Decorative layered backdrop that sits behind the sticky navbar. Goal :
 * give the site a "mega header" presence with depth and movement
 * without touching any navbar functionality.
 *
 * Layer stack (back → front) :
 *   1. Base : radial wash of bg-primary + subtle blue/gold tints.
 *      Provides depth so the navbar doesn't look pasted on the page.
 *   2. Breathing halos : 2 blurred radial blobs (blue-kc + gold) that
 *      pulse opacity + scale on independent durations. The "aura".
 *   3. Flowing waves : 3 stacked SVG sinusoidal paths translating
 *      horizontally on different durations. Creates the "current of
 *      particles in a long undulated flow" feeling.
 *   4. Particles : 14 floating dots — slow, layered durations so the
 *      motion never repeats visibly. Mix of gold + cyan.
 *   5. Top gold edge : 1px gradient line with a sweeping highlight.
 *
 * Performance :
 *   * `pointer-events-none` + `aria-hidden` — decorative only.
 *   * `contain: strict` so the browser can isolate the layout.
 *   * `transform: translateZ(0)` on animated layers for GPU compositing.
 *   * `@media (prefers-reduced-motion)` disables waves + particles
 *     (handled in globals.css with the .reduced-motion class binding).
 *   * All animations use `transform` / `opacity` only — no layout
 *     thrash, no main-thread work.
 *
 * Used by : components/navbar.tsx (positioned absolutely inside the
 * sticky <nav>, beneath the nav content).
 */
"use client";

export function HeaderAura() {
  return (
    <div
      aria-hidden
      className="header-aura pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* 1. Base radial wash — depth via blue + gold radial tints.
          Kept transparent so the .glass backdrop-blur of the parent
          <nav> shines through instead of getting double-darkened. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 120% at 20% 50%, rgba(0,87,255,0.18), transparent 60%), " +
            "radial-gradient(ellipse 60% 100% at 80% 50%, rgba(200,170,110,0.14), transparent 60%), " +
            "radial-gradient(ellipse 40% 80% at 50% 50%, rgba(10,200,185,0.06), transparent 60%)",
        }}
      />

      {/* 2. Breathing halos — slow opacity + scale pulse on each */}
      <div className="aura-halo aura-halo-blue absolute -left-24 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full" />
      <div className="aura-halo aura-halo-gold absolute -right-20 top-1/2 h-80 w-80 -translate-y-1/2 rounded-full" />
      <div className="aura-halo aura-halo-cyan absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full" />

      {/* 3. Flowing waves — undulating, layered, each with its own phase */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 2400 100"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="aura-grad-gold" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(200,170,110,0)" />
            <stop offset="35%" stopColor="rgba(200,170,110,0.55)" />
            <stop offset="65%" stopColor="rgba(240,230,210,0.7)" />
            <stop offset="100%" stopColor="rgba(200,170,110,0)" />
          </linearGradient>
          <linearGradient id="aura-grad-blue" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(0,87,255,0)" />
            <stop offset="40%" stopColor="rgba(10,200,185,0.4)" />
            <stop offset="60%" stopColor="rgba(0,87,255,0.5)" />
            <stop offset="100%" stopColor="rgba(0,87,255,0)" />
          </linearGradient>
        </defs>

        {/* Wave 1 — gold, top half, fast */}
        <g className="aura-wave aura-wave-1">
          <path
            d="M0,45 Q200,15 400,45 T800,45 T1200,45 T1600,45 T2000,45 T2400,45"
            stroke="url(#aura-grad-gold)"
            strokeWidth="1.1"
            fill="none"
            opacity="0.85"
          />
        </g>

        {/* Wave 2 — blue, middle, medium */}
        <g className="aura-wave aura-wave-2">
          <path
            d="M0,58 Q300,28 600,58 T1200,58 T1800,58 T2400,58"
            stroke="url(#aura-grad-blue)"
            strokeWidth="1.4"
            fill="none"
            opacity="0.7"
          />
        </g>

        {/* Wave 3 — gold ghost, bottom, slow */}
        <g className="aura-wave aura-wave-3">
          <path
            d="M0,72 Q250,52 500,72 T1000,72 T1500,72 T2000,72 T2400,72"
            stroke="url(#aura-grad-gold)"
            strokeWidth="0.7"
            fill="none"
            opacity="0.5"
          />
        </g>
      </svg>

      {/* 4. Particle field — 14 dots with layered durations + delays.
          Positions are pseudo-random but stable (derived from index) so
          SSR + hydration match exactly. */}
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className={`aura-particle ${p.color === "gold" ? "aura-particle-gold" : "aura-particle-cyan"}`}
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}

      {/* 5. Top gold edge — gradient line + sliding highlight */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--gold)]/60 to-transparent" />
      <div className="aura-top-sweep absolute inset-x-0 top-0 h-px" />

      {/* Bottom gold edge — softer, fades into the page */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[var(--gold-dark)]/40 to-transparent" />
    </div>
  );
}

// Deterministic particle layout — same values SSR + client so no
// hydration mismatch. Positions chosen to look organic (no grid pattern)
// while staying spread across the header band.
const PARTICLES: ReadonlyArray<{
  x: number; y: number; size: number; dur: number; delay: number;
  color: "gold" | "cyan";
}> = [
  { x:  6, y: 28, size: 2, dur: 22, delay:  0,   color: "gold" },
  { x: 14, y: 72, size: 1, dur: 18, delay:  3,   color: "cyan" },
  { x: 22, y: 45, size: 3, dur: 28, delay:  1.5, color: "gold" },
  { x: 31, y: 18, size: 1, dur: 16, delay:  5,   color: "cyan" },
  { x: 38, y: 82, size: 2, dur: 24, delay:  2,   color: "gold" },
  { x: 46, y: 35, size: 1, dur: 20, delay:  6,   color: "cyan" },
  { x: 53, y: 65, size: 2, dur: 26, delay:  4,   color: "gold" },
  { x: 61, y: 22, size: 1, dur: 19, delay:  1,   color: "cyan" },
  { x: 68, y: 78, size: 3, dur: 30, delay:  3.5, color: "gold" },
  { x: 75, y: 40, size: 1, dur: 17, delay:  7,   color: "cyan" },
  { x: 82, y: 60, size: 2, dur: 23, delay:  2.5, color: "gold" },
  { x: 88, y: 25, size: 1, dur: 21, delay:  4.5, color: "cyan" },
  { x: 94, y: 70, size: 2, dur: 25, delay:  6.5, color: "gold" },
  { x: 99, y: 45, size: 1, dur: 19, delay:  8,   color: "cyan" },
];
