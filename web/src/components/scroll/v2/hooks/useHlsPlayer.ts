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
import { track } from "@/lib/analytics/track";

interface AttachedHls {
  /** Opaque hls.js Hls instance — typed loosely to keep the lazy import
   *  out of the type graph at module load. */
  instance: {
    destroy(): void;
    loadSource(url: string): void;
    attachMedia(v: HTMLVideoElement): void;
    on(event: string, handler: (event: string, data: HlsErrorData) => void): void;
  };
  url: string;
  /** MP4 URL to revert to if the HLS manifest 404s or fails fatally.
   *  Wave 30q : without this, a fatal hls.js error left the <video> stuck
   *  with no playable source (MSE listener swallowed the native error
   *  event). Now the error handler destroys the instance + writes the
   *  fallback src directly. */
  fallbackMp4: string | null;
}

/** Minimal shape of the `data` payload emitted by Hls.Events.ERROR. The
 *  hls.js types live behind the lazy import, so we redeclare just the
 *  fields the handler actually inspects to keep the module surface
 *  light. */
interface HlsErrorData {
  fatal: boolean;
  type: string;
  details: string;
  response?: { code?: number };
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
   *
   * `fallbackMp4` (Wave 30q) : MP4 URL to revert to if hls.js fires a
   * FATAL error (manifest 404, parse error, fragLoadError that exceeds
   * retries, etc). When provided, the hook destroys the Hls instance,
   * writes `video.src = fallbackMp4`, and fires a `clip.hls.error`
   * analytics event. Without this, a fatal HLS error leaves the <video>
   * stuck with no playable source (the MSE listener swallows the
   * native error event before the browser can fall back).
   *
   * Safari native path : `fallbackMp4` is ignored because Safari's
   * native HLS player surfaces the error event directly to the <video>
   * element and the caller's standard `onerror` handler can react.
   */
  attach: (
    video: HTMLVideoElement,
    url: string | null,
    fallbackMp4?: string | null,
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
      fallbackMp4: string | null = null,
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
        // on the master playlist). Update fallback in case it changed.
        if (existing && existing.url === url) {
          existing.fallbackMp4 = fallbackMp4;
          return "hls";
        }

        // Different URL on the same element → swap source without
        // destroying the instance. ~80ms cheaper than a full recreate.
        if (existing) {
          existing.instance.loadSource(url);
          attachedRef.current.set(video, {
            instance: existing.instance,
            url,
            fallbackMp4,
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

        // Wave 30q — wire the fatal-error → MP4 fallback path. Without
        // this listener, hls.js silently destroys the MSE source buffer
        // on a fatal error but the <video> element keeps the dead
        // sourceObject attached, freezing playback indefinitely.
        instance.on("hlsError", (_event, data) => {
          if (!data?.fatal) return;
          // Fatal error : destroy the instance + revert to MP4 if we
          // have one. Otherwise pop the src so the browser's `error`
          // event can fire and the caller's <video onError> kicks in.
          const wasUrl = url;
          const fallback = attachedRef.current.get(video)?.fallbackMp4 ?? fallbackMp4;
          try {
            instance.destroy();
          } catch {
            /* swallow — destroy() on a half-torn-down instance can throw */
          }
          attachedRef.current.delete(video);

          // Report exactly once per (video, url) so the dashboard sees
          // how often this happens. Errors during the R2 HLS repackage
          // catch-up will show as a spike that decays as segments
          // come back online.
          try {
            track("clip.hls.error", {
              entityType: "clip",
              entityId: wasUrl,
              metadata: {
                fatal: true,
                type: data.type ?? "unknown",
                details: data.details ?? "unknown",
                statusCode: data.response?.code ?? null,
                hadFallback: Boolean(fallback),
              },
            });
          } catch {
            /* analytics is silent on failure by design */
          }

          if (fallback) {
            // Reassign the MP4 fallback. The browser's `load()` is
            // implicit on src write — no need to call it explicitly.
            video.src = fallback;
            // Best-effort resume from the same position the HLS attempt
            // would have started from. currentTime stays 0 by default.
            video.play().catch(() => {
              /* autoplay can be blocked — that's fine, the pool's
                 priority-driven play() retries next frame */
            });
          } else {
            // No fallback : strip src so the browser fires `error`/
            // `emptied` and the caller's <video onError> handler can
            // render an error card.
            video.removeAttribute("src");
            try {
              video.load();
            } catch {
              /* ignore */
            }
          }
        });

        instance.loadSource(url);
        instance.attachMedia(video);
        attachedRef.current.set(video, { instance, url, fallbackMp4 });
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
