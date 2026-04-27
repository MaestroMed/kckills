"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { m, AnimatePresence } from "motion/react";

interface ClipEntry {
  /** YouTube 11-char videoId. Omit if using mp4Url instead. */
  videoId?: string;
  /** Direct MP4 URL (e.g. R2 clips.kckills.com). Preferred over videoId
   *  when both are set — no CAPTCHA, no YouTube dependency, CDN-cached. */
  mp4Url?: string;
  /** Optional poster URL for an MP4 clip — shown until the video can play. */
  posterUrl?: string;
  /** Short title shown in the bottom-left overlay */
  title: string;
  /** Context line: "Le Sacre · Game 3" */
  context: string;
  /** How long to play this clip before rotating (ms). Defaults to 15s. */
  durationMs?: number;
  /** Start offset into the video (seconds) — lets us skip intros */
  start?: number;
  /** Volume to play this clip at (0..1) when audio is enabled. Only honored
   *  for mp4Url clips. Defaults to 0.8. */
  audioVolume?: number;
}

interface HeroClipBackgroundProps {
  clips: ClipEntry[];
  /** Fallback poster image while the iframe is loading (must exist in /public). */
  posterSrc?: string;
}

const LS_AUDIO_OPTED = "kc_audio_enabled";

/**
 * Cinematic clip rotator used as the home hero background.
 *
 * - Each clip plays in a full-bleed 16:9 layer sized to always cover the
 *   viewport without black bars.
 * - Rotates to the next clip every N seconds (default 15).
 * - Crossfades via Framer Motion opacity (smooth, no reflow).
 * - Falls back to a static poster while loading or when autoplay fails.
 * - Honors prefers-reduced-motion by freezing on the first clip.
 *
 * Audio (Wave 12 EF) :
 *   - Hero starts muted by default to comply with autoplay policies.
 *   - If the user has opted-in to audio via the wolf player floating UI
 *     (localStorage `kc_audio_enabled === '1'`) AND the current clip is
 *     an `mp4Url` (R2-hosted) clip with `audioVolume > 0`, the hero
 *     unmutes and plays at the clip's specified volume.
 *   - On rotation we briefly fade out (set volume to 0 over 250ms),
 *     swap to the next clip, then fade in to the new clip's volume.
 *   - A small "🔊 Activer le son" button appears bottom-right when audio
 *     is muted AND there's at least one R2 mp4 clip in the rotation
 *     with audioVolume > 0. Clicking it opts the user in (sets the
 *     localStorage flag) and unmutes the hero.
 *
 * Dark overlay + vignette is rendered by the parent — this component only
 * owns the video/image layers.
 */
