"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * BCC Vibes Audio Player — plays "Ahou Ahou" OTT Nseven on first visit.
 *
 * Auto-play flow:
 * 1. On mount, we check localStorage for "kckills_bcc_seen". If not seen,
 *    this is a first visit — we "arm" the player so any user interaction
 *    (click anywhere on the page) immediately starts playback.
 * 2. On subsequent visits, the player stays idle by default. The user can
 *    manually click the floating "BCC Vibes" button to replay.
 * 3. Browsers block autoplay with sound without a prior user gesture, so
 *    we piggyback on the first click anywhere. This is legal and UX-friendly.
 *
 * Source: YouTube iframe with autoplay=1 + loop. Hidden from view, audio only.
 */

const STORAGE_KEY = "kckills_bcc_seen";
const YOUTUBE_ID = "YNzvHb92xqY"; // Ahou Ahou — OTT Nseven

export function AudioPlayer() {
  const [playing, setPlaying] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [armedForAutoStart, setArmedForAutoStart] = useState(false);
  const [showFirstVisitHint, setShowFirstVisitHint] = useState(false);

  // On mount: detect first visit
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        setArmedForAutoStart(true);
        setShowFirstVisitHint(true);
        // Hide the hint after 6 seconds even if user hasn't clicked yet
        const t = window.setTimeout(() => setShowFirstVisitHint(false), 6000);
        return () => window.clearTimeout(t);
      }
    } catch {
      // localStorage may be blocked (strict privacy mode) — fail silently
    }
  }, []);

  // First user gesture triggers auto-play on first visit
  useEffect(() => {
    if (!armedForAutoStart) return;

    const fire = () => {
      setPlaying(true);
      setShowFirstVisitHint(false);
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // ignore
      }
      setArmedForAutoStart(false);
    };

    const onClick = () => fire();
    const onKey = (e: KeyboardEvent) => {
      // Any key except modifiers
      if (!e.ctrlKey && !e.metaKey && !e.altKey) fire();
    };

    window.addEventListener("click", onClick, { once: true });
    window.addEventListener("touchstart", onClick, { once: true });
    window.addEventListener("keydown", onKey, { once: true });

    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("touchstart", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [armedForAutoStart]);

  const handleManualPlay = useCallback(() => {
    setPlaying(true);
    setShowFirstVisitHint(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setPlaying(false);
    setDismissed(true);
  }, []);

  if (dismissed) return null;

  return (
    <>
      {/* Hidden YouTube iframe — only mounted when actually playing */}
      {playing && (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}?autoplay=1&loop=1&playlist=${YOUTUBE_ID}&controls=0&showinfo=0&rel=0&modestbranding=1`}
          className="fixed -top-96 -left-96 w-1 h-1 opacity-0 pointer-events-none"
          allow="autoplay; encrypted-media"
          title="BCC Audio"
          aria-hidden="true"
        />
      )}

      {/* Floating control — bottom-right */}
      <div className="fixed bottom-6 right-6 z-[90] flex items-center gap-2">
        {!playing && (
          <button
            onClick={handleManualPlay}
            className="group flex items-center gap-2 rounded-full border border-[var(--gold)]/30 bg-black/70 backdrop-blur-md px-4 py-2.5 text-xs font-bold text-[var(--gold)] transition-all hover:bg-[var(--gold)]/15 hover:border-[var(--gold)]/60 hover:shadow-lg hover:shadow-[var(--gold)]/20"
          >
            <svg className="h-4 w-4 transition-transform group-hover:scale-110" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8.118v3.764a1 1 0 001.555.832l3.197-1.882a1 1 0 000-1.664l-3.197-1.882z"
                clipRule="evenodd"
              />
            </svg>
            <span className="tracking-widest uppercase">BCC Vibes</span>
          </button>
        )}

        {playing && (
          <div className="flex items-center gap-1.5 rounded-full border border-[var(--gold)]/30 bg-black/70 backdrop-blur-md px-3 py-2.5">
            {/* Audio visualizer bars */}
            <div className="flex items-end gap-0.5 h-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="w-0.5 bg-[var(--gold)] rounded-full"
                  style={{
                    animation: `audioBar 0.${4 + i}s ease-in-out infinite alternate`,
                    height: `${8 + i * 3}px`,
                  }}
                />
              ))}
            </div>
            <span className="text-[9px] font-bold text-[var(--gold)] uppercase tracking-widest ml-1">
              Ahou Ahou
            </span>
            <button
              onClick={handleDismiss}
              className="ml-1 text-white/50 hover:text-[var(--red)] transition-colors"
              aria-label="Couper le son"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* First visit hint — only shown until user clicks anywhere */}
      {showFirstVisitHint && armedForAutoStart && (
        <div className="fixed bottom-24 right-6 z-[90] pointer-events-none animate-pulse max-w-[260px]">
          <div className="rounded-xl border border-[var(--gold)]/40 bg-black/85 backdrop-blur-md px-4 py-3 shadow-2xl shadow-[var(--gold)]/10">
            <p className="font-data text-[10px] uppercase tracking-[0.2em] text-[var(--gold)]/80 mb-1">
              🎵 BCC Vibes &middot; first visit
            </p>
            <p className="text-xs text-white/85 leading-snug">
              Clique n&apos;importe ou sur le site pour lancer
              <span className="text-[var(--gold)] font-bold"> &laquo; Ahou Ahou &raquo; OTT Nseven</span>.
            </p>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes audioBar {
          from { height: 4px; }
          to { height: 16px; }
        }
      `}</style>
    </>
  );
}
