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
 *  last clip. V21 (Wave 21.4) — extended from 5 to 12 since we now
 *  rank by dwell fraction (best engagement wins) so the longer
 *  rolling window doesn't dilute — it just gives the ranker more to
 *  pick from. */
const ANCHOR_WINDOW = 12;
/** How many anchors actually go to the recommendations API per request.
 *  V21 — picks the top-K by `dwellFraction DESC`. Smaller than
 *  ANCHOR_WINDOW so the cosine centroid stays sharp. */
const ANCHOR_TOP_K = 5;
/** Cap on /api/scroll/recommendations limit per request. */
const FETCH_LIMIT = 20;
/** Debounce window for refetches when anchors change rapidly.
 *  V21 (Wave 21.4) — tightened from 600 to 350 ms. The dwell signal
 *  is the primary driver now ; we want to follow user intent more
 *  responsively without flooding the API. */
const REFETCH_DEBOUNCE_MS = 350;

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

  // V21 (Wave 21.4) — anchor entries now carry a dwell-fraction so
  // we can rank them. The list is still capped at ANCHOR_WINDOW
  // (oldest evicted on overflow). On each fetch we sort by
  // dwellFraction DESC and take the top ANCHOR_TOP_K.
  interface AnchorEntry {
    id: string;
    dwellFraction: number;
    /** Wall-clock time of the last dwell update. Used for tie-breaking
     *  when two anchors have identical dwell — recent wins. */
    lastSeen: number;
  }
  const [anchors, setAnchors] = useState<AnchorEntry[]>([]);
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
  // V21 (Wave 21.4) — two pathways feed anchors into the ranker :
  //   1. The 1.5 s soft-threshold (existing) — ensures we always have
  //      SOMETHING in the anchor list as soon as the user lingers,
  //      even before the active→inactive transition fires the real
  //      dwell event. Defaults to dwellFraction=0.4 (= "barely past
  //      the noise floor") so the entry exists but doesn't dominate.
  //   2. The `kc:clip-dwell-recorded` CustomEvent (new) — emitted by
  //      FeedItem's analytics hook on isActive→inactive transition
  //      with the REAL dwell duration + clip length. Updates the
  //      anchor's dwellFraction in place when the entry already
  //      exists, or adds it.
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
      setAnchors((prev) => {
        const existing = prev.findIndex((a) => a.id === id);
        if (existing >= 0) {
          // Already known — refresh lastSeen but don't lower dwell.
          const copy = prev.slice();
          copy[existing] = { ...copy[existing], lastSeen: Date.now() };
          return copy;
        }
        const next: AnchorEntry = {
          id,
          dwellFraction: 0.4, // floor — real value lands via the CustomEvent
          lastSeen: Date.now(),
        };
        const merged = [...prev, next];
        if (merged.length > ANCHOR_WINDOW) {
          // Evict the entry with the LOWEST score, NOT the oldest. Keeps
          // high-engagement anchors around even if the user scrolled
          // through 30 quick clips since.
          merged.sort(
            (a, b) =>
              a.dwellFraction - b.dwellFraction ||
              a.lastSeen - b.lastSeen,
          );
          merged.shift();
        }
        return merged;
      });
    }, DWELL_MS);

    return () => {
      if (dwellTimerRef.current != null) {
        window.clearTimeout(dwellTimerRef.current);
        dwellTimerRef.current = null;
      }
    };
  }, [activeIndex, enabled, seedItems, appended]);

  // V21 — listen for the real dwell event from FeedItem and upgrade
  // the corresponding anchor's dwellFraction in place.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onDwellRecorded = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{
          itemId?: string;
          dwellFraction?: number | null;
        }>
      ).detail;
      const id = detail?.itemId;
      const frac = detail?.dwellFraction;
      if (!id || !UUID_RE.test(id) || typeof frac !== "number" || !Number.isFinite(frac)) {
        return;
      }
      setAnchors((prev) => {
        const existing = prev.findIndex((a) => a.id === id);
        if (existing >= 0) {
          // Take the MAX dwell fraction observed so far. If the user
          // came back to a clip and dwelled longer the second time,
          // we honour the better engagement signal.
          const copy = prev.slice();
          const merged = Math.max(copy[existing].dwellFraction, frac);
          copy[existing] = {
            id,
            dwellFraction: merged,
            lastSeen: Date.now(),
          };
          return copy;
        }
        // First time we see this id (the 1.5 s timer hadn't fired
        // yet before user swiped). Add fresh.
        const merged = [...prev, { id, dwellFraction: frac, lastSeen: Date.now() }];
        if (merged.length > ANCHOR_WINDOW) {
          merged.sort(
            (a, b) =>
              a.dwellFraction - b.dwellFraction ||
              a.lastSeen - b.lastSeen,
          );
          merged.shift();
        }
        return merged;
      });
    };
    window.addEventListener(
      "kc:clip-dwell-recorded",
      onDwellRecorded as EventListener,
    );
    return () => {
      window.removeEventListener(
        "kc:clip-dwell-recorded",
        onDwellRecorded as EventListener,
      );
    };
  }, [enabled]);

  // ─── Debounced fetch on anchor change ────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    if (anchors.length === 0) return;

    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    debounceTimerRef.current = window.setTimeout(() => {
      const sessionId = readSessionId();
      const params = new URLSearchParams();
      // V21 — pick the top-K anchors by dwellFraction (DESC), break
      // ties by lastSeen (DESC). High-engagement entries dominate the
      // cosine centroid ; flick-pasts and floor-rated entries stay in
      // the rolling window for replay potential but don't drive
      // recommendations.
      const topAnchors = [...anchors]
        .sort(
          (a, b) =>
            b.dwellFraction - a.dwellFraction ||
            b.lastSeen - a.lastSeen,
        )
        .slice(0, ANCHOR_TOP_K)
        .map((a) => a.id);
      params.set("anchors", topAnchors.join(","));
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
                  anchors: topAnchors.length,
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
  }, [anchors, enabled, toFeedItem]);

  // ─── Final folded list ────────────────────────────────────────────
  const items = useMemo(() => {
    if (!enabled || appended.length === 0) return seedItems;
    return [...seedItems, ...appended];
  }, [enabled, seedItems, appended]);

  return { items, isFetching, usingFallback };
}
