"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "kckills-grid-hint-dismissed";

/**
 * First-visit overlay explaining the grid gestures in one glance. Stored
 * in localStorage so returning users don't see it again.
 */
export function DirectionHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // localStorage can throw in Safari private mode — just show the hint.
    }
    setVisible(true);
    const timer = window.setTimeout(() => dismiss(), 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={dismiss}
      className="absolute inset-x-0 top-1/2 z-20 mx-auto w-fit -translate-y-1/2 rounded-2xl border border-[var(--gold)]/30 bg-black/70 px-5 py-4 text-center backdrop-blur-xl transition-opacity hover:opacity-80"
      aria-label="Fermer le tutoriel"
    >
      <p className="font-display text-sm font-bold text-white mb-2">
        Scroll Vivant
      </p>
      <p className="text-[11px] text-white/70 leading-relaxed">
        Scroll {"\u2190 \u2192"} pour la minute, {"\u2191 \u2193"} pour le joueur.
        <br />
        Swipe en diagonale pour changer d&apos;axe.
      </p>
      <p className="mt-3 text-[9px] uppercase tracking-widest text-[var(--gold)]/70">
        Tap pour fermer
      </p>
    </button>
  );
}
