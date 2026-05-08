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

import { useEffect, useMemo, useRef, useState } from "react";
import { useMotionValue, useMotionValueEvent, type MotionValue } from "motion/react";
import {
  POOL_SIZE,
  useFeedPlayer,
  type SlotPriority,
} from "./hooks/useFeedPlayer";
import { useHlsPlayer } from "./hooks/useHlsPlayer";
import { track } from "@/lib/analytics/track";

/**
 * Versioned-asset manifest (kills.assets_manifest, migration 026).
 * Mirror of `KillAssetsManifest` in lib/supabase/kills.ts but kept
 * loose here so the pool stays portable to moments / aggregate items
 * which don't import from the kills module. NULL on rows clipped
 * before the migration ran — pickSrc falls back to clipHorizontal /
 * clipVertical in that case.
 */
export type PoolAssetsManifest = Partial<Record<
  | "horizontal"
  | "vertical"
  | "vertical_low"
  | "thumbnail"
  | "hls_master"
  | "og_image"
  | "preview_gif",
  { url: string; width?: number | null; height?: number | null }
>>;

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
  /** Versioned kill_assets manifest (migration 026). When present,
   *  pickSrc prefers it over the legacy clip* fields. NULL on older
   *  rows — back-compat path keeps using the clip* fields. */
  assetsManifest?: PoolAssetsManifest | null;
}

interface Props {
  items: PoolItem[];
  activeIndex: number;
  /** Pixel height of one feed item — i.e. the viewport. */
  itemHeight: number;
  muted: boolean;
  useLowQuality: boolean;
  /** Network-quality enum from useNetworkQuality. Drives HLS startLevel
   *  (240p/480p/720p/1080p) and capLevel for "low". When omitted, defaults
   *  to "auto" → hls.js bandwidth probe picks the level. */
  quality?: import("./hooks/useNetworkQuality").NetworkQuality;
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
  /** V20 (Wave 21.6) — when true, disables the `<video loop>` attribute
   *  and the `onEnded` handler dispatches a `kc:auto-advance` window
   *  event so the parent ScrollFeedV2 can call `jumpTo(activeIndex+1)`.
   *  Default false (loops, classic TikTok behavior). */
  autoAdvance?: boolean;
  /** V19 (Wave 21.7) — playback rate applied to every slot's video.
   *  Default 1× = normal. Useful for slow-mo of pentas / fast-skim of
   *  teamfights. */
  speed?: number;
}

