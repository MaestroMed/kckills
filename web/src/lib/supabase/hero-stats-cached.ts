/**
 * hero-stats-cached.ts — Wave 13n (2026-05-07)
 *
 * Cross-request caching layer on top of `hero-stats.ts`. The base file
 * already uses React's `cache()` for request-scoped dedup ; this file
 * adds Next's `unstable_cache` so the homepage hero data is cached
 * across requests with a TTL + tag-based invalidation.
 *
 * Why a separate file instead of patching `hero-stats.ts` ?
 *   * The base fetchers accept a `buildTime: boolean` parameter that
 *     swaps the Supabase client (anon vs cookie-aware). The cached
 *     wrapper always uses `buildTime: true` (anon) so the cache is
 *     keyed identically across requests — cookies aren't a cache key.
 *   * Wrapping at the call site keeps `hero-stats.ts` callable without
 *     caching when needed (e.g. admin previews, Server Actions that
 *     need fresh data).
 *
 * Cache invalidation :
 *   The worker writes a new match → calls a Server Action that runs
 *   `revalidateTag('hero-stats')` and the homepage shows fresh data
 *   on the next visit. Until that wiring lands, we rely on the TTL.
 *
 * TTLs :
 *   getHeroLastMatch    — 5 min (matches finish, then a new one
 *                          appears within 30 min — 5 min is a balanced
 *                          freshness/load knob)
 *   getHeroCareerStats  — 5 min (kills counter ticks up as the worker
 *                          publishes new clips)
 *   getHeroTopScorer    — 30 min (changes only on big multi-kill days)
 *   getPublishedKcKillCount — 5 min (mirrors career stats cadence)
 */

import { unstable_cache } from "next/cache";
import {
  getHeroLastMatch as _getHeroLastMatch,
  getHeroCareerStats as _getHeroCareerStats,
  getHeroTopScorer as _getHeroTopScorer,
  type HeroLastMatch,
  type HeroCareerStats,
  type HeroTopScorer,
} from "./hero-stats";
import { getPublishedKcKillCount as _getPublishedKcKillCount } from "./kills";

const HERO_TAG = "hero-stats" as const;

export const getCachedHeroLastMatch = unstable_cache(
  async (): Promise<HeroLastMatch | null> => _getHeroLastMatch(true),
  ["hero-last-match"],
  { revalidate: 300, tags: [HERO_TAG] },
);

export const getCachedHeroCareerStats = unstable_cache(
  async (): Promise<HeroCareerStats | null> => _getHeroCareerStats(true),
  ["hero-career-stats"],
  { revalidate: 300, tags: [HERO_TAG] },
);

export const getCachedHeroTopScorer = unstable_cache(
  async (): Promise<HeroTopScorer | null> => _getHeroTopScorer(true),
  ["hero-top-scorer"],
  { revalidate: 1800, tags: [HERO_TAG] },
);

export const getCachedPublishedKcKillCount = unstable_cache(
  async (): Promise<number> => _getPublishedKcKillCount({ buildTime: true }),
  ["published-kc-kill-count"],
  { revalidate: 300, tags: [HERO_TAG] },
);

/** Re-export the tag constant so server actions can revalidate
 *  ('hero-stats') without hard-coding the string. */
export const HERO_STATS_TAG = HERO_TAG;
