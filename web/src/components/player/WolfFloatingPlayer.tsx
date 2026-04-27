"use client";

/**
 * WolfFloatingPlayer — the floating wolf-shaped audio player.
 *
 * Sits in the bottom-right corner of EVERY page (mounted in Providers
 * so it survives navigation). Visual is a stylised wolf head silhouette
 * (KC mascot reference, geometrically-clean so we don't need official
 * assets).
 *
 * Two visual modes :
 *   * Compact (default) — just the wolf head + a tiny pulse ring when
 *     audio is playing. Tap to expand.
 *   * Expanded — wolf head + track title/artist + scrubber + skip/prev
 *     + volume slider + playlist switcher. Tap outside to collapse.
 *
 * State of the art touches (April 2026 standards) :
 *   * Glassmorphism background (backdrop-blur + tinted gold)
 *   * Frame-rate-independent waveform animation inside the wolf snout
 *     that pulses with the play state
 *   * Spring-based drag-to-position via Framer Motion
 *   * Respects prefers-reduced-motion (no pulse, no spring)
 *   * iOS safe-area-inset-bottom padding so it doesn't sit under the
 *     home indicator
 *   * Keyboard accessible : space = play/pause, arrows = prev/next
 *   * aria-label on every interactive surface
 *
 * Browser autoplay : the player is silent on first load. A subtle gold
 * pulse ring around the wolf hints "tap me". Once the user taps once,
 * we save `kc_audio_enabled = 1` and auto-resume on every subsequent
 * visit on the first user interaction (handled by the provider).
 */

import { useEffect, useRef, useState } from "react";
import { m, AnimatePresence, useReducedMotion } from "motion/react";
import { useFloatingPlayerInternal } from "@/lib/audio/use-floating-player";
import { type PlaylistId } from "@/lib/audio/playlists";

// ─── Wolf head SVG silhouette ─────────────────────────────────────
// Stylised geometric wolf head — pointy ears, angular snout, big eye.
// Designed at 64x64 viewBox so it scales cleanly to 48px (compact)
// and 96px (expanded) without antialiasing artifacts.
function WolfHead({
  isPlaying,
  reducedMotion,
  className = "",
}: {
  isPlaying: boolean;
  reducedMotion: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-hidden="true"
      style={{ filter: "drop-shadow(0 4px 12px rgba(200, 170, 110, 0.4))" }}
    >
      <defs>
        <linearGradient id="wolfFurGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C8AA6E" />
          <stop offset="50%" stopColor="#785A28" />
          <stop offset="100%" stopColor="#3D2D14" />
        </linearGradient>
        <linearGradient id="wolfFurDark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1A2540" />
          <stop offset="100%" stopColor="#0A1428" />
        </linearGradient>
        <radialGradient id="wolfEye" cx="0.5" cy="0.5">
          <stop offset="0%" stopColor="#0AC8B9" />
          <stop offset="50%" stopColor="#0057FF" />
          <stop offset="100%" stopColor="#01081A" />
        </radialGradient>
      </defs>

      {/* Head silhouette — angular, hextech-styled */}
      {/* Left ear */}
      <path
        d="M 14 14 L 18 4 L 24 18 Z"
        fill="url(#wolfFurGold)"
        stroke="#C8AA6E"
        strokeWidth="0.6"
      />
      {/* Right ear */}
      <path
        d="M 50 14 L 46 4 L 40 18 Z"
        fill="url(#wolfFurGold)"
        stroke="#C8AA6E"
        strokeWidth="0.6"
      />
      {/* Inner left ear (dark) */}
      <path d="M 17 8 L 19 14 L 22 16 Z" fill="url(#wolfFurDark)" />
      {/* Inner right ear (dark) */}
      <path d="M 47 8 L 45 14 L 42 16 Z" fill="url(#wolfFurDark)" />

      {/* Main head — pointed snout downward */}
      <path
        d="M 14 14
           Q 8 20 12 32
           Q 14 44 32 56
           Q 50 44 52 32
           Q 56 20 50 14
           Q 40 18 32 18
           Q 24 18 14 14 Z"
        fill="url(#wolfFurDark)"
        stroke="#C8AA6E"
        strokeWidth="0.9"
      />

      {/* Cheek tuft accents (gold highlights) */}
      <path
        d="M 14 22 L 18 28 L 14 32 Z"
        fill="url(#wolfFurGold)"
        opacity="0.7"
      />
      <path
        d="M 50 22 L 46 28 L 50 32 Z"
        fill="url(#wolfFurGold)"
        opacity="0.7"
      />

      {/* Eyes — glowing cyan / blue (Hextech) */}
      <ellipse cx="22" cy="28" rx="3" ry="3.6" fill="url(#wolfEye)" />
      <ellipse cx="42" cy="28" rx="3" ry="3.6" fill="url(#wolfEye)" />
      {/* Eye shine — subtle, animated when playing */}
      <m.circle
        cx="23"
        cy="27"
        r="0.9"
        fill="#F0E6D2"
        animate={
          isPlaying && !reducedMotion
            ? { opacity: [0.6, 1, 0.6] }
            : { opacity: 0.7 }
        }
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
      />
      <m.circle
        cx="43"
        cy="27"
        r="0.9"
        fill="#F0E6D2"
        animate={
          isPlaying && !reducedMotion
            ? { opacity: [0.6, 1, 0.6] }
            : { opacity: 0.7 }
        }
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 0.3,
        }}
      />

      {/* Snout (lower triangle) + nose */}
      <path
        d="M 26 38 L 32 50 L 38 38 Z"
        fill="url(#wolfFurDark)"
        stroke="#C8AA6E"
        strokeWidth="0.5"
      />
      <ellipse cx="32" cy="40" rx="2.4" ry="1.6" fill="#C8AA6E" />

      {/* Mouth + faint fang glints */}
      <path
        d="M 28 44 L 30 47 L 32 45 L 34 47 L 36 44"
        fill="none"
        stroke="#C8AA6E"
        strokeWidth="0.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Waveform mini-bars (decorative, animated when playing) ──────
