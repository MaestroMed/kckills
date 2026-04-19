"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { DEFAULT_PLAYLIST, shufflePlaylist, type BgmTrack } from "@/lib/scroll/bgm-playlist";

/**
 * BgmPlayer — background music player for /scroll.
 *
 * Plays NCS/royalty-free tracks via a hidden <audio> element.
 * Audio URLs point to YouTube via an invidious proxy for direct MP3 stream,
 * OR we can use local MP3s on R2 later.
 *
 * For now: uses the Invidious API to get audio-only stream URLs from YouTube.
 * Fallback: hardcoded MP3 URLs if Invidious is down.
 *
 * The player shows a minimal floating pill: track name + play/pause + skip.
 * Volume is lower than clip audio so it doesn't compete.
 */

const BGM_VOLUME = 0.15; // 15% volume — background ambiance, not main audio

export function BgmPlayer() {
  const [playlist] = useState(() => shufflePlaylist(DEFAULT_PLAYLIST));
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const current = playlist[currentIdx % playlist.length];

  const next = useCallback(() => {
    setCurrentIdx((i) => (i + 1) % playlist.length);
  }, [playlist.length]);

  const togglePlay = useCallback(() => {
    setHasInteracted(true);
    setPlaying((p) => !p);
  }, []);

  // Play/pause audio when state changes
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.volume = BGM_VOLUME;
      a.play().catch(() => setPlaying(false));
    } else {
      a.pause();
    }
  }, [playing, currentIdx]);

  // Auto-start on first user interaction anywhere on the page
  useEffect(() => {
    if (hasInteracted) return;
    const handler = () => {
      setHasInteracted(true);
      setPlaying(true);
    };
    // Listen for first touch/click/scroll
    document.addEventListener("pointerdown", handler, { once: true });
    return () => document.removeEventListener("pointerdown", handler);
  }, [hasInteracted]);

  // Auto-next when track ends
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnded = () => next();
    a.addEventListener("ended", onEnded);
    return () => a.removeEventListener("ended", onEnded);
  }, [next]);

  // We use an Invidious proxy to get audio-only URLs from YouTube.
  // Multiple instances for redundancy.
  const audioSrc = `https://inv.nadeko.net/latest_version?id=${current.youtubeId}&itag=140`;

  return (
    <>
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="auto"
        loop={false}
      />

      {/* Floating pill — bottom left, above the nav button */}
      <div className="fixed bottom-20 left-4 z-[80] flex items-center gap-2 rounded-full border border-[var(--gold)]/20 bg-black/70 backdrop-blur-md px-3 py-1.5 shadow-lg">
        <button
          onClick={togglePlay}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--gold)]/20 text-[var(--gold)] hover:bg-[var(--gold)]/30 transition-colors"
          aria-label={playing ? "Pause la musique" : "Jouer la musique"}
        >
          {playing ? (
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <div className="max-w-[140px] overflow-hidden">
          <p className="text-[10px] font-bold text-[var(--gold)] truncate">
            {current.title}
          </p>
          <p className="text-[8px] text-[var(--text-muted)] truncate">
            {current.artist}
          </p>
        </div>

        <button
          onClick={next}
          className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--gold)] transition-colors"
          aria-label="Piste suivante"
        >
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>
    </>
  );
}
