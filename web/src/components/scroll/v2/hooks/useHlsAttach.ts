"use client";

/**
 * useHlsAttach — adapter that attaches an HLS .m3u8 manifest to a
 * <video> element using the right strategy per device:
 *
 *   - Safari (iOS + macOS) : NATIVE HLS support via <video src=...>.
 *     Don't load hls.js — just set src. Saves ~30KB and uses the
 *     built-in hardware decoder which is more battery-efficient.
 *
 *   - Other browsers (Chrome Android, Firefox, Edge) : hls.js attaches
 *     to the video element and feeds it MSE chunks. Adaptive bitrate
 *     ladder negotiation happens automatically.
 *
 *   - Fallback : if neither HLS path works, we just set the legacy
 *     MP4 src and let the browser play it. The pool's pickSrc helper
 *     already returns the right MP4 variant based on quality, so the
 *     experience degrades gracefully.
 *
 * hls.js is loaded LAZILY on first use via dynamic import so the ~30KB
 * doesn't ship in /scroll-v2's initial bundle. Safari users never load it.
 *
 * Memory: hls.js Hls instances are kept alive PER video element in a
 * WeakMap. When the video element is GC'd (slot recycled), the Hls
 * instance becomes eligible for GC too. We don't manually destroy
 * because the slot pool re-uses the same element forever — destroying
 * + re-instantiating Hls per item swap was 80ms overhead in benchmarks.
 *
 * Phase 4 contract:
 *   attachHlsTo(video, hlsUrl)   — call when binding a slot to an item
 *   detachHlsFrom(video)         — call when slot is unbound (rare)
 */

import { useCallback, useRef } from "react";

type HlsModule = typeof import("hls.js");

/** Module promise — lazy-loaded once. */
let hlsModulePromise: Promise<HlsModule> | null = null;

function loadHls(): Promise<HlsModule> {
  if (!hlsModulePromise) {
    hlsModulePromise = import("hls.js");
  }
  return hlsModulePromise;
}

/** Detect Safari (which has native HLS) without UA-sniffing pitfalls. */
function supportsNativeHls(video: HTMLVideoElement): boolean {
  return video.canPlayType("application/vnd.apple.mpegurl") !== "";
}

interface AttachedHls {
  // We can't import the type at module load (lazy), so opaque ref.
  instance: { destroy(): void; loadSource(url: string): void; attachMedia(v: HTMLVideoElement): void };
  url: string;
}

export function useHlsAttach() {
  /** Per-video Hls instances, keyed by the element so the pool's
   *  recycled slots get a stable instance across item swaps. */
  const attachedRef = useRef<WeakMap<HTMLVideoElement, AttachedHls>>(
    new WeakMap(),
  );

  const attachHlsTo = useCallback(
    async (video: HTMLVideoElement, hlsUrl: string | null, fallbackMp4: string | null) => {
      if (!hlsUrl) {
        // No HLS available — set MP4 fallback if any.
        if (fallbackMp4 && video.src !== fallbackMp4) {
          video.src = fallbackMp4;
        }
        return;
      }

      // Safari / iOS: native HLS, just set src.
      if (supportsNativeHls(video)) {
        if (video.src !== hlsUrl) {
          video.src = hlsUrl;
        }
        return;
      }

      // Other browsers: lazy-load hls.js + attach.
      try {
        const HlsMod = await loadHls();
        const Hls = HlsMod.default;
        if (!Hls.isSupported()) {
          if (fallbackMp4) video.src = fallbackMp4;
          return;
        }

        const existing = attachedRef.current.get(video);
        // Already attached to this exact URL? Skip.
        if (existing && existing.url === hlsUrl) return;

        // Different URL on the same video — swap source without
        // destroying the instance (much faster).
        if (existing) {
          existing.instance.loadSource(hlsUrl);
          attachedRef.current.set(video, { instance: existing.instance, url: hlsUrl });
          return;
        }

        const instance = new Hls({
          // Lower latency + smaller buffer = better fit for short clips.
          maxBufferLength: 15,
          maxMaxBufferLength: 30,
          lowLatencyMode: false,
          // Start at the lowest variant — bitrate negotiation kicks in
          // after the first chunk loads. Avoids a big-bitrate stall on
          // the first frame on slow connections.
          startLevel: 0,
          // Don't auto-recover MEDIA_ERR_DECODE — it can cause infinite
          // loops on broken segments. The pool error handler will swap
          // to MP4 if everything fails.
          enableWorker: true,
        });
        instance.loadSource(hlsUrl);
        instance.attachMedia(video);
        attachedRef.current.set(video, { instance, url: hlsUrl });
      } catch {
        // hls.js failed to load (offline?). Fall back to MP4.
        if (fallbackMp4) video.src = fallbackMp4;
      }
    },
    [],
  );

  const detachHlsFrom = useCallback((video: HTMLVideoElement) => {
    const existing = attachedRef.current.get(video);
    if (existing) {
      try {
        existing.instance.destroy();
      } catch {
        // ignore
      }
      attachedRef.current.delete(video);
    }
  }, []);

  return { attachHlsTo, detachHlsFrom };
}
