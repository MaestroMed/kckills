"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * BCC Vibes Audio Player — plays "Ahou Ahou" OTT Nseven on first visit.
 *
 * Fixes (2026-04-23):
 *   • Was: silent autoplay because Chrome blocks audio on iframe autoplay
 *     even after user gesture if the URL doesn't EXPLICITLY say `mute=0`.
 *     Now: mute=0 + enablejsapi=1 + JS API postMessage to force unMute
 *     after the iframe loads (paranoid path).
 *   • Was: BGM kept playing at full volume when a /scroll clip got
 *     unmuted, audio overlap.
 *     Now: window-level "kc:clip-unmuted" custom event; AudioPlayer
 *     ducks to 25% volume while a clip is unmuted, restores to 100%
 *     when the clip is re-muted.
 *
 * Auto-play flow unchanged:
 * 1. First visit detected via localStorage → "armed".
 * 2. Any user click/key → start playback (legal: piggybacks the gesture).
 * 3. Subsequent visits stay idle by default; manual button to replay.
 */

const STORAGE_KEY = "kckills_bcc_seen";
const YOUTUBE_ID = "YNzvHb92xqY"; // Ahou Ahou — OTT Nseven
const BGM_DUCKED_VOLUME = 25; // % volume while a clip is unmuted
const BGM_FULL_VOLUME = 100;

export function AudioPlayer() {
  const [playing, setPlaying] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [armedForAutoStart, setArmedForAutoStart] = useState(false);
  const [showFirstVisitHint, setShowFirstVisitHint] = useState(false);
  const [ducked, setDucked] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // ─── First-visit detection ───────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        setArmedForAutoStart(true);
        setShowFirstVisitHint(true);
        const t = window.setTimeout(() => setShowFirstVisitHint(false), 6000);
        return () => window.clearTimeout(t);
      }
    } catch {
      // localStorage may be blocked — fail silently
    }
  }, []);

  // ─── First user gesture → start playback ─────────────────────────
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

  // ─── Send a JS API command to the iframe (postMessage) ───────────
  // YouTube IFrame Player API: send commands as JSON {event, func, args}
  // to the iframe's contentWindow. Works only if enablejsapi=1 + an
  // origin allowed by Google (same-origin for our /).
  const sendCommand = useCallback((func: string, args: unknown[] = []) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(
        JSON.stringify({ event: "command", func, args }),
        "*",
      );
    } catch {
      // ignore — postMessage rarely fails but cross-origin can throw
    }
  }, []);

  // ─── Ducking : listen for clip mute toggles ──────────────────────
  // ScrollFeedV2 dispatches `kc:clip-unmuted` (detail: { unmuted: bool })
  // whenever the user toggles mute on the active clip. We respond by
  // ducking the BGM to 25% (still audible but doesn't fight the cast).
  useEffect(() => {
    const onUnmute = (e: Event) => {
      const detail = (e as CustomEvent<{ unmuted: boolean }>).detail;
      if (!detail) return;
      setDucked(detail.unmuted);
    };
    window.addEventListener("kc:clip-unmuted", onUnmute as EventListener);
    return () =>
      window.removeEventListener("kc:clip-unmuted", onUnmute as EventListener);
  }, []);

  // Apply volume to the iframe whenever ducking state OR playing flips.
  useEffect(() => {
    if (!playing) return;
    const target = ducked ? BGM_DUCKED_VOLUME : BGM_FULL_VOLUME;
    sendCommand("setVolume", [target]);
    // Also force unMute — some browsers re-mute the iframe on volume change.
    sendCommand("unMute", []);
  }, [playing, ducked, sendCommand]);

  // After mounting the iframe (post-play-click), force unMute via postMessage
  // as a paranoid safety net in case Chrome's mute=0 URL hint isn't honoured.
  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => {
      sendCommand("unMute", []);
      sendCommand("setVolume", [BGM_FULL_VOLUME]);
      sendCommand("playVideo", []);
    }, 800);
    return () => window.clearTimeout(t);
  }, [playing, sendCommand]);

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

  // mute=0 + enablejsapi=1 are CRITICAL for audio to actually play.
  // Without mute=0 Chrome silently mutes the autoplay even post-gesture.
  const iframeSrc = `https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}?autoplay=1&loop=1&playlist=${YOUTUBE_ID}&controls=0&showinfo=0&rel=0&modestbranding=1&mute=0&enablejsapi=1&playsinline=1`;

  return (
    <>
      {/* Hidden YouTube iframe — only mounted when actually playing */}
      {playing && (
        <iframe
          ref={iframeRef}
          src={iframeSrc}
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
            {/* Audio visualizer bars — fade when ducked */}
            <div className={`flex items-end gap-0.5 h-4 transition-opacity ${ducked ? "opacity-50" : "opacity-100"}`}>
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
              {ducked ? "Ducked" : "Ahou Ahou"}
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

      {showFirstVisitHint && armedForAutoStart && (
        <div className="fixed bottom-24 right-6 z-[90] pointer-events-none animate-pulse max-w-[260px]">
          <div className="rounded-xl border border-[var(--gold)]/40 bg-black/85 backdrop-blur-md px-4 py-3 shadow-2xl shadow-[var(--gold)]/10">
            <p className="font-data text-[10px] uppercase tracking-[0.2em] text-[var(--gold)]/80 mb-1">
              {"\uD83C\uDFB5"} BCC Vibes &middot; first visit
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