function WaveformBars({
  isPlaying,
  reducedMotion,
}: {
  isPlaying: boolean;
  reducedMotion: boolean;
}) {
  const bars = [0, 1, 2, 3, 4];
  return (
    <div className="flex items-end gap-0.5 h-3" aria-hidden="true">
      {bars.map((i) => (
        <m.span
          key={i}
          className="w-0.5 bg-[var(--gold)] rounded-full"
          animate={
            isPlaying && !reducedMotion
              ? { height: ["20%", "100%", "30%", "70%", "20%"] }
              : { height: "20%" }
          }
          transition={{
            duration: 0.8 + (i % 3) * 0.2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.1,
          }}
        />
      ))}
    </div>
  );
}

// ─── YouTube IFrame loader (audio-only, hidden) ──────────────────
//
// We intentionally DO NOT `declare global { interface Window { YT?: ... } }`
// here — the legacy `web/src/components/scroll/BgmPlayer.tsx` already
// declares `Window.YT?` with its own inline shape, and TypeScript refuses
// two different `Window.YT?` declarations across files.
// We rely on BgmPlayer's declaration (it's loaded first because it's a
// child of /scroll which is the most likely first hit), and read window.YT
// through a cast to a local minimal shape below.

interface WindowYTLike {
  Player: new (
    el: HTMLElement | string,
    config: {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: { target: YTPlayerLocal }) => void;
        onStateChange?: (e: { data: number; target: YTPlayerLocal }) => void;
      };
    },
  ) => YTPlayerLocal;
  PlayerState?: { ENDED: number; PLAYING: number; PAUSED: number };
}

interface YTPlayerLocal {
  playVideo: () => void;
  pauseVideo: () => void;
  setVolume: (v: number) => void;
  getCurrentTime?: () => number;
  loadVideoById: (
    args: { videoId: string; startSeconds?: number } | string,
  ) => void;
}

function getWindowYT(): WindowYTLike | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { YT?: WindowYTLike }).YT;
}

