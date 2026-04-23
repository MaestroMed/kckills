"use client";

/**
 * useFeedBuffer — speculative preload manager for the TikTok-native feed.
 *
 * Two layers of speculation :
 *   1. THUMBNAILS — Image() preload N items ahead so the poster never
 *      blanks during a swipe burst. Cache-bounded.
 *   2. VIDEO MANIFESTS — for the next 2-3 items, HEAD-request the
 *      HLS master / MP4 to warm the R2 connection + CDN edge cache.
 *      Doesn't download the video itself — just resolves DNS, opens
 *      TLS, and primes the browser cache for when the pool needs it.
 *
 * Window adaptive to network quality :
 *   ultra → 15 ahead × 4 behind  + 3 video heads
 *   high  → 10 ahead × 3 behind  + 2 video heads
 *   med   → 6 ahead  × 2 behind  + 1 video head
 *   low   → no speculation       + 0 video heads (mobile data saver)
 *
 * What it intentionally does NOT do:
 *   - It does NOT GET video bytes — the pool's preload="auto" handles
 *     that for the warm slots. Adding GETs here would saturate bandwidth.
 *   - It does NOT use <link rel="preload"> — those add CORS complexity
 *     and confuse the next/image optimization layer.
 */

import { useEffect, useRef } from "react";
import type { NetworkQuality } from "./useNetworkQuality";

interface QualityWindow {
  ahead: number;
  behind: number;
  videoHeads: number;
}

const QUALITY_WINDOWS: Record<NetworkQuality, QualityWindow> = {
  ultra: { ahead: 15, behind: 4, videoHeads: 3 },
  high:  { ahead: 10, behind: 3, videoHeads: 2 },
  med:   { ahead: 6,  behind: 2, videoHeads: 1 },
  low:   { ahead: 0,  behind: 0, videoHeads: 0 },
  auto:  { ahead: 8,  behind: 2, videoHeads: 1 },
};

interface BufferItem {
  id: string;
  thumbnail: string | null;
  /** HLS master URL (preferred — primes both CDN edge AND HLS manifest). */
  hlsMasterUrl?: string | null;
  /** MP4 fallback (used when no HLS available). */
  videoUrl?: string | null;
}

export function useFeedBuffer({
  items,
  activeIndex,
  quality,
}: {
  items: BufferItem[];
  activeIndex: number;
  quality: NetworkQuality;
}) {
  /** Thumbnail Image() cache. */
  const imgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  /** Set of (kill_id) for which we've already fired the video HEAD warmer. */
  const videoWarmedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (items.length === 0) return;
    const win = QUALITY_WINDOWS[quality] ?? QUALITY_WINDOWS.auto;
    if (win.ahead === 0 && win.videoHeads === 0) return;

    const minIdx = Math.max(0, activeIndex - win.behind);
    const maxIdx = Math.min(items.length - 1, activeIndex + win.ahead);
    const desiredIds = new Set<string>();

    // ─── Thumbnails ───────────────────────────────────────────────
    for (let i = minIdx; i <= maxIdx; i++) {
      const item = items[i];
      if (!item || !item.thumbnail) continue;
      desiredIds.add(item.id);
      if (imgCacheRef.current.has(item.id)) continue;
      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";
      img.src = item.thumbnail;
      imgCacheRef.current.set(item.id, img);
    }
    // Evict thumbnails out of window
    for (const cachedId of imgCacheRef.current.keys()) {
      if (!desiredIds.has(cachedId)) {
        imgCacheRef.current.delete(cachedId);
      }
    }

    // ─── Video manifest warmers ───────────────────────────────────
    // Only the next N items (active+1 .. active+videoHeads). HEAD
    // requests are cheap and prime DNS + TLS + R2 edge cache so when
    // the pool actually attaches the src, latency to first byte is
    // <100ms instead of ~500ms cold.
    for (let i = activeIndex + 1; i <= Math.min(items.length - 1, activeIndex + win.videoHeads); i++) {
      const item = items[i];
      if (!item) continue;
      const url = item.hlsMasterUrl || item.videoUrl;
      if (!url) continue;
      if (videoWarmedRef.current.has(item.id)) continue;
      videoWarmedRef.current.add(item.id);
      // Fire-and-forget HEAD. Using fetch instead of XHR for keepalive.
      // Errors are silent — the pool will retry on actual playback.
      try {
        fetch(url, { method: "HEAD", mode: "cors", cache: "default" }).catch(
          () => {
            // Ignore — connection warming is best-effort
          },
        );
      } catch {
        // ignore
      }
    }

    // Bound the warmed set so it doesn't grow forever in long sessions
    if (videoWarmedRef.current.size > 200) {
      const arr = Array.from(videoWarmedRef.current);
      // Keep only the last 100 (LRU-ish — Set keeps insertion order)
      videoWarmedRef.current = new Set(arr.slice(-100));
    }
  }, [items, activeIndex, quality]);

  // Cleanup on unmount — drop all cache entries.
  useEffect(() => {
    const cache = imgCacheRef.current;
    const warmed = videoWarmedRef.current;
    return () => {
      cache.clear();
      warmed.clear();
    };
  }, []);
}
