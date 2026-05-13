"use client";

/**
 * Tiny island that plays a single slice of a clip's audio track.
 *
 * Spawns a hidden <audio> element on demand, seeks to start_ms/1000,
 * starts playback, then pauses at end_ms. Reused across the /quotes
 * grid + the /kill/[id] PHRASES panel.
 *
 * We use <audio> instead of <video> because the only thing we care
 * about is the caster track — playing back the visuals would compete
 * with the parent page's hero video. Browsers happily decode the
 * audio out of an MP4 fed to <audio>, which avoids needing a separate
 * audio-only file on R2.
 *
 * Accessibility :
 *   * The button is focus-visible with the gold ring.
 *   * Reduced-motion is respected (no pulsing icon when playing).
 *   * The button announces "Lecture en cours" via aria-live when
 *     active, so screen readers get feedback that something started.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface QuoteAudioButtonProps {
  clipUrl: string | null;
  startMs: number;
  endMs: number;
  /** Optional aria label override, e.g. quote text excerpt. */
  label?: string;
}

export function QuoteAudioButton({
  clipUrl,
  startMs,
  endMs,
  label,
}: QuoteAudioButtonProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [errored, setErrored] = useState(false);

  // Stop the audio if the component unmounts mid-playback. Without this
  // the audio element would leak and keep playing in the background.
  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) {
        try {
          el.pause();
          el.src = "";
        } catch {
          // ignored
        }
        audioRef.current = null;
      }
    };
  }, []);

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      try {
        el.pause();
      } catch {
        // ignored
      }
    }
    setPlaying(false);
  }, []);

  const start = useCallback(() => {
    if (!clipUrl) return;
    // Create the element lazily so we don't ship a paused <audio> in
    // every QuoteCard before the user interacts.
    let el = audioRef.current;
    if (!el) {
      el = new Audio(clipUrl);
      el.preload = "metadata";
      el.crossOrigin = "anonymous";
      audioRef.current = el;
      el.addEventListener("error", () => {
        setErrored(true);
        setPlaying(false);
      });
      el.addEventListener("ended", () => setPlaying(false));
    }
    const startSec = Math.max(0, startMs / 1000);
    const endSec = Math.max(startSec + 0.2, endMs / 1000);

    const onTimeUpdate = () => {
      if (el!.currentTime >= endSec) {
        el!.pause();
        el!.removeEventListener("timeupdate", onTimeUpdate);
        setPlaying(false);
      }
    };
    el.removeEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("timeupdate", onTimeUpdate);

    const begin = () => {
      try {
        el!.currentTime = startSec;
      } catch {
        // currentTime can throw if metadata isn't ready ; we'll set it
        // again on `loadedmetadata`.
      }
      el!
        .play()
        .then(() => setPlaying(true))
        .catch(() => {
          setErrored(true);
          setPlaying(false);
        });
    };

    if (el.readyState >= 1) {
      begin();
    } else {
      el.addEventListener("loadedmetadata", begin, { once: true });
      // Defensive : force load() so Safari actually fetches metadata.
      try {
        el.load();
      } catch {
        // ignored
      }
    }
  }, [clipUrl, startMs, endMs]);

  if (!clipUrl) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] uppercase tracking-widest text-[var(--text-disabled)]"
        aria-disabled
      >
        <PlayIcon /> Pas d&apos;audio
      </button>
    );
  }

  if (errored) {
    return (
      <button
        type="button"
        onClick={() => {
          setErrored(false);
          start();
        }}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-1.5 text-[11px] uppercase tracking-widest text-[var(--red)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)]"
      >
        <PlayIcon /> Reessayer
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={playing ? stop : start}
      aria-label={
        playing
          ? "Mettre en pause l'extrait audio"
          : `Ecouter${label ? ` : ${label}` : " l'extrait"}`
      }
      aria-live="polite"
      className={[
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] uppercase tracking-widest transition-colors",
        "border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)]",
        playing
          ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold-bright)] motion-safe:animate-pulse"
          : "border-[var(--border-gold)] bg-[var(--bg-elevated)] text-[var(--gold)] hover:border-[var(--gold)]/60 hover:bg-[var(--gold)]/10",
      ].join(" ")}
    >
      {playing ? <PauseIcon /> : <PlayIcon />}
      {playing ? "En cours" : "Ecouter"}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="11"
      height="11"
      aria-hidden
      className="-ml-0.5"
    >
      <path d="M3 2.5v11l11-5.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="11"
      height="11"
      aria-hidden
      className="-ml-0.5"
    >
      <path d="M3 2.5h3v11h-3zm7 0h3v11h-3z" fill="currentColor" />
    </svg>
  );
}
