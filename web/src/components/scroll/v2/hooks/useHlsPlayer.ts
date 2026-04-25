"use client";

/**
 * useHlsPlayer — HLS attach/detach adapter for the FeedPlayerPool.
 *
 * Wave 11 / Agent DE — adaptive bitrate scroll player.
 *
 * Builds on the Wave 6 useHlsAttach work but exposes the spec-mandated
 * attach(video, url) / detach(video) imperative API and centralises every
 * platform-specific decision (Safari native vs hls.js MSE) behind a
 * single hook so FeedPlayerPool can swap source URLs without thinking
 * about HLS plumbing.
 *
 * Decision tree for every attach() call :
 *
 *   ┌───────────────┐
 *   │ url is null?  │── yes → detach + clear src
 *   └──────┬────────┘
 *          no
 *   ┌──────▼──────────────────────────┐
 *   │ video.canPlayType(HLS) == ""?  │── no  → set src=url (Safari path)
 *   └──────┬──────────────────────────┘
 *          yes
 *   ┌──────▼──────────────────┐
 *   │ MSE supported?         │── no  → caller should pass an MP4 instead
 *   └──────┬──────────────────┘
 *          yes
 *   ┌──────▼─────────────────────────────────┐
 *   │ Lazy-load hls.js, instantiate Hls,    │
 *   │ loadSource(url), attachMedia(video)   │
 *   └────────────────────────────────────────┘
 *
 * The hook keeps a WeakMap<HTMLVideoElement, AttachedHls> so the pool's
 * recycled <video> slots don't re-instantiate Hls on every item swap —
 * we just call loadSource() when the URL changes, which is ~80ms cheaper
 * than destroy + recreate per benchmarks.
 *
 * Bandwidth strategy :
 *   - startLevel : -1 (auto, hls.js bandwidth probe picks the level)
 *   - capLevelToPlayerSize : true (don't waste data on a bigger ladder
 *                                  than the actual rendered <video> size)
 *   - lowLatencyMode : false (LL-HLS is for live streams, our clips are
 *                              VOD with ~30s duration max)
 *
 * Native HLS path uses the OS hardware decoder which is materially more
 * battery-efficient on iOS — that's the primary reason we don't just
 * always use hls.js.
 *
 * Usage from FeedPlayerPool :
 *
 *   const { attach, detach } = useHlsPlayer();
 *   // when slot binds to a new item :
 *   await attach(videoEl, hlsUrl);   // or attach(videoEl, null) to clear
 *   // when slot unmounts (rare — the pool reuses elements forever) :
 *   detach(videoEl);
 */

import { useCallback, useRef } from "react";
import { getHls, isMseSupported } from "@/lib/hls-loader";

interface AttachedHls {
  /** Opaque hls.js Hls instance — typed loosely to keep the lazy import
   *  out of the type graph at module load. */
  instance: {
    destroy(): void;
    loadSource(url: string): void;
    attachMedia(v: HTMLVideoElement): void;
  };
  url: string;
}

/** Detect Safari (which has built-in HLS) without UA-sniffing pitfalls.
 *  Safari returns "maybe" or "probably" from canPlayType for the Apple
 *  HLS MIME type ; everything else returns the empty string. */
function supportsNativeHls(video: HTMLVideoElement): boolean {
  return video.canPlayType("application/vnd.apple.mpegurl") !== "";
}

export interface UseHlsPlayerApi {
  /**
   * Attach an HLS manifest URL to the given <video> element using the
   * best available strategy. Pass `null` as the URL to detach + clear.
   *
   * Returns a "delivery" tag that the caller should record in analytics :
   *   - "hls"  : either Safari native or hls.js attached
   *   - "mp4"  : neither HLS path worked, the caller's mp4 fallback is in
   *              effect (we DON'T set the src here in that case — the
   *              caller already wrote video.src to the mp4 url before
   *              calling us, so we just reflect what's actually playing)
   *   - "none" : null URL → detached
   *
   * Async because the hls.js module is dynamically imported on first use.
   * Fire-and-forget callers should `void attach(...)` — the poster frame
   * covers the gap between attach and the first decoded frame.
   */
  attach: (
    video: HTMLVideoElement,
    url: string | null,
  ) => Promise<"hls" | "mp4" | "none">;

