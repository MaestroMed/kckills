"use client";

import { useEffect, useRef, useState } from "react";

/**
 * LegendSeal — a gold ornament stamped on alumni pages with a rotating
 * entry animation. Reads "LÉGENDE · {period}" and uses Cinzel-style
 * display typography. Honors prefers-reduced-motion (instant settle).
 *
 * Placed top-left of the alumni hero. ~140 px square at desktop,
 * scales down on mobile.
 */
export function LegendSeal({
  period,
  accent = "#C8AA6E",
}: {
  /** Period string — "2022", "2021-2024", etc. Shown under the seal text. */
  period: string;
  /** Hex color for the seal stroke. Falls back to KC gold. */
  accent?: string;
}) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const animClass = reducedMotion
    ? "opacity-100"
    : "[animation:legendSealEntry_1.2s_cubic-bezier(0.16,1,0.3,1)_both]";

  return (
    <>
      <style jsx>{`
        @keyframes legendSealEntry {
          0% {
            opacity: 0;
            transform: rotate(-25deg) scale(0.55);
          }
          70% {
            opacity: 1;
            transform: rotate(8deg) scale(1.04);
          }
          100% {
            opacity: 1;
            transform: rotate(-6deg) scale(1);
          }
        }
        @keyframes legendSealHaloPulse {
          0%, 100% {
            opacity: 0.65;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.06);
          }
        }
        .seal-halo {
          animation: legendSealHaloPulse 3.4s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .seal-halo {
            animation: none;
          }
        }
      `}</style>
      <div
        ref={ref}
        aria-label={`Legende KC, periode ${period}`}
        className={`relative inline-flex h-[110px] w-[110px] md:h-[150px] md:w-[150px] items-center justify-center select-none pointer-events-none ${animClass}`}
        style={{ transform: "rotate(-6deg)" }}
      >
        {/* Outer rotating halo of micro-rhombuses */}
        <div className="seal-halo absolute inset-0">
          <svg viewBox="0 0 100 100" className="h-full w-full">
            <defs>
              <radialGradient id="legendSealGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={accent} stopOpacity="0.25" />
                <stop offset="60%" stopColor={accent} stopOpacity="0.08" />
                <stop offset="100%" stopColor={accent} stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="48" fill="url(#legendSealGrad)" />
            {/* Tiny diamonds along the outer ring */}
            {Array.from({ length: 12 }).map((_, i) => {
              const angle = (i / 12) * Math.PI * 2;
              const x = 50 + 44 * Math.cos(angle);
              const y = 50 + 44 * Math.sin(angle);
              return (
                <g key={i} transform={`rotate(${(i / 12) * 360} ${x} ${y})`}>
                  <path
                    d={`M${x} ${y - 1.6}L${x + 1.6} ${y}L${x} ${y + 1.6}L${x - 1.6} ${y}Z`}
                    fill={accent}
                    opacity="0.55"
                  />
                </g>
              );
            })}
          </svg>
        </div>

        {/* Inner stamp */}
        <div
          className="relative flex h-[78%] w-[78%] flex-col items-center justify-center rounded-full"
          style={{
            background:
              "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.06), transparent 60%), linear-gradient(135deg, rgba(10,20,40,0.92), rgba(15,29,54,0.95))",
            boxShadow: `0 0 20px ${accent}30, inset 0 0 0 2px ${accent}, inset 0 0 0 4px rgba(0,0,0,0.5), inset 0 0 0 5px ${accent}80`,
          }}
        >
          <span
            className="font-display font-black tracking-[0.18em] text-[10px] md:text-xs leading-none"
            style={{ color: accent }}
          >
            LÉGENDE
          </span>
          <span className="my-1 h-px w-6 md:w-8" style={{ background: accent }} />
          <span
            className="font-data text-[9px] md:text-[10px] uppercase tracking-[0.16em] text-white/85 leading-none"
          >
            {period}
          </span>
          <span
            className="mt-1.5 text-[12px] md:text-[14px] leading-none"
            style={{ color: accent }}
          >
            ◆
          </span>
        </div>
      </div>
    </>
  );
}
