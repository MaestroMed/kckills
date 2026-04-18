"use client";

/**
 * useFeedBuffer — speculative preload manager for the TikTok-native feed.
 *
 * The 5-slot pool only covers items in [active-2, active+2]. For a
 * smooth experience past that window — especially fast flicks across
 * 5+ items — we need to PRELOAD thumbnails ~10 items ahead so the
 * poster never blanks during a swipe burst.
 *
 * What this hook does:
 *   - Watches the activeIndex
 *   - Triggers Image preload for items in [active+3, active+10] that
 *     haven't been preloaded yet
 *   - Drops items from the cache that fall out of the [active-3, active+10]
 *     window so the cache stays bounded (max ~14 thumbnails in flight)
 *   - Honors network quality: skips speculation entirely on "low" (saves data)
 *
 * What it intentionally does NOT do:
 *   - It does NOT preload video data — the pool already manages that
 *     via the slot priority (warm vs cold). Adding video preload here
 *     would saturate bandwidth and starve the active video.
 *   - It does NOT use <link rel="preload"> — those have global CDN
 *     headers and would cache-poison Vercel's image optimisation.
 */

import { useEffect, useRef } from "react";
import type { NetworkQuality } from "./useNetworkQuality";

const PRELOAD_AHEAD = 10;
const PRELOAD_BEHIND = 3;

export function useFeedBuffer({
  items,
  activeIndex,
  quality,
}: {
  items: { id: string; thumbnail: string | null }[];
  activeIndex: number;
  quality: NetworkQuality;
}) {
  /** Set of item ids whose thumbnail is currently held in the cache.
   *  Backed by an Image() instance kept alive in the ref so the browser
   *  doesn't garbage-collect the decoded bitmap. */
  const cacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    // Skip speculation entirely on low-quality networks — the user has
    // bigger problems than a poster blink.
    if (quality === "low" || items.length === 0) return;

    const minIdx = Math.max(0, activeIndex - PRELOAD_BEHIND);
    const maxIdx = Math.min(items.length - 1, activeIndex + PRELOAD_AHEAD);
    const desiredIds = new Set<string>();

    // Schedule preload for in-window items.
    for (let i = minIdx; i <= maxIdx; i++) {
      const item = items[i];
      if (!item || !item.thumbnail) continue;
      desiredIds.add(item.id);
      if (cacheRef.current.has(item.id)) continue;
      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";
      img.src = item.thumbnail;
      cacheRef.current.set(item.id, img);
    }

    // Evict items that fell out of the window.
    for (const cachedId of cacheRef.current.keys()) {
      if (!desiredIds.has(cachedId)) {
        cacheRef.current.delete(cachedId);
        // Image instance becomes GC-eligible. The browser may keep the
        // decoded bitmap in its own resource cache for a while, that's fine.
      }
    }
  }, [items, activeIndex, quality]);

  // Cleanup on unmount — drop all cache entries.
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      cache.clear();
    };
  }, []);
}
