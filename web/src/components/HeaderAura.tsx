/**
 * HeaderAura — Wave 35 #13 (2026-05-29) — "Hextech Command Bar"
 *
 * REVAMP. The previous version stacked 14 particles + 3 SVG waves + 3
 * blurred halos — a "florilège d'effets" (per the animation-hero skill:
 * one strong idea beats a juxtaposition of effects), and ~20 always-on
 * compositor layers (the perf cost the web-audit agent flagged).
 *
 * Replaced by ONE brand-tied signature + depth :
 *
 *   1. A single radial glow anchored behind the logo (blue→gold), giving
 *      the bar depth without 3 competing halos. Intensifies subtly when
 *      `scrolled` (the bar condenses → the glow tightens).
 *
 *   2. THE KILL PULSE — a gold→blue hairline along the bottom edge with a
 *      bright surge that travels left→right on a slow cadence: the
 *      heartbeat of the kill feed. This is the signature, tied to the
 *      product (kills = pulses), not a generic particle field.
 *
 * Performance : 2 elements, transform/opacity only, GPU-composited. No
 * will-change pinning. `contain: strict` + pointer-events-none.
 * prefers-reduced-motion → the pulse holds still, the glow stays.
 */
"use client";

export function HeaderAura({ scrolled = false }: { scrolled?: boolean }) {
  return (
    <div
      aria-hidden
      className="header-aura pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* 1. Single anchored depth glow — left-of-logo, blue bleeding to
            gold. Tightens + brightens a touch when the bar condenses. */}
      <div
        className="absolute top-1/2 h-48 w-[42rem] -translate-y-1/2 rounded-full transition-opacity duration-700"
        style={{
          left: "-6rem",
          opacity: scrolled ? 0.5 : 0.32,
          filter: "blur(56px)",
          background:
            "radial-gradient(ellipse 60% 100% at 30% 50%, rgba(0,87,255,0.45), transparent 70%), " +
            "radial-gradient(ellipse 50% 90% at 55% 50%, rgba(200,170,110,0.30), transparent 70%)",
        }}
      />

      {/* 2. THE KILL PULSE — base hairline + a traveling surge. */}
      {/* Static base line (always present, crisp). */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[var(--gold)]/40 to-transparent" />
      {/* The pulse surge that crosses the bar. */}
      <div className="aura-killpulse absolute bottom-0 h-px" />

      {/* Top hextech edge — a constant 1px gold line for the framed feel. */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--gold)]/25 to-transparent" />
    </div>
  );
}
