"use client";

/**
 * Le son de la Chambre : une nappe d'angoisse (lecteur YouTube caché, plus
 * oppressante à chaque palier) et un cœur synthétisé (heartbeat.ts) qui
 * s'emballe avec la profondeur. Monté au geste « Descendre » (autoplay
 * permis), un seul bouton coupe les deux. Le lecteur global (loup) se tait
 * sur /chambre (use-floating-player).
 */

import { useEffect, useRef, useState } from "react";
import { Heartbeat } from "./heartbeat";

/** Paliers d'angoisse par profondeur — tous vérifiés intégrables (test d'embed). */
const DREAD_TIERS: readonly { maxDepth: number; id: string }[] = [
  { maxDepth: 3, id: "CDWtH8eHeEU" }, // malaise — Dark & Mysterious Ambient
  { maxDepth: 6, id: "APfszb7_y7Y" }, // dread — Beyond the Veil (Lovecraftian)
  { maxDepth: 8, id: "sEsWTHdaCQI" }, // oppression — Edge of Unbeing
  { maxDepth: 10, id: "73pRh2dx0JU" }, // terreur — Somatic Horror Drone (L'Enfer)
];

function trackForDepth(d: number): string {
  return (DREAD_TIERS.find((t) => d <= t.maxDepth) ?? DREAD_TIERS[DREAD_TIERS.length - 1]).id;
}

interface YTPlayer {
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  playVideo(): void;
  loadVideoById(id: string): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    cfg: {
      videoId: string;
      height: string;
      width: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number; target: YTPlayer }) => void;
      };
    },
  ) => YTPlayer;
}

let ytApiPromise: Promise<void> | null = null;
function loadYTApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const w = window as unknown as { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve) => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const iv = window.setInterval(() => {
      if (w.YT?.Player) {
        window.clearInterval(iv);
        resolve();
      }
    }, 200);
  });
  return ytApiPromise;
}

export function ChamberAudio({ depth, bpm, active }: { depth: number; bpm: number; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const heartRef = useRef<Heartbeat | null>(null);
  const trackRef = useRef<string>("");
  const [ready, setReady] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const soundOnRef = useRef(true);
  const depthRef = useRef(depth);
  useEffect(() => {
    soundOnRef.current = soundOn;
    depthRef.current = depth;
  }, [soundOn, depth]);

  const stress = Math.min(1, depth / 10);
  const volume = Math.round((0.4 + stress * 0.55) * 100); // 40 → 95

  // Le lecteur et le cœur naissent au « Descendre » (vrai geste utilisateur).
  useEffect(() => {
    if (!active) return;
    const heart = new Heartbeat();
    heart.start();
    heartRef.current = heart;
    let cancelled = false;
    void loadYTApi().then(() => {
      if (cancelled || !hostRef.current || playerRef.current) return;
      const w = window as unknown as { YT?: YTNamespace };
      if (!w.YT) return;
      const first = trackForDepth(depthRef.current);
      trackRef.current = first;
      playerRef.current = new w.YT.Player(hostRef.current, {
        videoId: first,
        height: "120",
        width: "200",
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, loop: 1, playlist: first },
        events: {
          onReady: (e) => {
            try {
              e.target.setVolume(40);
              if (soundOnRef.current) e.target.unMute();
              else e.target.mute();
              e.target.playVideo();
            } catch {
              /* swallow */
            }
            setReady(true);
          },
          onStateChange: (e) => {
            if (e.data === 0) {
              try {
                e.target.playVideo();
              } catch {
                /* swallow */
              }
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
      heart.stop();
      heartRef.current = null;
      try {
        playerRef.current?.destroy();
      } catch {
        /* swallow */
      }
      playerRef.current = null;
    };
  }, [active]);

  // Le cœur suit la profondeur.
  useEffect(() => {
    heartRef.current?.setBpm(bpm);
    heartRef.current?.setVolume(0.28 + stress * 0.3);
  }, [bpm, stress]);

  // Changement de palier : nouvelle nappe.
  useEffect(() => {
    if (!ready || !playerRef.current) return;
    const want = trackForDepth(depth);
    if (want === trackRef.current) return;
    trackRef.current = want;
    try {
      playerRef.current.loadVideoById(want);
      playerRef.current.setVolume(volume);
      if (!soundOnRef.current) playerRef.current.mute();
    } catch {
      /* swallow */
    }
  }, [depth, ready, volume]);

  useEffect(() => {
    if (!ready || !playerRef.current) return;
    try {
      playerRef.current.setVolume(volume);
    } catch {
      /* swallow */
    }
  }, [volume, ready]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    heartRef.current?.setMuted(!next);
    try {
      if (next) {
        playerRef.current?.unMute();
        playerRef.current?.playVideo();
      } else {
        playerRef.current?.mute();
      }
    } catch {
      /* swallow */
    }
  };

  if (!active) return null;
  return (
    <>
      {/* Lecteur caché : seul son audio atteint l'utilisateur. */}
      <div aria-hidden style={{ position: "fixed", left: -9999, top: 0, pointerEvents: "none", opacity: 0 }}>
        <div ref={hostRef} />
      </div>
      <button
        type="button"
        onClick={toggleSound}
        aria-label={soundOn ? "Couper le son" : "Activer le son"}
        aria-pressed={soundOn}
        className="fixed bottom-4 left-4 z-[95] flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/75 backdrop-blur-sm transition-colors hover:border-[var(--red)] hover:text-[var(--red)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--red)]"
      >
        {soundOn ? (
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M11 5L6 9H2v6h4l5 4V5z" />
          </svg>
        ) : (
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
          </svg>
        )}
      </button>
    </>
  );
}
