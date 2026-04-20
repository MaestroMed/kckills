"use client";

/**
 * FeedPlayerPool — 5 <video> elements that follow the active feed item.
 *
 * The HARDEST piece of /scroll-v2. If this works, the rest of the
 * TikTok-native experience falls into place. If it doesn't, we drop
 * back to the v1 per-item video model.
 *
 * Key design choices:
 *
 * 1. The <video> elements are mounted ONCE at this component's render
 *    and never destroyed. Their src + position change as the active
 *    item shifts. We avoid React re-mounting because every <video>
 *    creation = ~30ms compositor work + a media element decoder
 *    spin-up that's wasted if we re-mount on every scroll tick.
 *
 * 2. Positioning is done via absolute positioning + CSS transform
 *    (translate3d) — NOT React portals into per-item slots. Portals
 *    work but cost a React commit cycle per slot reassignment, which
 *    is too expensive at 60Hz scroll. Direct DOM positioning via
 *    transform stays compositor-only.
 *
 * 3. Each video sits at a "lane" matching its slot index. The viewport
 *    measures item heights to position lanes precisely on the active
 *    item or its neighbours. The visible <FeedItem> renders an empty
 *    placeholder div of the same size, so the layout matches.
 *
 * 4. For Phase 1 we use `<video src={mp4}>`. Phase 4 swaps in HLS via
 *    a useHlsPlayer adapter that attaches hls.js or relies on Safari
 *    native, but the pool-shape doesn't change.
 *
 * Phase 1 contract — what this component takes / produces:
 *
 *   props:
 *     items[]       — full feed
 *     activeIndex   — currently visible item
 *     itemHeight    — measured viewport height in px
 *     muted         — global mute state
 *     useLowQuality — adaptive bitrate hint
 *     onError       — reports a broken src so feed can drop the item
 *     reducedMotion — disables haptics in the autoplay
 *
 *   imperative side-effects:
 *     - Plays the LIVE-priority slot, pauses everything else
 *     - Loads warm slots aggressively (preload=auto)
 *     - Keeps cold slots at preload=metadata
 */

import { useEffect, useMemo, useRef } from "react";
import { useMotionValue, useMotionValueEvent, type MotionValue } from "framer-motion";
import {
  POOL_SIZE,
  useFeedPlayer,
  type SlotPriority,
} from "./hooks/useFeedPlayer";
import { useHlsAttach } from "./hooks/useHlsAttach";

export interface PoolItem {
  /** Stable id used for telemetry + autoplay decisions. */
  id: string;
  /** Vertical 9:16 mp4 — Phase 1 source AND HLS fallback. */
  clipVertical: string;
  /** 360p fallback for slow networks. */
  clipVerticalLow: string | null;
  /** 16:9 horizontal mp4 — used on desktop for landscape clips. */
  clipHorizontal: string | null;
  /** Poster frame shown before the first video frame paints. */
  thumbnail: string | null;
  /** HLS master playlist URL (Phase 4). When present, the pool
   *  attaches via hls.js (Chrome/Firefox) or native (Safari) for
   *  adaptive bitrate. NULL falls back to the MP4 chain above. */
  hlsMasterUrl?: string | null;
}

interface Props {
  items: PoolItem[];
  activeIndex: number;
  /** Pixel height of one feed item — i.e. the viewport. */
  itemHeight: number;
  muted: boolean;
  useLowQuality: boolean;
  isDesktop: boolean;
  reducedMotion: boolean;
  onError: (itemId: string, src: string) => void;
  /** Optional: tells the active video element to start from 0 the very
   *  first time it activates (fixes the "first clip frozen" bug we
   *  shipped on /scroll v1). Defaults true. */
  resetOnFirstPlay?: boolean;
  /** When the parent uses gesture-driven scrolling (Phase 2+), pass the
   *  motion value carrying the container's translateY so the pool can
   *  keep its videos in lockstep with the drag — every video element's
   *  transform stays anchored to its item position even mid-flick. */
  containerY?: MotionValue<number>;
}