export function FeedPlayerPool({
  items,
  activeIndex,
  itemHeight,
  muted,
  useLowQuality,
  quality = "auto",
  isDesktop,
  reducedMotion,
  onError,
  resetOnFirstPlay = true,
  containerY,
  autoAdvance = false,
  speed = 1,
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

  /** HLS adapter (Wave 11 — Agent DE) — lazy-loads hls.js on first
   *  non-Safari attach via the shared `hls-loader.ts` dynamic import.
   *  The hook returns "hls" | "mp4" | "none" so we can record the
   *  delivery channel for analytics. */
  const { attach: attachHls, detach: detachHls } = useHlsPlayer();

  /** Track which kill_id has already had a `clip.delivery` event fired
   *  so we send exactly one analytics ping per kill regardless of how
   *  many times the slot is reused. */
  const deliveryReportedRef = useRef<Set<string>>(new Set());

  /** Track the current delivery channel ("hls"/"mp4") per slot so the
   *  onPlay handler can include it in the kc:clip-played CustomEvent
   *  detail without having to re-derive from the URL string. */
  const slotDeliveryRef = useRef<Array<"hls" | "mp4" | null>>(
    Array.from({ length: POOL_SIZE }, () => null),
  );

  /** V7 (Wave 21.3) — Time-to-first-frame instrumentation. When a slot
   *  takes a new item we stamp `performance.now()` ; when the matching
   *  `<video>`'s `loadeddata` (= first frame decoded) fires we measure
   *  the delta and emit `clip.ttff`. Per-kill dedup so we only count
   *  the first paint, not subsequent loops. Cold-start = first item
   *  of the session (no prior LIVE-slot ttff event recorded). */
  const slotAttachedAtRef = useRef<number[]>(
    Array.from({ length: POOL_SIZE }, () => 0),
  );
  const ttffReportedRef = useRef<Set<string>>(new Set());
  const sessionFirstTtffRef = useRef<boolean>(true);

  /** Sync mute state across all 5 elements when shared mute toggles. */
  useEffect(() => {
    for (const v of videoRefs.current) {
      if (v) v.muted = muted;
    }
  }, [muted]);

  /** V2 (Wave 22.1) — single-tap-to-pause. FeedItem dispatches
   *  `kc:toggle-playback` on a single tap, the pool toggles the
   *  LIVE-slot video's paused state. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onToggle = () => {
      // Find the LIVE slot (priority === "live"). If none, no-op.
      for (let s = 0; s < POOL_SIZE; s++) {
        if (priorities[s] === "live") {
          const v = videoRefs.current[s];
          if (!v) return;
          if (v.paused) {
            void v.play().catch(() => {});
          } else {
            v.pause();
          }
          return;
        }
      }
    };
    window.addEventListener("kc:toggle-playback", onToggle);
    return () => window.removeEventListener("kc:toggle-playback", onToggle);
  }, [priorities]);

  /** V6 (Wave 22.2) — Visibility API integration. When the tab goes
   *  hidden (user switched apps / Safari tabs), we pause every video
   *  in the pool. On return, only the LIVE slot resumes — warm/cold
   *  stay paused so we don't burn data on background buffering.
   *  Stops the pre-V6 silent-data-waste pattern where a backgrounded
   *  /scroll tab kept downloading subsequent clips. */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      if (document.hidden) {
        for (const v of videoRefs.current) {
          if (v && !v.paused) v.pause();
        }
        return;
      }
      // Tab visible again — re-resume only the LIVE slot.
      for (let s = 0; s < POOL_SIZE; s++) {
        if (priorities[s] === "live") {
          const v = videoRefs.current[s];
          if (v && v.paused) void v.play().catch(() => {});
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [priorities]);

  /** V6 — Battery + saveData awareness. Anything below 20 % battery
   *  AND not plugged in downgrades EVERY slot's preload to "metadata"
   *  (= no big chunk fetches) until the conditions reverse. The
   *  Battery Status API has been deprecated on Safari but still ships
   *  on Chrome/Edge ; we feature-detect carefully. */
  const [batterySaver, setBatterySaver] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    type BatteryManager = {
      level: number;
      charging: boolean;
      addEventListener: (e: string, fn: () => void) => void;
      removeEventListener: (e: string, fn: () => void) => void;
    };
    const navWithBattery = navigator as Navigator & {
      getBattery?: () => Promise<BatteryManager>;
    };
    if (typeof navWithBattery.getBattery !== "function") return;
    let cancelled = false;
    let battery: BatteryManager | null = null;
    const update = () => {
      if (!battery || cancelled) return;
      const lowAndUnplugged = battery.level < 0.2 && !battery.charging;
      setBatterySaver(lowAndUnplugged);
    };
    void navWithBattery.getBattery().then((b) => {
      if (cancelled) return;
      battery = b;
      update();
      battery.addEventListener("levelchange", update);
      battery.addEventListener("chargingchange", update);
    });
    return () => {
      cancelled = true;
      if (battery) {
        battery.removeEventListener("levelchange", update);
        battery.removeEventListener("chargingchange", update);
      }
    };
  }, []);

  /** Apply the battery-saver preload downgrade across the whole pool
   *  when triggered. */
  useEffect(() => {
    if (!batterySaver) return;
    for (const v of videoRefs.current) {
      if (v) v.preload = "metadata";
    }
  }, [batterySaver]);

  /** V19 (Wave 21.7) — sync `playbackRate` across every slot whenever
   *  the user picks a new speed in the settings drawer. Defensive
   *  clamp : reject anything outside [0.25, 4] to dodge spec-non-
   *  compliant browsers that throw on extreme values. */
  useEffect(() => {
    const safeSpeed = Math.max(0.25, Math.min(4, speed || 1));
    for (const v of videoRefs.current) {
      if (v) v.playbackRate = safeSpeed;
    }
  }, [speed]);

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
        // PR23.8 — On desktop with a horizontal MP4 available, SKIP HLS
        // entirely. The HLS master playlist only carries the 9:16 vertical
        // ladder (which is what the worker's hls_packager produces today),
        // so on a 16:9 desktop viewport HLS would render the vertical clip
        // letterboxed with massive black bars. Mobile (or desktop with
        // no horizontal MP4 fallback) still uses HLS — that's where the
        // adaptive bitrate actually pays off.
        const useMp4Direct = isDesktop && !!item.clipHorizontal;
        const hlsUrl = useMp4Direct ? null : (item.hlsMasterUrl ?? null);

        // Wave 11 (Agent DE) — explicit attach/detach order matters for
        // pool reuse :
        //   1. Detach any previous hls.js instance bound to this <video>.
        //      Without this, a slot that was HLS-attached keeps the MSE
        //      listener alive and any subsequent video.src write is
        //      silently overridden on the next manifest tick.
        //   2. Set the MP4 src as the safe baseline. If HLS attach
        //      succeeds, it'll override; if it fails (no MSE, hls.js
        //      load error, etc.), the MP4 stays in place as graceful
        //      fallback so we always play SOMETHING.
        //   3. Fire-and-forget the HLS attach. The hook returns the
        //      actual delivery channel ("hls" | "mp4" | "none") so we
        //      can record it for analytics. Awaiting would block the
        //      slot transition — the poster covers the visual gap and
        //      play() retries via the browser's canplay listener.
        detachHls(v);
        if (fallbackMp4 && v.src !== fallbackMp4) {
          v.src = fallbackMp4;
        }
        // V7 (Wave 21.3) — stamp the slot-attach timestamp so the
        // upcoming `loadeddata` event can measure TTFF. We stamp on
        // EVERY slot-rebind, not just the LIVE one, because warm
        // slots can transition to LIVE before they finish loading
        // and we want the full attach→first-frame window in that case.
        slotAttachedAtRef.current[s] = performance.now();
        // Capture stable refs for the async closure — `s` and `item`
        // are loop-scoped and may be reassigned before the promise
        // resolves on the next tick.
        const capturedItemId = item.id;
        const capturedSlot = s;
        void attachHls(v, hlsUrl).then((delivery) => {
          // "none" means the attach was called with null URL — that's
          // the MP4-only path. The actual delivery channel is "mp4".
          const channel: "hls" | "mp4" = delivery === "hls" ? "hls" : "mp4";
          slotDeliveryRef.current[capturedSlot] = channel;
          // Fire analytics exactly once per kill — pool reuse across
          // swipes means a kill can land in multiple slots over a
          // session, but we only care about the first delivery
          // decision (the channel never changes for a given kill_id
          // once chosen).
          if (!deliveryReportedRef.current.has(capturedItemId)) {
            deliveryReportedRef.current.add(capturedItemId);
            try {
              track("clip.delivery", {
                entityType: "kill",
                entityId: capturedItemId,
                metadata: { delivery: channel },
              });
            } catch {
              /* tracker is silent on failure by design */
            }
          }
        });
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
    // `quality` is intentionally NOT in this deps array : the Wave 11
    // useHlsPlayer hook ignores it (capLevelToPlayerSize handles the
    // ladder cap automatically per video size). Keeping it as a prop
    // for API compat in case a future revision re-introduces a manual
    // startLevel override.
    resetOnFirstPlay,
    attachHls,
    detachHls,
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
          // V20 (Wave 21.6) — `loop` is conditional on the autoAdvance
          // setting. When the user opts into auto-advance, we want the
          // `ended` event to fire so the parent can move to the next
          // clip ; otherwise we keep the TikTok-default loop behavior.
          // The HTML spec : `<video loop>` SUPPRESSES the `ended` event
          // (the video silently restarts on completion), so we have to
          // toggle the attribute, not just listen and ignore.
          loop={!autoAdvance}
          playsInline
          preload="metadata"
          // Video sizing:
          // - Mobile (portrait 9:16): cover on the 9:16 vertical clip
          // - Desktop (landscape 16:9): contain on the 16:9 horizontal
          //   clip so the whole frame shows (no top/bottom crop). pickSrc
          //   already swapped the source to clipHorizontal on desktop.
          // CRITICAL: height MUST be non-zero or video is invisible (audio plays).
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: itemHeight && itemHeight > 0 ? `${itemHeight}px` : "100dvh",
            objectFit: "contain",
            backgroundColor: "#000",
            opacity: 0,
            transform: "translate3d(0, 0, 0)",
            willChange: "transform",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
          onLoadedData={() => {
            // V7 (Wave 21.3) — first decoded frame for this slot's
            // current item. Measure attach→first-frame delta.
            const itemIdx = slotItemIndex[slotIdx];
            const item = items[itemIdx];
            if (!item) return;
            const attachedAt = slotAttachedAtRef.current[slotIdx];
            if (!attachedAt) return;
            // Dedup per kill — pool reuse means a kill can land in
            // multiple slots, but the first paint is the one that
            // matters for cold-start TTFF measurement.
            if (ttffReportedRef.current.has(item.id)) return;
            ttffReportedRef.current.add(item.id);
            const ttffMs = Math.round(performance.now() - attachedAt);
            const wasFirst = sessionFirstTtffRef.current;
            sessionFirstTtffRef.current = false;
            try {
              track("clip.ttff", {
                entityType: "kill",
                entityId: item.id,
                metadata: {
                  ttff_ms: ttffMs,
                  delivery: slotDeliveryRef.current[slotIdx] ?? "mp4",
                  cold_start: wasFirst,
                },
              });
            } catch {
              /* tracker is silent on failure by design */
            }
          }}
          onError={(e) => {
            const v = e.currentTarget;
            const itemIdx = slotItemIndex[slotIdx];
            const item = items[itemIdx];
            if (!item) return;
            // Best-effort error code lookup. HTMLMediaElement.error is a
            // MediaError with a numeric .code in the MEDIA_ERR_* enum.
            // We translate to a stable string for analytics legibility.
            const mediaErr = (v as HTMLVideoElement).error;
            const code = mediaErr ? mediaErrorCodeName(mediaErr.code) : "unknown";
            // Notify the parent (drops the item from the feed in v1+ flow).
            onError(item.id, v.currentSrc || v.src);
            // Wave 6 — broadcast a custom event so FeedItem can swap to
            // <FeedItemError /> in-place without unmounting the gesture
            // container. Mirrors the kc:clip-played / kc:clip-ended
            // pattern from Wave 1+2.
            try {
              window.dispatchEvent(
                new CustomEvent("kc:clip-error", {
                  detail: {
                    itemId: item.id,
                    errorCode: code,
                    src: v.currentSrc || v.src,
                  },
                }),
              );
            } catch {
              /* CustomEvent unsupported in some sandboxes */
            }
          }}
          onPlay={() => {
            // Notify analytics — only fire for the LIVE slot to avoid
            // "started" events for warm/cold slot pre-rolls.
            const itemIdx = slotItemIndex[slotIdx];
            const item = items[itemIdx];
            if (!item || itemIdx !== activeIndex) return;
            try {
              // Wave 11 — include delivery channel ("hls" / "mp4") so
              // FeedItem's analytics hook + downstream listeners can
              // correlate clip.started with the delivery method without
              // having to inspect the source URL.
              // V1 (Wave 21.1) — also include the actual clip duration
              // in seconds (when known) so the dwell-fraction
              // calculation in FeedItem's useFeedItemAnalytics has the
              // denominator. May be NaN/0 on first paint before
              // metadata loads — the consumer guards for that.
              const durationSec = videoRefs.current[slotIdx]?.duration;
              window.dispatchEvent(
                new CustomEvent("kc:clip-played", {
                  detail: {
                    itemId: item.id,
                    delivery: slotDeliveryRef.current[slotIdx] ?? "mp4",
                    durationSec:
                      durationSec && Number.isFinite(durationSec)
                        ? durationSec
                        : null,
                  },
                }),
              );
            } catch {
              /* CustomEvent unsupported in some sandboxes */
            }
          }}
          onEnded={() => {
            const itemIdx = slotItemIndex[slotIdx];
            const item = items[itemIdx];
            if (!item) return;
            // V20 — only the LIVE slot's `ended` triggers auto-advance.
            // Warm/cold slots also fire `ended` if they happen to roll
            // through a short clip while waiting, and we DON'T want
            // those to jump the active item.
            if (autoAdvance && itemIdx === activeIndex) {
              try {
                window.dispatchEvent(
                  new CustomEvent("kc:auto-advance", {
                    detail: { from: itemIdx },
                  }),
                );
              } catch {
                /* CustomEvent unsupported */
              }
            }
            try {
              window.dispatchEvent(
                new CustomEvent("kc:clip-ended", {
                  detail: {
                    itemId: item.id,
                    duration: (videoRefs.current[slotIdx]?.duration ?? 0) | 0,
                  },
                }),
              );
            } catch {
              /* ignore */
            }
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

function pickSrc(item: PoolItem, isDesktop: boolean, useLowQuality: boolean): string {
  // Manifest-aware path (migration 026 — kill_assets table).
  // The manifest is the source of truth for asset URLs once the
  // worker has clipped through the new pipeline. Same selection
  // priority as the legacy fall-through below.
  const m = item.assetsManifest;
  if (m) {
    if (useLowQuality && m.vertical_low?.url) return m.vertical_low.url;
    if (isDesktop && m.horizontal?.url) return m.horizontal.url;
    if (m.vertical?.url) return m.vertical.url;
    // Manifest present but missing the type we wanted — fall through to
    // legacy fields below rather than returning nothing.
  }
  // Legacy back-compat path : rows clipped before migration 026 still
  // carry only the flat clip_url_* columns.
  // Desktop wants the native 16:9 landscape clip — letterboxing a 9:16
  // vertical inside a 16:9 viewport leaves black bars on 2/3 of the
  // screen and feels like a broken layout. Mobile stays on vertical
  // since viewport IS 9:16.
  // Low-quality variant only for data-saver/slow networks.
  if (useLowQuality && item.clipVerticalLow) return item.clipVerticalLow;
  if (isDesktop && item.clipHorizontal) return item.clipHorizontal;
  return item.clipVertical;
}

/** Map an HTMLMediaError numeric code to a stable string suitable for
 *  analytics. Unknown codes fall back to "media_err_<n>" so we can
 *  spot novel failure modes in the dashboard. */
function mediaErrorCodeName(code: number): string {
  switch (code) {
    case 1:
      return "MEDIA_ERR_ABORTED";
    case 2:
      return "MEDIA_ERR_NETWORK";
    case 3:
      return "MEDIA_ERR_DECODE";
    case 4:
      return "MEDIA_ERR_SRC_NOT_SUPPORTED";
    default:
      return `media_err_${code}`;
  }
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
