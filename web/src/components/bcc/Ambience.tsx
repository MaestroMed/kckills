"use client";

/**
 * Ambience — DOM-driven particles drifting across the cave.
 *
 * Two layers :
 *   • embers : 14 tiny warm-glow specks rising slowly from bottom
 *   • smoke  : 6 large diffuse blobs drifting from right to left at the
 *              bottom (pipe-tobacco haze)
 *
 * All particles are <span>s with CSS animations declared in antre.css —
 * we don't drive them through motion/react because the loops run for
 * the full lifetime of the cave and JS-driven animation at that scale
 * trashes the main thread.
 *
 * `prefers-reduced-motion: reduce` returns null — no ambience at all.
 */

import { useMemo } from "react";
import { useReducedMotion } from "motion/react";

export function Ambience() {
  const reduced = useReducedMotion();

  const embers = useMemo(
    () => Array.from({ length: 14 }, () => ({
      left: Math.random() * 100,
      delay: Math.random() * 16,
      duration: 14 + Math.random() * 12,
      size: 2 + Math.random() * 3,
      drift: (Math.random() - 0.5) * 60,
    })),
    [],
  );

  const smoke = useMemo(
    () => Array.from({ length: 6 }, (_, i) => ({
      bottom: 4 + Math.random() * 18,
      delay: i * 4 + Math.random() * 6,
      duration: 22 + Math.random() * 18,
      size: 120 + Math.random() * 100,
    })),
    [],
  );

  if (reduced) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* Embers */}
      {embers.map((e, i) => (
        <span
          key={`ember-${i}`}
          className="absolute rounded-full"
          style={{
            left: `${e.left}%`,
            bottom: -10,
            width: e.size,
            height: e.size,
            background:
              "radial-gradient(circle, rgba(255,216,106,0.95) 0%, rgba(240,193,74,0.6) 40%, transparent 80%)",
            boxShadow: "0 0 8px rgba(255,216,106,0.55)",
            animation: `antreEmberDrift ${e.duration}s linear ${e.delay}s infinite`,
            // small horizontal drift via custom property — applied as
            // translate3d in the keyframe (declared in antre.css using
            // calc-friendly transform via the parent rotation gimmick
            // would be ideal, but we keep it simple : the keyframe
            // already drifts +20px which reads as "smoke rising").
            willChange: "transform, opacity",
            // a tiny per-particle horizontal nudge via translateX as
            // initial offset so the embers don't all rise from the same
            // column even before the keyframe kicks in.
            transform: `translateX(${e.drift}px)`,
          }}
        />
      ))}

      {/* Pipe smoke */}
      {smoke.map((s, i) => (
        <span
          key={`smoke-${i}`}
          className="absolute rounded-full"
          style={{
            right: -200,
            bottom: `${s.bottom}%`,
            width: s.size,
            height: s.size * 0.55,
            background:
              "radial-gradient(ellipse at center, rgba(230,212,168,0.10) 0%, rgba(212,154,74,0.05) 40%, transparent 75%)",
            filter: "blur(18px)",
            animation: `antreSmokeDrift ${s.duration}s ease-out ${s.delay}s infinite`,
            willChange: "transform, opacity",
          }}
        />
      ))}

      {/* Center chandelier glow — a softly flickering radial */}
      <div
        className="absolute antre-candle-light"
        style={{
          top: -120,
          left: "50%",
          transform: "translateX(-50%)",
          width: 600,
          height: 320,
          background:
            "radial-gradient(ellipse, rgba(240,193,74,0.30) 0%, rgba(240,193,74,0.12) 30%, transparent 65%)",
          filter: "blur(8px)",
          willChange: "filter, opacity",
        }}
      />
    </div>
  );
}