export function FeedPlayerPool({
  items,
  activeIndex,
  itemHeight,
  muted,
  useLowQuality,
  isDesktop,
  reducedMotion,
  onError,
  resetOnFirstPlay = true,
  containerY,
}: Props) {
  const { slotItemIndex, priorities } = useFeedPlayer({
    activeIndex,
    totalItems: items.length,
  });

  /** One ref per slot — stable for the lifetime of the pool. */
  const videoRefs = useRef<(HTMLVideoElement | null)[]>(
    Array.from({ length: POOL_SIZE }, () => null),
  );

  /** Has slot N ever played? — used to skip the "seek to 0" race that
   *  stalled play() on cold loads in v1. Only seek when the slot has
   *  been played before AND is now being reused for a new item. */
  const hasPlayedRef = useRef<boolean[]>(
    Array.from({ length: POOL_SIZE }, () => false),
  );

  /** Track the previous itemIndex bound to each slot so we can detect
   *  reassignment and reset hasPlayed accordingly. */
  const prevSlotItemRef = useRef<number[]>([...slotItemIndex]);

  /** HLS adapter — lazy-loads hls.js on first non-Safari attach. */
  const { attachHlsTo } = useHlsAttach();

  /** Sync mute state across all 5 elements when shared mute toggles. */
  useEffect(() => {
    for (const v of videoRefs.current) {
      if (v) v.muted = muted;
    }
  }, [muted]);

  /** Main effect: react to slot assignments + priority changes.
   *  Run play/pause/preload commands and update src as needed. */
  useEffect(() => {
    if (items.length === 0) return;
    for (let s = 0; s < POOL_SIZE; s++) {
      const v = videoRefs.current[s];
      if (!v) continue;
      const itemIdx = slotItemIndex[s];
      const prevItemIdx = prevSlotItemRef.current[s];

      // Slot unbound → hide and pause.
      if (itemIdx === -1) {
        v.pause();
        v.style.opacity = "0";
        continue;
      }

      const item = items[itemIdx];
      if (!item) continue;
      const priority = priorities[s];

      // Did this slot just take a new item? Update src (HLS-aware) + reset hasPlayed.
      if (itemIdx !== prevItemIdx) {
        const fallbackMp4 = pickSrc(item, isDesktop, useLowQuality);
        // attachHlsTo handles 3 cases internally:
        //   - HLS URL + Safari: native <video src=hls>
        //   - HLS URL + other:  hls.js attach (lazy-loaded)
        //   - No HLS URL:       falls through to fallbackMp4
        // It's async (lazy hls.js import) but fire-and-forget — the
        // poster covers the gap and play() retries via canplay listener.
        void attachHlsTo(v, item.hlsMasterUrl ?? null, fallbackMp4);
        v.poster = item.thumbnail ?? "";
        hasPlayedRef.current[s] = false;
      }

      // Position the video at the right "lane" — translateY relative
      // to viewport top. When containerY is wired (gesture-driven mode),
      // the video position = (itemIdx * itemHeight) + containerY.
      // When not wired (Phase 1 fallback), positions are anchored to
      // the snap-aligned activeIndex.
      const baseY = containerY
        ? itemIdx * itemHeight + containerY.get()
        : (itemIdx - activeIndex) * itemHeight;
      v.style.transform = `translate3d(0, ${baseY}px, 0)`;
      v.style.opacity = "1";

      // Apply priority-driven playback state.
      applyPriority(v, priority, hasPlayedRef.current[s], resetOnFirstPlay);
      if (priority === "live") {
        hasPlayedRef.current[s] = true;
      }
    }

    prevSlotItemRef.current = [...slotItemIndex];
  }, [
    items,
    slotItemIndex,
    priorities,
    activeIndex,
    itemHeight,
    isDesktop,
    useLowQuality,
    resetOnFirstPlay,
  ]);

  /** Live drag tracker — when containerY is provided, this fires on
   *  every animation frame during a drag/spring and updates each video's
   *  transform directly. Stays compositor-only (no React re-render).
   *
   *  React hook rules require unconditional hook calls, so we always
   *  attach the listener. If containerY isn't passed (Phase 1 fallback),
   *  the listener fires on the no-op fallback motion value (which never
   *  changes) and the callback short-circuits via the `if` guard. */
  const fallbackY = useMotionValue(0);
  useMotionValueEvent(containerY ?? fallbackY, "change", (latest) => {
    if (!containerY) return;
    for (let s = 0; s < POOL_SIZE; s++) {
      const v = videoRefs.current[s];
      if (!v) continue;
      const itemIdx = slotItemIndex[s];
      if (itemIdx === -1) continue;
      const ty = itemIdx * itemHeight + latest;
      v.style.transform = `translate3d(0, ${ty}px, 0)`;
    }
  });

  /** Render the 5 video elements once. They're absolutely positioned at
   *  the top of the pool container; their transform places them. */
  const slots = useMemo(
    () => Array.from({ length: POOL_SIZE }, (_, i) => i),
    [],
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
      // Pool sits ABOVE poster Images (z=1) but BELOW interactive overlays
      // (z=10+ for text, buttons, sidebar). This is the layer the user
      // actually sees the live video on.
      style={{ zIndex: 5 }}
    >
      {slots.map((slotIdx) => (
        <video
          key={`pool-slot-${slotIdx}`}
          ref={(el) => {
            videoRefs.current[slotIdx] = el;
            // iOS Safari: explicitly set the legacy webkit attribute
            // (camelCase doesn't always work, force lowercase via attr).
            if (el) {
              el.setAttribute("playsinline", "");
              el.setAttribute("webkit-playsinline", "");
              el.setAttribute("x-webkit-airplay", "allow");
            }
          }}
          muted={muted}
          loop
          playsInline
          preload="metadata"
          // Video sizing:
          // - Mobile (portrait 9:16): cover fills the viewport perfectly
          // - Desktop (landscape 16:9): contain shows the full 9:16 clip
          //   with black bars on sides (like TikTok on desktop).
          // CRITICAL: height MUST be non-zero or video is invisible (audio plays).
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: itemHeight && itemHeight > 0 ? `${itemHeight}px` : "100dvh",
            objectFit: isDesktop ? "contain" : "cover",
            backgroundColor: "#000",
            opacity: 0,
            transform: "translate3d(0, 0, 0)",
            willChange: "transform",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
          onError={(e) => {
            const v = e.currentTarget;
            const itemIdx = slotItemIndex[slotIdx];
            const item = items[itemIdx];
            if (item) onError(item.id, v.currentSrc || v.src);
          }}
          // Disable contextmenu — TikTok native style.
          onContextMenu={(e) => e.preventDefault()}
          // Ignore reducedMotion since this is just video playback.
          data-reduced-motion={reducedMotion ? "true" : undefined}
        />
      ))}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function pickSrc(item: PoolItem, _isDesktop: boolean, useLowQuality: boolean): string {
  // Always prefer the vertical 1080p clip — it matches TikTok-style
  // portrait UX even on desktop (shown letterboxed via object-fit:contain).
  // Low-quality variant only for data-saver/slow networks.
  if (useLowQuality && item.clipVerticalLow) return item.clipVerticalLow;
  return item.clipVertical;
}

/** Translate slot priority into video element flags. */
function applyPriority(
  v: HTMLVideoElement,
  priority: SlotPriority,
  hasPlayedBefore: boolean,
  resetOnFirstPlay: boolean,
) {
  if (priority === "live") {
    v.preload = "auto";
    if (hasPlayedBefore && resetOnFirstPlay) {
      try {
        v.currentTime = 0;
      } catch {
        // ignore — some browsers throw before metadata loaded
      }
    }
    // play() may reject under autoplay policy. We swallow here because
    // the LIVE slot is always the result of either a user gesture
    // (swipe) or the page mount itself. The chip bar / tap-to-play CTA
    // fallback is still wired in the parent FeedItem layer.
    void v.play().catch(() => {});
  } else if (priority === "warm") {
    v.preload = "auto";
    v.pause();
  } else {
    // cold
    v.preload = "metadata";
    v.pause();
  }
}
