"use client";

import { useEffect, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";

interface ClipEntry {
  /** YouTube 11-char videoId. Omit if using mp4Url instead. */
  videoId?: string;
  /** Direct MP4 URL (e.g. R2 clips.kckills.com). Preferred over videoId
   *  when both are set — no CAPTCHA, no YouTube dependency, CDN-cached. */
  mp4Url?: string;
  /** Short title shown in the bottom-left overlay */
  title: string;
  /** Context line: "Le Sacre · Game 3" */
  context: string;
  /** How long to play this clip before rotating (ms). Defaults to 15s. */
  durationMs?: number;
  /** Start offset into the video (seconds) — lets us skip intros */
  start?: number;
}

interface HeroClipBackgroundProps {
  clips: ClipEntry[];
  /** Fallback poster image while the iframe is loading (must exist in /public). */
  posterSrc?: string;
}

/**
 * Cinematic YouTube clip rotator used as the home hero background.
 *
 * - Each clip plays muted + looped in a full-bleed 16:9 iframe sized
 *   to always cover the viewport without black bars.
 * - Rotates to the next clip every N seconds (default 15).
 * - Crossfades via Framer Motion opacity (smooth, no reflow).
 * - Falls back to a static poster while loading or when autoplay fails.
 * - Honors prefers-reduced-motion by freezing on the first clip.
 *
 * Dark overlay + vignette is rendered by the parent — this component only
 * owns the video/image layers.
 */
export function HeroClipBackground({ clips, posterSrc = "/images/hero-bg.jpg" }: HeroClipBackgroundProps) {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  // Respect prefers-reduced-motion
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Rotation timer
  useEffect(() => {
    if (clips.length <= 1 || reducedMotion) return;
    const dur = clips[index].durationMs ?? 15000;
    timeoutRef.current = window.setTimeout(() => {
      setIndex((prev) => (prev + 1) % clips.length);
    }, dur);
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, [index, clips, reducedMotion]);

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

  return (
    <>
      {/* Poster stays at full opacity underneath the iframe so the Sacre
          celebration photo is always visible through the video overlay.
          The video rotator is layered on top at 0.92 opacity. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={posterSrc}
        alt=""
        className="hero-poster-breathe absolute inset-0 w-full h-full object-cover"
      />

      {/* Stacked iframes crossfading — tuned so the clip feels alive but the
          poster celebration photo underneath still bleeds through around
          the edges and during transitions. */}
      <AnimatePresence mode="sync">
        <m.div
          key={`${current.videoId}-${index}`}
          className="absolute inset-0 overflow-hidden pointer-events-none"
          initial={{ opacity: 0, scale: 1.02 }}
          animate={{ opacity: 0.85, scale: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
        >
          {current.mp4Url ? (
            /* Direct MP4 from R2 — no CAPTCHA, instant CDN-cached playback */
            <video
              key={current.mp4Url}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              src={current.mp4Url}
              autoPlay
              muted
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