  /**
   * Tear down the hls.js instance bound to this video element, if any.
   * Safe to call repeatedly — no-op when nothing is attached.
   *
   * Call this BEFORE writing a different src to the same element
   * (otherwise the hls.js MSE listener silently overrides your write).
   */
  detach: (video: HTMLVideoElement) => void;
}

export function useHlsPlayer(): UseHlsPlayerApi {
  /** Per-video Hls instances keyed by the element so the pool's recycled
   *  slots get a stable instance across item swaps. WeakMap so when an
   *  element is GC'd (rare — the pool reuses forever) the Hls instance
   *  becomes eligible for GC too. */
  const attachedRef = useRef<WeakMap<HTMLVideoElement, AttachedHls>>(
    new WeakMap(),
  );

  const detach = useCallback((video: HTMLVideoElement) => {
    const existing = attachedRef.current.get(video);
    if (!existing) return;
    try {
      existing.instance.destroy();
    } catch {
      /* hls.js destroy() can throw on a torn-down element — swallow */
    }
    attachedRef.current.delete(video);
  }, []);

  const attach = useCallback(
    async (
      video: HTMLVideoElement,
      url: string | null,
    ): Promise<"hls" | "mp4" | "none"> => {
      // Null URL → tear down + signal detached.
      if (!url) {
        detach(video);
        return "none";
      }

      // Safari / iOS path : native HLS, no JS library needed.
      if (supportsNativeHls(video)) {
        // If a previous hls.js instance was attached (slot reused with a
        // different browser? — paranoid check), clear it first.
        detach(video);
        if (video.src !== url) {
          video.src = url;
        }
        return "hls";
      }

      // Non-Safari path requires MSE. If MSE is unsupported (very rare on
      // any 2026 browser) the caller's mp4 fallback stays in effect.
      if (!isMseSupported()) {
        return "mp4";
      }

      try {
        const HlsMod = await getHls();
        const Hls = HlsMod.default;
        if (!Hls.isSupported()) {
          // The lazy-load worked but hls.js refused to run on this UA.
          // Caller's mp4 fallback is the truth at this point.
          return "mp4";
        }

        const existing = attachedRef.current.get(video);

        // Same URL on the same element → no-op (avoids a free re-fetch
        // on the master playlist).
        if (existing && existing.url === url) return "hls";

        // Different URL on the same element → swap source without
        // destroying the instance. ~80ms cheaper than a full recreate.
        if (existing) {
          existing.instance.loadSource(url);
          attachedRef.current.set(video, {
            instance: existing.instance,
            url,
          });
          return "hls";
        }

        const instance = new Hls({
          // Bandwidth estimator config per spec :
          startLevel: -1, // auto — hls.js probes bandwidth
          capLevelToPlayerSize: true, // don't waste bytes on a bigger ladder
          //                              than the rendered <video> dimensions
          lowLatencyMode: false, // LL-HLS is for live, our clips are short VOD
          // Buffer tuning : kept tight because clips are 5-30s. A long
          // buffer wastes data on clips the user might swipe past.
          maxBufferLength: 15,
          maxMaxBufferLength: 30,
          enableWorker: true,
        });
        instance.loadSource(url);
        instance.attachMedia(video);
        attachedRef.current.set(video, { instance, url });
        return "hls";
      } catch {
        // hls.js failed to load (offline, CSP, ad blocker?). Fall back to
        // whatever mp4 src the caller already set on the element.
        return "mp4";
      }
    },
    [detach],
  );

  return { attach, detach };
}