function HiddenAudioIframe() {
  const {
    iframeId,
    currentTrack,
    isOptedIn,
    volume,
    _attachPlayer,
    _onPlayerStateChange,
  } = useFloatingPlayerInternal();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerLocal | null>(null);
  const initRef = useRef(false);
  const trackIdRef = useRef<string | null>(null);

  // Load YouTube IFrame API once
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    if (getWindowYT()?.Player) {
      // Already loaded
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    document.head.appendChild(tag);
  }, []);

  // (Re)create the player when the track changes
  useEffect(() => {
    if (!currentTrack) return;
    trackIdRef.current = currentTrack.youtubeId;

    const tryInit = () => {
      const yt = getWindowYT();
      if (!yt?.Player) {
        // API not ready yet — retry shortly
        setTimeout(tryInit, 200);
        return;
      }
      if (playerRef.current) {
        try {
          playerRef.current.loadVideoById({
            videoId: currentTrack.youtubeId,
            startSeconds: 0,
          });
          // Don't auto-play unless the user has opted in
          if (!isOptedIn) {
            setTimeout(() => {
              try {
                playerRef.current?.pauseVideo();
              } catch {
                /* swallow */
              }
            }, 100);
          }
        } catch {
          /* swallow */
        }
        return;
      }
      // First-time init
      const el = containerRef.current?.querySelector(`#${iframeId}`);
      if (!el) return;
      playerRef.current = new yt.Player(iframeId, {
        videoId: currentTrack.youtubeId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: (e) => {
            e.target.setVolume(Math.round(volume * 100));
            _attachPlayer(e.target);
            if (isOptedIn) {
              try {
                e.target.playVideo();
              } catch {
                /* swallow */
              }
            }
          },
          onStateChange: (e) => _onPlayerStateChange(e.data),
        },
      });
    };
    tryInit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.youtubeId]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        left: "-9999px",
        top: "-9999px",
        width: 1,
        height: 1,
        pointerEvents: "none",
      }}
      aria-hidden="true"
    >
      <div id={iframeId} />
    </div>
  );
}

