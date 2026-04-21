"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { DEFAULT_PLAYLIST, shufflePlaylist, type BgmTrack } from "@/lib/scroll/bgm-playlist";

/**
 * BgmPlayer — background music for /scroll using YouTube IFrame API.
 *
 * Uses hidden <iframe> with the YouTube IFrame Player API (frame-src
 * already allows youtube.com in CSP). No need for Invidious/MP3 hosting.
 *
 * The iframe is positioned offscreen but still loads + plays audio.
 * Volume capped at 15% so it doesn't fight the clip audio.
 */

const BGM_VOLUME = 15; // 0-100 scale (YouTube IFrame API)

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  setVolume: (v: number) => void;
  loadVideoById: (id: string) => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        config: {
          videoId: string;
          height?: string;
          width?: string;
          playerVars?: Record<string, number | string>;
          events?: {
            onReady?: (e: { target: YTPlayer }) => void;
            onStateChange?: (e: { data: number; target: YTPlayer }) => void;
          };
        },
      ) => YTPlayer;
      PlayerState?: { ENDED: number; PLAYING: number; PAUSED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiLoaded = false;
const ytApiCallbacks: (() => void)[] = [];

function loadYouTubeApi(cb: () => void) {
  if (window.YT?.Player) {
    cb();
    return;
  }
  ytApiCallbacks.push(cb);
  if (ytApiLoaded) return;
  ytApiLoaded = true;
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = () => {
    for (const fn of ytApiCallbacks) fn();
    ytApiCallbacks.length = 0;
  };
}

export function BgmPlayer() {
  const [playlist] = useState(() => shufflePlaylist(DEFAULT_PLAYLIST));
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const playerRef = useRef<YTPlayer | null>(null);
  const playerDivRef = useRef<HTMLDivElement | null>(null);

  const current = playlist[currentIdx % playlist.length];

  const next = useCallback(() => {
    setCurrentIdx((i) => (i + 1) % playlist.length);
  }, [playlist.length]);

  const togglePlay = useCallback(() => {
    setHasInteracted(true);
    setPlaying((p) => !p);
  }, []);

  // Init YouTube IFrame Player
  useEffect(() => {
    if (!playerDivRef.current) return;
    loadYouTubeApi(() => {
      if (!window.YT?.Player || !playerDivRef.current) return;
      playerRef.current = new window.YT.Player(playerDivRef.current, {
        videoId: current.youtubeId,
        height: "0",
        width: "0",
        playerVars: {
          autoplay: 0,
          controls: 0,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: (e) => {
            e.target.setVolume(BGM_VOLUME);
          },
          onStateChange: (e) => {
            // 0 = ended → next track
            if (e.data === 0) next();
          },
        },
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Change track
  useEffect(() => {
    if (playerRef.current && current?.youtubeId) {
      playerRef.current.loadVideoById(current.youtubeId);
      playerRef.current.setVolume(BGM_VOLUME);
      if (!playing) playerRef.current.pauseVideo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  // Play/pause
  useEffect(() => {
    if (!playerRef.current) return;
    if (playing) {
      playerRef.current.setVolume(BGM_VOLUME);
      playerRef.current.playVideo();
    } else {
      playerRef.current.pauseVideo();
    }
  }, [playing]);

  // Auto-start on first interaction
  useEffect(() => {
    if (hasInteracted) return;
    const handler = () => {
      setHasInteracted(true);
      setPlaying(true);
    };
    document.addEventListener("pointerdown", handler, { once: true });
    return () => document.removeEventListener("pointerdown", handler);
  }, [hasInteracted]);

  return (
    <>
      {/* Hidden YouTube iframe — positioned offscreen but plays audio */}
      <div
        style={{ position: "fixed", left: "-9999px", top: "-9999px", width: "1px", height: "1px" }}
        aria-hidden
      >
        <div ref={playerDivRef} />
      </div>

      {/* Floating pill — bottom left */}
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
          <p className="text-[10px] font-bold text-[var(--gold)] truncate">{current.title}</p>
          <p className="text-[8px] text-[var(--text-muted)] truncate">{current.artist}</p>
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
