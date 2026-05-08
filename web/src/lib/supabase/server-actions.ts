"use server";

/**
 * server-actions.ts — Wave 15 (2026-05-08)
 *
 * Server Actions that mutate cached state. Called from API routes
 * (which proxy external workers) and from interactive client UI.
 *
 * `revalidateHeroStats` — token-gated invalidation of the
 * `'hero-stats'` cache tag set up in `hero-stats-cached.ts`. The
 * worker calls this via the `/api/revalidate/hero-stats` POST
 * endpoint after publishing a new match, so the homepage hero card
 * shows fresh data on the next visit instead of waiting up to the
 * 5-minute TTL.
 *
 * Token-gating rationale : the endpoint is public-facing (the worker
 * runs on a residential IP, no shared secret in transit), so a
 * matching token in the body is the simplest DOS-proof shape.
 */
import { revalidateTag } from "next/cache";

import { HERO_STATS_TAG } from "./hero-stats-cached";

const REVALIDATE_TOKEN = process.env.KCKILLS_REVALIDATE_TOKEN;

/** Revalidate the homepage hero-stats cache. Called by the worker
 *  after a new match write. Token-gated so the endpoint can be
 *  exposed publicly without becoming a DOS vector. */
export async function revalidateHeroStats(
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!REVALIDATE_TOKEN) {
    return { ok: false, error: "Revalidate not configured" };
  }
  if (token !== REVALIDATE_TOKEN) {
    return { ok: false, error: "Invalid token" };
  }
  // Next 16 changed `revalidateTag()` signature : a cacheLife profile
  // is now mandatory as the 2nd argument. `'minutes'` matches the
  // 5-min TTL on the hero-stats unstable_cache wrappers — they'll
  // refetch on the next request and re-prime the cache for that
  // profile's bucket.
  revalidateTag(HERO_STATS_TAG, "minutes");
  return { ok: true };
}
