import { NextResponse } from "next/server";
import {
  getCurrentLiveMatch,
  getLiveMatchScore,
  getRecentLiveKills,
  type LiveKillRow,
  type LiveMatchRow,
} from "@/lib/supabase/live";

/**
 * GET /api/live/state — payload for the live "Hot Now" banner + /live page.
 *
 * Response shape :
 *   {
 *     liveMatch:  LiveMatchRow | null,
 *     recentKills: LiveKillRow[],
 *     score:       { kc: number, opp: number }
 *   }
 *
 *   * liveMatch === null when no KC match is currently in the live
 *     window — the client treats this as "hide the banner".
 *   * recentKills returns up to 12 freshly-published kills for the live
 *     match, ordered newest first. Empty array when match is live but
 *     no kills have been published yet.
 *   * score is the running KC vs opponent kill count across all games
 *     of the match. Used by /live to render "KC 4-2 OPP".
 *
 * Caching :
 *   * `revalidate = 10` (Next.js ISR) — at most 6 SSR reads per minute
 *     to Supabase. The client polls every 30 s when idle, every 15 s
 *     when a match is live, so the cache typically absorbs every
 *     visitor hit.
 *   * `Cache-Control: public, s-maxage=10, stale-while-revalidate=20`
 *     — CDN-level cache, lets Vercel serve the same JSON to every
 *     visitor for 10 s without re-running this handler.
 */
export const revalidate = 10;
// 2026-05-13 — query param ?since=<iso> bypasses the cache entirely.
// Without `dynamic = 'force-dynamic'` for that path the route would
// serve a cached payload regardless of `since`. We can't easily mix
// per-query caching with revalidate so we degrade : when ?since is
// passed, we recompute every call.
export const dynamic = "auto";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = url.searchParams.get("since") ?? undefined;

  let liveMatch: LiveMatchRow | null = null;
  let recentKills: LiveKillRow[] = [];
  let score = { kc: 0, opp: 0 };

  try {
    liveMatch = await getCurrentLiveMatch();
    if (liveMatch) {
      const [killsResult, scoreResult] = await Promise.all([
        getRecentLiveKills(liveMatch.id, {
          sinceIso: since,
          limit: since ? 30 : 12,
        }),
        // Skip the score query when caller is polling deltas — they
        // already have the totals from the initial load.
        since ? Promise.resolve({ kc: 0, opp: 0 }) : getLiveMatchScore(liveMatch.id),
      ]);
      recentKills = killsResult;
      score = scoreResult;
    }
  } catch (err) {
    // Never throw out of this handler — the UI degrades to "no live"
    // on failure rather than blowing up the global layout.
    console.warn("[/api/live/state] threw:", err);
  }

  const cacheHeader = since
    ? // delta query — no CDN cache, client browser only
      "no-cache, no-store, must-revalidate"
    : "public, s-maxage=10, stale-while-revalidate=20";

  return NextResponse.json(
    { liveMatch, recentKills, score },
    {
      headers: {
        "Cache-Control": cacheHeader,
      },
    },
  );
}
