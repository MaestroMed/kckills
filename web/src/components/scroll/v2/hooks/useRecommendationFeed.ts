"use client";

/**
 * useRecommendationFeed — per-session similarity-ranked feed loader.
 *
 * When the recommendations feature flag is on (NEXT_PUBLIC_RECOMMENDATIONS_ENABLED
 * = "true"), ScrollFeedV2 swaps the SSR-rendered `items` for a
 * dynamically-fetched recommendation feed driven by what the user has
 * been actively watching.
 *
 * Behaviour :
 *
 *   1. Tracks the last N (default 5) kill_ids the user has actually
 *      watched — i.e. those that were the active item AND stayed active
 *      for more than DWELL_MS milliseconds. Mirrors the dwell logic in
 *      useImpressionTracker so we don't pollute the anchor list with
 *      fast-flick passes.
 *
 *   2. Whenever the anchor list changes, hits
 *      `/api/scroll/recommendations` with the session id (read from
 *      sessionStorage — same key as track.ts kc_session_id) and the
 *      anchors. The endpoint returns a list of `RecommendedKillRow`
 *      tuples (kill payload + similarity).
 *
 *   3. Folds the recommendations onto the existing seed `items` —
 *      anything not already in the live list is appended to the tail.
 *      Already-seen ids are skipped so the user never gets the same
 *      clip twice.
 *
 *   4. On cold start (no anchors yet), the API responds with
 *      `{rows: [], fallback: true}`. The hook then exposes
 *      `usingFallback: true` so the consumer renders the unmodified
 *      seed feed.
 *
 * The hook is a no-op until at least one anchor lands, so the initial
 * paint is always identical to the non-personalised feed.
 *
 * Why not React Query : ScrollFeedV2 already lives without a query
 * client and we'd rather not bring tanstack/react-query into the route
 * for one fetch. The state machine here is simple enough to manage by
 * hand : (anchors → fetch → fold → re-render).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { RecommendedKillRow } from "@/lib/supabase/recommendations";
import { track } from "@/lib/analytics/track";

/** Same dwell threshold as useImpressionTracker — 1.5 s active. */
const DWELL_MS = 1500;
/** How many recent kill_ids feed into the anchor query. Bigger = more
 *  inertia in recommendations, smaller = tighter coupling to the very
 *  last clip. 5 strikes a decent balance. */
const ANCHOR_WINDOW = 5;
/** Cap on /api/scroll/recommendations limit per request. */
const FETCH_LIMIT = 20;
/** Debounce window for refetches when anchors change rapidly. */
const REFETCH_DEBOUNCE_MS = 600;

const SESSION_STORAGE_KEY = "kc_session_id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UseRecommendationFeedOpts<T extends { id: string }> {
  /** SSR-seeded items. The hook returns these untouched until the first
   *  successful recommendation fetch lands. */
  seedItems: T[];
  /** Index of the currently-active item (from useFeedGesture). The hook
   *  watches this to update the anchor list. */
  activeIndex: number;
  /** When true, the hook is enabled. When false it returns the seed
   *  unchanged — used by the env feature flag in ScrollFeedV2. */
  enabled: boolean;
  /** Builder that turns a `RecommendedKillRow` into the consumer's item
   *  shape. We keep this generic because ScrollFeedV2 deals in
   *  `FeedItem` which is a discriminated union the loader has no
   *  business knowing about. */
  toFeedItem: (row: RecommendedKillRow) => T | null;
}

export interface UseRecommendationFeedResult<T extends { id: string }> {
  /** Final items to render. Equals seed when disabled or fallback. */
  items: T[];
  /** True while the API is actively fetching (or about to fetch after
   *  debounce). UI can show a subtle progress bar at the tail if needed. */
  isFetching: boolean;
  /** True when the recommender bailed (cold start / RPC missing) — the
   *  consumer can render a hint or just keep behaving as before. */
  usingFallback: boolean;
}

function readSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    return raw && raw.length >= 8 ? raw : null;
  } catch {
    return null;
  }
}

