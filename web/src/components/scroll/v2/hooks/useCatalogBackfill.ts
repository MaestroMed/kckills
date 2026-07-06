"use client";

/**
 * useCatalogBackfill — walks /api/scroll/catalog so the feed can reach
 * EVERY published KC-positive clip, not just the SSR slice (Wave 37).
 *
 * The SSR feed is capped (~150 rendered items) for mobile-heap reasons
 * and the recommendation engine only surfaces similarity neighbours of
 * what the user already watched. Together they leave most of the ~850
 * clip catalogue unreachable from /scroll. This hook fixes coverage :
 *
 *   1. When the active index comes within PREFETCH_MARGIN of the end of
 *      the rendered feed, fetch the next catalogue page (cursor-paged,
 *      CDN-cacheable, identical for every visitor).
 *   2. Shuffle each incoming page client-side (Fisher-Yates) so the
 *      deep feed keeps the "always different" feel of the seeded SSR
 *      shuffle — the order is frozen into state afterwards, so
 *      re-renders never reorder what the viewer already scrolled.
 *   3. Expose the accumulated `extra` items ; the consumer folds them
 *      into its `items` state with the same seen-set dedupe as the
 *      recommendation fold (pages overlap the SSR slice by design —
 *      starting the cursor at 0 guarantees no clip is ever skipped,
 *      dedupe eats the overlap).
 *   4. `nextCursor: null` from the API → exhausted. The consumer's
 *      EndOfFeedCard then genuinely means "you have seen everything".
 *
 * Errors keep the cursor in place and clear the in-flight latch, so the
 * next swipe simply retries — no retry loop, no backoff state machine.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RecommendedKillRow } from "@/lib/supabase/recommendations";

/** Start fetching when the viewer is this many items from the tail.
 *  Wide enough that a fast swiper never hits a blank tail (each page
 *  round-trip is ~150 ms vs ~2 s per clip watched), narrow enough that
 *  a bounce visit costs zero catalogue requests. */
const PREFETCH_MARGIN = 12;
/** Page size — mirrors the API default. 851 clips ≈ 22 pages. */
const PAGE_LIMIT = 40;

interface UseCatalogBackfillOpts<T extends { id: string }> {
  /** Feature gate — false renders the hook inert (filtered feeds, recent
   *  / top-semaine tabs keep their bounded semantics). */
  enabled: boolean;
  /** Index of the currently-active item (from useFeedGesture). */
  activeIndex: number;
  /** Current rendered feed length (seed + recommendations + catalogue). */
  itemCount: number;
  /** Same mapper the recommendation fold uses — RecommendedKillRow in,
   *  consumer item out. */
  toFeedItem: (row: RecommendedKillRow) => T | null;
}

export interface UseCatalogBackfillResult<T extends { id: string }> {
  /** Accumulated catalogue items, in frozen per-visit order. The
   *  consumer appends (deduped) — never replaces. */
  extra: T[];
  /** True once the API returned nextCursor: null — the whole catalogue
   *  has been walked. */
  exhausted: boolean;
}

export function useCatalogBackfill<T extends { id: string }>(
  opts: UseCatalogBackfillOpts<T>,
): UseCatalogBackfillResult<T> {
  const { enabled, activeIndex, itemCount, toFeedItem } = opts;

  const [extra, setExtra] = useState<T[]>([]);
  const [exhausted, setExhausted] = useState(false);
  // Bump per completed fetch so the trigger effect re-evaluates even
  // when a page was 100 % duplicates (itemCount unchanged → deps alone
  // would stall the walk until the next swipe).
  const [fetchTick, setFetchTick] = useState(0);

  const cursorRef = useRef<number | null>(0);
  const inFlightRef = useRef(false);
  // Every id this hook already emitted — belt-and-braces against page
  // boundary duplicates (the API's total order should prevent them).
  const emittedIdsRef = useRef<Set<string>>(new Set());

  const fetchNextPage = useCallback(() => {
    const cursor = cursorRef.current;
    if (cursor === null || inFlightRef.current) return;
    inFlightRef.current = true;

    fetch(`/api/scroll/catalog?cursor=${cursor}&limit=${PAGE_LIMIT}`, {
      credentials: "same-origin",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json() as Promise<{
          rows?: RecommendedKillRow[];
          nextCursor?: number | null;
        }>;
      })
      .then((body) => {
        cursorRef.current =
          typeof body?.nextCursor === "number" ? body.nextCursor : null;
        if (cursorRef.current === null) setExhausted(true);

        const fresh: T[] = [];
        for (const row of body?.rows ?? []) {
          const id = row?.kill?.id;
          if (!id || emittedIdsRef.current.has(id)) continue;
          const built = toFeedItem(row);
          if (!built) continue;
          emittedIdsRef.current.add(id);
          fresh.push(built);
        }
        // Per-page Fisher-Yates : the catalogue order is deterministic
        // (score DESC) so without this every visitor's deep feed would
        // be identical. Shuffled ONCE here, then frozen in state.
        for (let i = fresh.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
        }
        if (fresh.length > 0) setExtra((prev) => [...prev, ...fresh]);
      })
      .catch((err) => {
        // Cursor untouched — the next trigger retries the same page.
        console.warn("[useCatalogBackfill] fetch failed:", err);
      })
      .finally(() => {
        inFlightRef.current = false;
        setFetchTick((t) => t + 1);
      });
  }, [toFeedItem]);

  useEffect(() => {
    if (!enabled || exhausted) return;
    if (itemCount === 0) return;
    if (activeIndex < itemCount - PREFETCH_MARGIN) return;
    fetchNextPage();
    // fetchTick re-arms the walk after all-duplicate pages ; see state
    // comment above.
  }, [enabled, exhausted, activeIndex, itemCount, fetchTick, fetchNextPage]);

  return { extra, exhausted };
}
