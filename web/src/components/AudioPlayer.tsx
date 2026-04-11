"use client";

import { useState, useRef, useEffect } from "react";

/**
 * BCC Audio Player — plays a YouTube audio on first visit.
 * Uses a hidden YouTube iframe to extract audio.
 * The user can mute/unmute via a floating button.
 */
export function AudioPlayer() {
  const [playing, setPlaying] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Auto-play requires user interaction first (browser policy)
  useEffect(() => {
    const handler = () => {
      setHasInteracted(true);
      window.removeEventListener("click", handler);
      window.removeEventListener("touchstart", handler);
    };
    window.addEventListener("click", handler);
    window.addEventListener("touchstart", handler);
    return () => {
      window.removeEventListener("click", handler);
      window.removeEventListener("touchstart", handler);
    };
  }, []);

  if (dismissed) return null;

  return (
    <>
      {/* Hidden YouTube iframe for audio */}
      {hasInteracted && playing && (
        <iframe
          ref={iframeRef}
          src="https://www.youtube.com/embed/YNzvHb92xqY?autoplay=1&loop=1&playlist=YNzvHb92xqY&controls=0&showinfo=0&rel=0"
          className="hidden"
          allow="autoplay"
          title="BCC Audio"
        />
      )}

      {/* Floating audio control */}
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
        {!playing && !dismissed && (
          <button
            onClick={() => setPlaying(true)}
            className="flex items-center gap-2 rounded-full border border-[var(--gold)]/30 bg-[var(--bg-surface)]/90 backdrop-blur-sm px-4 py-2.5 text-xs font-medium text-[var(--gold)] transition-all hover:bg-[var(--gold)]/10 hover:border-[var(--gold)]/50 hover:shadow-lg hover:shadow-[var(--gold)]/10 animate-pulse"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8.118v3.764a1 1 0 001.555.832l3.197-1.882a1 1 0 000-1.664l-3.197-1.882z" clipRule="evenodd" />
            </svg>
            BCC Vibes
          </button>
        )}

        {playing && (
          <div className="flex items-center gap-1.5 rounded-full border border-[var(--gold)]/30 bg-[var(--bg-surface)]/90 backdrop-blur-sm px-3 py-2">
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
            <button
              onClick={() => { setPlaying(false); setDismissed(true); }}
              className="ml-1 text-[var(--text-muted)] hover:text-[var(--red)] transition-colors"
              aria-label="Couper le son"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes audioBar {
          from { height: 4px; }
          to { height: 16px; }
        }
      `}</style>
    </>
  );
}