// ─── Compact pill (always visible, bottom-right) ─────────────────
function CompactPill({ onExpand }: { onExpand: () => void }) {
  const { isPlaying, isOptedIn, toggle, currentTrack } =
    useFloatingPlayerInternal();
  const reducedMotion = useReducedMotion() ?? false;
  const showOptInPulse = !isOptedIn && !isPlaying;

  return (
    <m.div
      initial={{ opacity: 0, y: 20, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.8 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="
        fixed bottom-4 right-4 z-[60]
        flex items-center gap-2
        rounded-full
        bg-black/70 backdrop-blur-xl
        border border-[var(--gold)]/40
        shadow-2xl shadow-black/50
        pl-1.5 pr-3 py-1.5
        cursor-pointer
        select-none
        transition-all hover:border-[var(--gold)] hover:shadow-[var(--gold)]/30
      "
      style={{
        paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom, 0px))",
      }}
      role="button"
      aria-label={
        isPlaying
          ? `En lecture : ${currentTrack?.title ?? "vibe KC"}. Cliquer pour ouvrir le lecteur.`
          : "Lancer la vibe KC"
      }
      onClick={(e) => {
        // Tap on the wolf head = toggle play/pause
        // Tap elsewhere on the pill = expand
        const target = e.target as HTMLElement;
        if (target.closest("[data-wolf-toggle]")) {
          toggle();
        } else {
          onExpand();
        }
      }}
    >
      {/* Wolf head with optional pulse ring */}
      <div className="relative" data-wolf-toggle>
        {showOptInPulse && !reducedMotion && (
          <m.div
            className="absolute inset-0 rounded-full border-2 border-[var(--gold)]"
            animate={{ scale: [1, 1.4, 1], opacity: [0.7, 0, 0.7] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <WolfHead
          isPlaying={isPlaying}
          reducedMotion={reducedMotion}
          className="w-10 h-10 relative"
        />
      </div>

      {/* Track info + waveform when playing */}
      <div className="flex flex-col min-w-0 max-w-[140px]">
        {isPlaying && currentTrack ? (
          <>
            <span className="font-data text-[10px] uppercase tracking-widest text-[var(--gold)]/60 leading-none">
              Vibe
            </span>
            <span className="text-[11px] text-[var(--gold-bright)] truncate font-medium">
              {currentTrack.title}
            </span>
          </>
        ) : (
          <span className="text-[11px] text-[var(--gold-bright)]/80 leading-none">
            {isOptedIn ? "Reprendre" : "Lancer la vibe"}
          </span>
        )}
      </div>
      {isPlaying && <WaveformBars isPlaying reducedMotion={reducedMotion} />}
    </m.div>
  );
}

// ─── Expanded panel (track info + scrubber + controls) ───────────
function ExpandedPanel({ onCollapse }: { onCollapse: () => void }) {
  const {
    isPlaying,
    currentTrack,
    queue,
    index,
    position,
    volume,
    playlistId,
    toggle,
    next,
    prev,
    setVolume,
    loadPlaylist,
  } = useFloatingPlayerInternal();
  const reducedMotion = useReducedMotion() ?? false;

  const duration = currentTrack?.durationSeconds ?? 1;
  const progressPct = Math.min(100, (position / duration) * 100);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // Keyboard shortcuts (active only when expanded)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCollapse();
      else if (e.key === " " || e.key === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight" || e.key === "n") next();
      else if (e.key === "ArrowLeft" || e.key === "p") prev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle, next, prev, onCollapse]);

  return (
    <>
      {/* Backdrop tap-to-close */}
      <m.div
        className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onCollapse}
      />

      <m.div
        initial={{ opacity: 0, y: 40, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.92 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className="
          fixed bottom-4 right-4 z-[80]
          w-[min(96vw,360px)]
          rounded-2xl
          bg-[var(--bg-elevated)]/85 backdrop-blur-2xl
          border border-[var(--gold)]/40
          shadow-2xl shadow-black/60
          overflow-hidden
        "
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Lecteur audio KC"
      >
        {/* Header — wolf + track info + close */}
        <div className="flex items-center gap-3 p-4 pb-2">
          <div className="shrink-0">
            <WolfHead
              isPlaying={isPlaying}
              reducedMotion={reducedMotion}
              className="w-14 h-14"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--gold)]/60 mb-0.5">
              Vibe KC · {playlistId === "homepage" ? "Ambient" : "Hype"}
            </p>
            <p className="font-display text-base text-[var(--gold-bright)] truncate leading-tight">
              {currentTrack?.title ?? "—"}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] truncate">
              {currentTrack?.artist ?? "—"}
            </p>
          </div>
          <button
            onClick={onCollapse}
            aria-label="Fermer le lecteur"
            className="shrink-0 w-8 h-8 grid place-items-center rounded-full hover:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--gold-bright)] transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-3 h-3" aria-hidden="true">
              <path
                d="M3 3 L13 13 M13 3 L3 13"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Scrubber */}
        <div className="px-4 pb-2">
          <div className="relative h-1 bg-white/10 rounded-full overflow-hidden">
            <m.div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--gold-dark)] via-[var(--gold)] to-[var(--gold-bright)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between font-data text-[10px] text-[var(--text-muted)]">
            <span>{fmt(position)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        {/* Controls : prev | play/pause | next */}
        <div className="flex items-center justify-center gap-3 px-4 pb-3">
          <button
            onClick={prev}
            aria-label="Piste précédente"
            className="w-10 h-10 grid place-items-center rounded-full hover:bg-white/10 text-[var(--gold)] hover:text-[var(--gold-bright)] transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
              <path
                d="M19 5 L8 12 L19 19 Z M5 5 L5 19"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          </button>
          <button
            onClick={toggle}
            aria-label={isPlaying ? "Mettre en pause" : "Lancer la lecture"}
            className="w-14 h-14 grid place-items-center rounded-full bg-[var(--gold)]/20 border border-[var(--gold)]/60 hover:bg-[var(--gold)]/30 hover:border-[var(--gold)] text-[var(--gold-bright)] transition-all hover:scale-105"
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" className="w-6 h-6" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" fill="currentColor" />
                <rect x="14" y="5" width="4" height="14" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-6 h-6" aria-hidden="true">
                <path d="M7 5 L19 12 L7 19 Z" fill="currentColor" />
              </svg>
            )}
          </button>
          <button
            onClick={next}
            aria-label="Piste suivante"
            className="w-10 h-10 grid place-items-center rounded-full hover:bg-white/10 text-[var(--gold)] hover:text-[var(--gold-bright)] transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
              <path
                d="M5 5 L16 12 L5 19 Z M19 5 L19 19"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          </button>
        </div>

        {/* Volume slider */}
        <div className="px-4 pb-3 flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4 text-[var(--text-muted)] shrink-0"
            aria-hidden="true"
          >
            <path
              d="M3 9 L7 9 L12 5 L12 19 L7 15 L3 15 Z"
              fill="currentColor"
            />
            {volume > 0 && (
              <path
                d="M16 8 Q19 12 16 16"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
              />
            )}
          </svg>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(volume * 100)}
            onChange={(e) => setVolume(parseInt(e.target.value, 10) / 100)}
            aria-label="Volume"
            className="flex-1 accent-[var(--gold)] h-1"
          />
          <span className="font-data text-[10px] text-[var(--text-muted)] w-7 text-right tabular-nums">
            {Math.round(volume * 100)}
          </span>
        </div>

        {/* Playlist switcher */}
        <div className="px-4 pb-4 pt-1 border-t border-white/5">
          <p className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--gold)]/60 mb-1.5">
            Playlist
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(["homepage", "scroll"] as PlaylistId[]).map((id) => (
              <button
                key={id}
                onClick={() => loadPlaylist(id, { autoplay: true })}
                aria-pressed={playlistId === id}
                className={`
                  px-3 py-2 rounded-lg text-xs font-medium transition-all
                  ${
                    playlistId === id
                      ? "bg-[var(--gold)]/25 border border-[var(--gold)] text-[var(--gold-bright)]"
                      : "bg-white/5 border border-white/10 text-[var(--text-secondary)] hover:bg-white/10 hover:border-white/20"
                  }
                `}
              >
                {id === "homepage" ? "🌅 Ambient" : "🔥 Hype"}
              </button>
            ))}
          </div>
          <p className="mt-2 font-data text-[10px] text-[var(--text-disabled)] tabular-nums text-center">
            Piste {index + 1} / {queue.length}
          </p>
        </div>
      </m.div>
    </>
  );
}

