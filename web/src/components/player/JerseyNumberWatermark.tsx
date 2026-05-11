"use client";

import { useEffect, useState } from "react";

/**
 * JerseyNumberWatermark — a giant Space Mono numeral placed behind the
 * active-player hero name as a football-club watermark. Scales from
 * 12rem (mobile) to 26rem (desktop), opacity bound to ~9% so the name
 * reads cleanly on top.
 *
 * Honors prefers-reduced-motion : skips the gentle scale-in animation.
 */
export function JerseyNumberWatermark({
  number,
  accent = "#C8AA6E",
}: {
  number: number;
  accent?: string;
}) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const animClass = reducedMotion
    ? "opacity-[0.1]"
    : "[animation:jerseyWatermarkIn_1.4s_cubic-bezier(0.16,1,0.3,1)_0.2s_both]";

  return (
    <>
      <style jsx>{`
        @keyframes jerseyWatermarkIn {
          0% {
            opacity: 0;
            transform: scale(0.92) translateY(20px);
          }
          100% {
            opacity: 0.11;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
      <div
        aria-hidden
        className={`pointer-events-none absolute left-2 md:left-6 top-[6%] md:top-[8%] z-10 font-data font-black leading-none select-none ${animClass}`}
        style={{
          fontSize: "clamp(11rem, 32vw, 28rem)",
          color: "transparent",
          WebkitTextStroke: `2px ${accent}`,
          letterSpacing: "-0.05em",
          opacity: 0.11,
          filter: `drop-shadow(0 0 60px ${accent}40)`,
        }}
      >
        {String(number).padStart(2, "0")}
      </div>
    </>
  );
}
