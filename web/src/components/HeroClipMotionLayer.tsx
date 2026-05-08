"use client";

/**
 * HeroClipMotionLayer.tsx — Wave 18 (2026-05-08)
 *
 * Lazy-loaded motion-using layer extracted from HeroClipBackground.tsx
 * to remove `motion/react` from the homepage's initial JS bundle.
 *
 * Architecture
 * ────────────
 * HeroClipBackground (sync, NO motion import) renders the LCP-critical
 * static layers : the poster image, the audio-prompt button, the
 * progress pips. It then mounts THIS component via `next/dynamic({ ssr:
 * false, loading: () => null })`, so motion/react ships only when the
 * user's browser actually mounts the rotating clip overlay (after JS
 * hydration on desktop).
 *
 * Mobile : HeroClipBackground passes `isMobile=true` and we render
 * nothing (the LCP poster img alone owns the hero on phones, per the
 * 2026-04-27 iOS Safari memory-pressure mitigation). The lazy chunk
 * still loads on mobile because next/dynamic doesn't have a built-in
 * "skip on viewport" hook ; the chunk is small (~10-15 KB gzip) and
 * doesn't fire any animations on mobile, so the cost is OK. A future
 * iteration can wrap the dynamic import in a viewport-aware boundary
 * if mobile bundle pressure rises.
 *
 * State boundary
 * ──────────────
 * The motion layer owns :
 *   • The current clip rendering (`<m.div>` + `<video>` / iframe)
 *   • The caption pill (also motion-driven)
 *
 * The PARENT (HeroClipBackground) owns the lifecycle :
 *   • `index` rotation state (timer)
 *   • `audioEnabled` opt-in state
 *   • `videoRef` (for the audio fade effect)
 *
 * Refs cross the boundary via React 19's standard `ref` prop on the
 * <video> element through a callback ref pattern from the parent.
 */

import { type RefCallback } from "react";
import { m, AnimatePresence } from "motion/react";

interface ClipEntry {
  videoId?: string;
  mp4Url?: string;
  posterUrl?: string;
  title: string;
  context: string;
  durationMs?: number;
  start?: number;
  audioVolume?: number;
}

interface HeroClipMotionLayerProps {
  current: ClipEntry;
  index: number;
  wantsAudio: boolean;
  setVideoEl: RefCallback<HTMLVideoElement>;
}

export default function HeroClipMotionLayer({
  current,
  index,
  wantsAudio,
  setVideoEl,
}: HeroClipMotionLayerProps) {
  return (
    <>
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
            <video
              ref={setVideoEl}
              key={current.mp4Url}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              src={current.mp4Url}
              poster={current.posterUrl}
              autoPlay
              muted={!wantsAudio}
              loop
              playsInline
              preload="metadata"
            />
          ) : current.videoId ? (
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

      {/* Bottom-left caption — only when an mp4 (not a YouTube iframe). */}
      <AnimatePresence mode="wait">
        {current.mp4Url && (
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
        )}
      </AnimatePresence>
    </>
  );
}
