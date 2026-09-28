"use client";

import { useEffect, useRef } from "react";

/**
 * Éclair sur la page : quand le ciel des étendards frappe (événement
 * `kckills:lightning`, voir banner-engine), une lueur froide tombe du haut
 * de l'écran, du côté de la frappe, en même temps que le flash sur le tissu.
 * Deux pulsations comme sur les étendards (au plus deux flashs par seconde,
 * WCAG 2.3.1), lueur plafonnée à 14 % et limitée au haut de l'écran.
 * Rien sans étendards 3D (donc rien en reduced-motion ni sur mobile).
 */
export function WeatherFlash() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onStrike = (e: Event) => {
      const { x, strength } = (e as CustomEvent<{ x: number; strength: number }>).detail;
      el.style.setProperty("--flash-x", `${50 + x * 35}%`);
      const peak = 0.14 * Math.min(1, strength);
      el.animate(
        [
          { opacity: 0 },
          { opacity: peak, offset: 0.04 },
          { opacity: peak * 0.2, offset: 0.2 },
          { opacity: peak * 0.55, offset: 0.34 },
          { opacity: 0 },
        ],
        { duration: 900, easing: "ease-out" },
      );
    };
    window.addEventListener("kckills:lightning", onStrike);
    return () => window.removeEventListener("kckills:lightning", onStrike);
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 opacity-0"
      style={{
        background:
          "radial-gradient(70% 55% at var(--flash-x, 50%) 0%, rgba(214,230,255,1), rgba(150,180,255,0.35) 45%, transparent 75%)",
        mixBlendMode: "screen",
      }}
    />
  );
}