export function useRecommendationFeed<T extends { id: string }>(
  opts: UseRecommendationFeedOpts<T>,
): UseRecommendationFeedResult<T> {
  const { seedItems, activeIndex, enabled, toFeedItem } = opts;

  // Ordered list of recently-anchored kill ids (oldest → newest).
  const [anchorIds, setAnchorIds] = useState<string[]>([]);
  const [appended, setAppended] = useState<T[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [usingFallback, setUsingFallback] = useState(true);

  const dwellTimerRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  // Set of every kill_id the hook has already added to `appended` — so
  // we never double-append on overlapping fetches.
  const appendedIdsRef = useRef<Set<string>>(new Set());
  // Set of seed ids — used to filter recommendations that are already
  // visible in the SSR-served feed.
  const seedIdsRef = useRef<Set<string>>(
    new Set(seedItems.map((it) => it.id)),
  );

  // Keep the seed-id set in sync with prop changes (PTR / URL filter).
  useEffect(() => {
    seedIdsRef.current = new Set(seedItems.map((it) => it.id));
  }, [seedItems]);

  // ─── Anchor capture (dwell-based) ────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    if (dwellTimerRef.current != null) {
      window.clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    const item = seedItems[activeIndex] ?? appended[activeIndex - seedItems.length];
    const id = item?.id;
    if (!id || !UUID_RE.test(id)) return;

    dwellTimerRef.current = window.setTimeout(() => {
      setAnchorIds((prev) => {
        // Don't add the same anchor twice in a row — that would dilute
        // the centroid by counting the same vector multiple times.
        if (prev[prev.length - 1] === id) return prev;
        const next = [...prev.filter((x) => x !== id), id];
        return next.slice(-ANCHOR_WINDOW);
      });
    }, DWELL_MS);

    return () => {
      if (dwellTimerRef.current != null) {
        window.clearTimeout(dwellTimerRef.current);
        dwellTimerRef.current = null;
      }
    };
  }, [activeIndex, enabled, seedItems, appended]);

  // ─── Debounced fetch on anchor change ────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    if (anchorIds.length === 0) return;

    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    debounceTimerRef.current = window.setTimeout(() => {
      const sessionId = readSessionId();
      const params = new URLSearchParams();
      params.set("anchors", anchorIds.join(","));
      params.set("limit", String(FETCH_LIMIT));
      if (sessionId) params.set("session", sessionId);

      const ctrl = new AbortController();
      setIsFetching(true);
      fetch(`/api/scroll/recommendations?${params.toString()}`, {
        signal: ctrl.signal,
        credentials: "same-origin",
      })
        .then((res) => {
          if (!res.ok) throw new Error(`status ${res.status}`);
          return res.json() as Promise<{
            rows?: RecommendedKillRow[];
            fallback?: boolean;
            source?: string;
          }>;
        })
        .then((body) => {
          const fallback = body?.fallback === true;
          setUsingFallback(fallback);
          const rows = Array.isArray(body?.rows) ? body!.rows! : [];
          if (rows.length === 0) {
            return;
          }
          // Filter out anything we already have in seed or appended.
          const fresh: T[] = [];
          for (const row of rows) {
            const id = row?.kill?.id;
            if (!id) continue;
            if (seedIdsRef.current.has(id)) continue;
            if (appendedIdsRef.current.has(id)) continue;
            const built = toFeedItem(row);
            if (!built) continue;
            appendedIdsRef.current.add(id);
            fresh.push(built);
            // Fire one analytics event per recommended item so we can
            // measure feed.recommendation_score downstream.
            try {
              track("feed.recommendation_score", {
                entityType: "kill",
                entityId: id,
                metadata: {
                  similarity: row.similarity,
                  anchors: anchorIds.length,
                },
              });
            } catch {
              /* tracker is best-effort */
            }
          }
          if (fresh.length > 0) {
            setAppended((prev) => [...prev, ...fresh]);
          }
        })
        .catch((err) => {
          if (err?.name === "AbortError") return;
          // Swallow — fallback to seed items is the safe default.
          console.warn("[useRecommendationFeed] fetch failed:", err);
        })
        .finally(() => setIsFetching(false));

      return () => {
        ctrl.abort();
      };
    }, REFETCH_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current != null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [anchorIds, enabled, toFeedItem]);

  // ─── Final folded list ────────────────────────────────────────────
  const items = useMemo(() => {
    if (!enabled || appended.length === 0) return seedItems;
    return [...seedItems, ...appended];
  }, [enabled, seedItems, appended]);

  return { items, isFetching, usingFallback };
}
