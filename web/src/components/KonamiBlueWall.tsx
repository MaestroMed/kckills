"use client";

import { useEffect, useState, useCallback } from "react";

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

/**
 * Konami Code easter egg — "Blue Wall Mode".
 *
 * Type ↑↑↓↓←→←→BA anywhere on the site to trigger a full-screen
 * Blue Wall flash with the KC chant. Lasts 4 seconds then fades.
 *
 * The Blue Wall is the ultras section of KC fans at live events —
 * 257 fans traveled to Barcelona in December 2021 for the showmatch.
 */
export function KonamiBlueWall() {
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState(0);

  const trigger = useCallback(() => {
    setActive(true);
    setTimeout(() => setActive(false), 4500);
  }, []);

  useEffect(() => {
    let idx = 0;
    let timer: ReturnType<typeof setTimeout>;

    function handler(e: KeyboardEvent) {
      if (e.key === KONAMI[idx]) {
        idx++;
        setProgress(idx);
        clearTimeout(timer);
        timer = setTimeout(() => {
          idx = 0;
          setProgress(0);
        }, 2000);
        if (idx === KONAMI.length) {
          idx = 0;
          setProgress(0);
          trigger();
        }
      } else {
        idx = 0;
        setProgress(0);
      }
    }

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      clearTimeout(timer);
    };
  }, [trigger]);

  if (!active && progress === 0) return null;

  // Progress indicator (subtle, bottom-right)
  if (!active && progress > 0) {
    return (
      <div className="fixed bottom-4 right-4 z-[100] pointer-events-none">
        <div className="flex gap-0.5">
          {KONAMI.map((_, i) => (
            <span
              key={i}
              className={`h-1 w-1 rounded-full transition-colors ${
                i < progress ? "bg-[var(--blue-kc)]" : "bg-white/10"
              }`}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center animate-[fadeIn_0.3s_ease-out]"
      style={{
        background: "radial-gradient(ellipse at center, #0057FF 0%, #003399 50%, #001a4d 100%)",
      }}
    >
      {/* Pulsing rings */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/10"
            style={{
              width: `${i * 20}vw`,
              height: `${i * 20}vw`,
              animation: `pulse ${1.5 + i * 0.3}s ease-in-out infinite`,
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 text-center px-6">
        <p
          className="font-display text-[15vw] md:text-[10vw] font-black text-white leading-none"
          style={{
            textShadow: "0 0 60px rgba(0,87,255,0.8), 0 0 120px rgba(0,87,255,0.4)",
            animation: "scaleIn 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          BLUE WALL
        </p>
        <p
          className="mt-4 font-data text-lg md:text-2xl text-white/80 tracking-[0.3em] uppercase"
          style={{ animation: "fadeIn 0.8s ease-out 0.3s both" }}
        >
          257 &middot; Barcelone &middot; 2021
        </p>
        <p
          className="mt-2 text-sm text-white/50"
          style={{ animation: "fadeIn 1s ease-out 0.6s both" }}
        >
          KC Army forever
        </p>
      </div>

      {/* Auto-fade out */}
      <div
        className="absolute inset-0 bg-black pointer-events-none"
        style={{ animation: "fadeIn 0.5s ease-in 3.5s forwards", opacity: 0 }}
      />
    </div>
  );
}
