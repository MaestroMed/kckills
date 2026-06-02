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
 * Wave 36 (2026-05-29) — elevation pass. The single-glow idea was right but
 * read as "barely there" over the full-bleed video hero, so it gained
 * presence without becoming a florilège again:
 *   • the glow now *breathes* (slow scale + opacity, the requested vibe);
 *   • a soft top-down scrim anchors the transparent bar over video (and
 *     lifts legibility / contrast), fading out once the bar is condensed;
 *   • the kill-pulse gained a layered cyan→gold bloom so it reads as a
 *     comet of light, not an invisible hairline.
 *
 * Performance : 3 thin layers, transform/opacity only, GPU-composited.
 * `contain: strict` + pointer-events-none. prefers-reduced-motion → the
 * pulse holds still and the glow stops breathing (both stay visible).
 */
"use client";

export function HeaderAura({ scrolled = false }: { scrolled?: boolean }) {
  return (
    <div
      aria-hidden
      className="header-aura pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* 0. Legibility + presence — a soft top-down scrim so the nav row
            reads cleanly over a bright full-bleed video hero (the bar is
            transparent at the top of the page). Fades out once the bar
            gains its own solid surface on scroll, to avoid double-darkening. */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: scrolled ? 0 : 1,
          background:
            "linear-gradient(to bottom, rgba(1,10,19,0.55) 0%, rgba(1,10,19,0.22) 55%, rgba(1,10,19,0) 100%)",
        }}
      />

      {/* 1. Single anchored depth glow — left-of-logo, blue bleeding to gold.
            Slowly *breathes* (scale + opacity, see .aura-glow) so the bar
            feels alive without a particle field. Tightens + brightens when
            the bar condenses (--glow-base lifts on scroll). */}
      <div
        className="aura-glow absolute top-1/2 h-52 w-[44rem] rounded-full"
        style={
          {
            left: "-7rem",
            filter: "blur(58px)",
            background:
              "radial-gradient(ellipse 58% 100% at 28% 50%, rgba(0,87,255,0.50), transparent 70%), " +
              "radial-gradient(ellipse 48% 90% at 56% 50%, rgba(200,170,110,0.34), transparent 72%)",
            ["--glow-base" as string]: scrolled ? 0.55 : 0.38,
          } as React.CSSProperties
        }
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
