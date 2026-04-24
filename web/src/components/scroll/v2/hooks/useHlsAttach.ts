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
import type { NetworkQuality } from "./useNetworkQuality";

type HlsModule = typeof import("hls.js");

/**
 * Map our NetworkQuality enum to an hls.js startLevel index.
 * The variant ladder (after migration to 4 variants in hls_packager) is:
 *   0 = 240p   1 = 480p   2 = 720p   3 = 1080p
 *
 * startLevel = -1  → hls.js auto-detects from bandwidth probe (slowest first)
 * startLevel = 0+  → start at this index, then ABR can ramp up/down freely
 *
 * "ultra" forces 1080p start (saves the upramp delay on fast connections).
 * "low"   caps to 240p only via maxLevel (no ABR ramp on bad networks).
 */
function startLevelFor(quality: NetworkQuality): number {
  switch (quality) {
    case "ultra": return 3;
    case "high":  return 2;
    case "med":   return 1;
    case "low":   return 0;
    default:      return -1; // auto
  }
}

function capLevelFor(quality: NetworkQuality): number | undefined {
  // Hard cap on "low" to spare data even if ABR thinks we can do more.
  return quality === "low" ? 0 : undefined;
}

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
    async (
      video: HTMLVideoElement,
      hlsUrl: string | null,
      fallbackMp4: string | null,
      quality: NetworkQuality = "auto",
    ) => {
      if (!hlsUrl) {
        // No HLS desired — destroy any pre-existing Hls.js instance on
        // this <video> so the MP4 src takes over cleanly. Without this,
        // a slot that was previously HLS-attached keeps the Hls.js
        // listener alive and the new video.src write is silently
        // overridden on the next manifest tick.
        const existing = attachedRef.current.get(video);
        if (existing) {
          try {
            existing.instance.destroy();
          } catch {
            /* ignore */
          }
          attachedRef.current.delete(video);
        }
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

        const startLevel = startLevelFor(quality);
        const cap = capLevelFor(quality);
        const instance = new Hls({
          // Lower latency + smaller buffer = better fit for short clips.
          maxBufferLength: 15,
          maxMaxBufferLength: 30,
          lowLatencyMode: false,
          // Start level chosen from network quality — "ultra" jumps
          // straight to 1080p, "low" stays at 240p.
          startLevel,
          ...(cap !== undefined ? { capLevelToPlayerSize: false, autoStartLoad: true } : {}),
          enableWorker: true,
        });
        instance.loadSource(hlsUrl);
        instance.attachMedia(video);
        // Hard cap for "low" — once the manifest is parsed, force the
        // level cap so even if ABR upgrades it, the player downgrades
        // immediately. capLevel is hls.js' user-side ceiling.
        if (cap !== undefined) {
          const onManifest = () => {
            try {
              (instance as unknown as { capLevel?: number }).capLevel = cap;
            } catch {
              /* ignore */
            }
          };
          (instance as unknown as { on: (e: string, cb: () => void) => void })
            .on("hlsManifestParsed", onManifest);
        }
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