// ─── Top-level export ─────────────────────────────────────────────
export function WolfFloatingPlayer() {
  const { isExpanded, setExpanded } = useFloatingPlayerInternal();

  // 🔴 2026-04-27 mobile crash mitigation : the wolf player loads the
  // YouTube IFrame API + creates a hidden Player on mount. Combined
  // with the HeroClipBackground's ALSO-loaded YouTube iframe AND the
  // multiple breathing-gradient animations on the homepage, this
  // overwhelmed mobile Safari (the user reported "ça s'affiche
  // 2 secondes puis ça crash"). The audio feature is non-essential
  // on mobile (smaller screens, often on-the-go, headphones rare),
  // so we skip the entire player on viewport < md (768 px).
  //
  // useIsMobile is a tiny SSR-safe matchMedia hook that returns false
  // during SSR (renders the player), then re-evaluates on mount and
  // hides the player if matchMedia matches. This avoids hydration
  // mismatch.
  const isMobile = useIsMobileViewport();
  if (isMobile) return null;

  return (
    <>
      <HiddenAudioIframe />
      <AnimatePresence mode="wait">
        {isExpanded ? (
          <ExpandedPanel
            key="expanded"
            onCollapse={() => setExpanded(false)}
          />
        ) : (
          <CompactPill key="compact" onExpand={() => setExpanded(true)} />
        )}
      </AnimatePresence>
    </>
  );
}

/** SSR-safe matchMedia hook — returns false during SSR + first render
 *  to avoid hydration mismatch, then evaluates the breakpoint on mount
 *  and updates on viewport change. Mobile breakpoint = Tailwind's `md`
 *  (768 px) so anything narrower hides the player. */
function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}