export function HeroClipBackground({ clips, posterSrc = "/images/hero-bg.jpg" }: HeroClipBackgroundProps) {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [showAudioPrompt, setShowAudioPrompt] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fadeRafRef = useRef<number | null>(null);

  // Respect prefers-reduced-motion
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // 🔴 2026-04-27 mobile crash mitigation Tier 2 :
  // The rotating <video> + iframe combo + AnimatePresence sync overlap
  // hammers iOS Safari memory limits ("Un problème récurrent est
  // survenu" error after ~2 s). On viewports < 768 px we skip the
  // rotation + video element ENTIRELY and render a static poster
  // image. The "wow" cinematic stays for desktop ; mobile users get
  // the same striking poster image but no GPU/memory pressure.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Read the user's audio opt-in flag set by the wolf player.
  useEffect(() => {
    try {
      setAudioEnabled(window.localStorage.getItem(LS_AUDIO_OPTED) === "1");
    } catch {
      /* private mode — keep muted */
    }
    // Watch for changes from the wolf player (same tab, custom event ;
    // cross-tab via the storage event).
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_AUDIO_OPTED) {
        setAudioEnabled(e.newValue === "1");
      }
    };
    const onCustom = () => {
      try {
        setAudioEnabled(window.localStorage.getItem(LS_AUDIO_OPTED) === "1");
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("kc:audio-opted", onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("kc:audio-opted", onCustom as EventListener);
    };
  }, []);

  // Rotation timer — also gated on isMobile per the Tier 2 fix below
  // (no point rotating when the video layer isn't rendered anyway).
  useEffect(() => {
    if (clips.length <= 1 || reducedMotion || isMobile) return;
    const dur = clips[index]?.durationMs ?? 15000;
    timeoutRef.current = window.setTimeout(() => {
      setIndex((prev) => (prev + 1) % clips.length);
    }, dur);
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, [index, clips, reducedMotion, isMobile]);

  // ── Audio fade-in / fade-out across rotations ─────────────────────
  // We don't try to fade between two simultaneous video elements — only
  // one is mounted at a time per the AnimatePresence. The fade is a
  // cheap volume ramp on the new clip after it mounts.
  useEffect(() => {
    const video = videoRef.current;
    const current = clips[index];
    if (!video || !current?.mp4Url) return;

    const targetVolume = current.audioVolume ?? 0.8;
    const wantsAudio = audioEnabled && targetVolume > 0;

    // Cancel any in-flight fade.
    if (fadeRafRef.current !== null) {
      cancelAnimationFrame(fadeRafRef.current);
      fadeRafRef.current = null;
    }

    if (!wantsAudio) {
      video.muted = true;
      video.volume = 0;
      return;
    }

    // Try to unmute and ramp volume.
    video.muted = false;
    video.volume = 0;
    // Re-try play() in case the autoplay-with-sound was rejected — the
    // browser usually accepts the second call right after a click.
    void video.play().catch(() => {
      // Browser refused — fall back to muted (user can click the prompt).
      video.muted = true;
    });

    const start = performance.now();
    const FADE_MS = 250;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / FADE_MS);
      video.volume = targetVolume * t;
      if (t < 1) {
        fadeRafRef.current = requestAnimationFrame(tick);
      } else {
        fadeRafRef.current = null;
      }
    };
    fadeRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (fadeRafRef.current !== null) {
        cancelAnimationFrame(fadeRafRef.current);
        fadeRafRef.current = null;
      }
    };
  }, [index, clips, audioEnabled]);

  // ── "Activer le son" prompt visibility logic ───────────────────────
  // Show when : audio is currently muted AND there's at least one mp4
  // clip in the rotation with audioVolume > 0.
  useEffect(() => {
    if (audioEnabled) {
      setShowAudioPrompt(false);
      return;
    }
    const hasAudibleMp4 = clips.some(
      (c) => c.mp4Url && (c.audioVolume === undefined || c.audioVolume > 0),
    );
    setShowAudioPrompt(hasAudibleMp4);
  }, [audioEnabled, clips]);

  const enableAudio = useCallback(() => {
    try {
      window.localStorage.setItem(LS_AUDIO_OPTED, "1");
      window.dispatchEvent(new CustomEvent("kc:audio-opted"));
    } catch {
      /* private mode — still try to unmute */
    }
    setAudioEnabled(true);
    // Forcibly try to play the current video unmuted now that we have a
    // user gesture in the call stack.
    const video = videoRef.current;
    if (video) {
      video.muted = false;
      void video.play().catch(() => {
        video.muted = true;
      });
    }
  }, []);

  if (clips.length === 0) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={posterSrc}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: 1 }}
      />
    );
  }

  const current = clips[index];
  const wantsAudio = audioEnabled && Boolean(current?.mp4Url) && (current?.audioVolume ?? 0.8) > 0;

  return (
    <>
      {/* Poster stays at full opacity underneath the video so the Sacre
          celebration photo is always visible through the overlay.
          The video rotator is layered on top at 0.85 opacity. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={posterSrc}
        alt=""
        className="hero-poster-breathe absolute inset-0 w-full h-full object-cover"
      />

      {/* 🔴 2026-04-27 mobile crash mitigation Tier 2 :
          Skip the rotating <video> + iframe entirely below 768 px. The
          static `posterSrc` <img> above stays visible at full opacity,
          which gives mobile users the same striking cinematic image
          without the GPU/memory pressure that was killing iOS Safari.
          The desktop "wow" feature (full-bleed clip rotation) is
          preserved for viewports ≥ 768 px. */}
      {!isMobile && (
        <AnimatePresence mode="sync">
          <m.div
            key={`${current.mp4Url ?? current.videoId}-${index}`}
            className="absolute inset-0 overflow-hidden pointer-events-none"
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 0.85, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
          >
            {current.mp4Url ? (
              /* Direct MP4 from R2 — no CAPTCHA, instant CDN-cached playback.
                 Audio honoured if the user has opted in. */
              <video
                ref={videoRef}
                key={current.mp4Url}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                src={current.mp4Url}
                poster={current.posterUrl}
                autoPlay
                muted={!wantsAudio}
                loop
                playsInline
                preload="auto"
              />
            ) : current.videoId ? (
              /* YouTube iframe fallback (may trigger CAPTCHA on low-traffic domains) */
              <iframe
                title={current.title}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                style={{
                  width: "max(100vw, 177.77vh)",
                  height: "max(56.25vw, 100vh)",
                  border: 0,
                }}
                src={`https://www.youtube-nocookie.com/embed/${current.videoId}?autoplay=1&mute=1&loop=1&playlist=${current.videoId}&controls=0&showinfo=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&disablekb=1&fs=0&start=${current.start ?? 0}`}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen={false}
                loading="lazy"
              />
            ) : null}
          </m.div>
        </AnimatePresence>
      )}

      {/* Bottom-left caption for the currently-playing clip */}
      <AnimatePresence mode="wait">
        <m.div
          key={`caption-${index}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="absolute bottom-4 left-4 md:bottom-8 md:left-8 z-20 pointer-events-none max-w-[90vw] md:max-w-md"
        >
          <div className="rounded-xl bg-black/50 backdrop-blur-md border border-[var(--gold)]/25 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              <p className="font-data text-[9px] uppercase tracking-[0.25em] text-white/50">
                En lecture &middot; {current.context}
              </p>
            </div>
            <p className="font-display text-sm md:text-base font-bold text-white leading-tight line-clamp-2">
              {current.title}
            </p>
          </div>
        </m.div>
      </AnimatePresence>

      {/* "Activer le son" prompt — bottom-right, only when relevant */}
      {showAudioPrompt && (
        <button
          type="button"
          onClick={enableAudio}
          aria-label="Activer le son du hero"
          className="absolute bottom-4 right-4 md:bottom-8 md:right-8 z-30 rounded-full border border-[var(--gold)]/40 bg-black/65 backdrop-blur-md px-4 py-2 text-xs font-display font-bold uppercase tracking-widest text-[var(--gold-bright)] hover:border-[var(--gold)] hover:bg-black/80 transition-all"
        >
          <span className="mr-1.5" aria-hidden="true">&#128266;</span>
          Activer le son
        </button>
      )}

      {/* Progress pips — top-right, discrete */}
      {clips.length > 1 && (
        <div className="absolute top-16 right-4 md:top-20 md:right-12 z-20 flex gap-1.5 pointer-events-none">
          {clips.map((_, i) => (
            <span
              key={i}
              className={`h-1 rounded-full transition-all duration-500 ${
                i === index ? "w-8 bg-[var(--gold)]" : "w-1.5 bg-white/30"
              }`}
            />
          ))}
        </div>
      )}
    </>
  );
}
