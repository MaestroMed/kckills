/**
 * GET /api/scroll/catalog — offset-paged walk of the FULL KC-positive
 * clip catalogue (Wave 37).
 *
 * Why it exists : the /scroll SSR feed is capped (SCROLL_KILLS_LIMIT,
 * default 250 pre-filter ≈ 150 rendered) to keep the RSC payload under
 * the mobile crash ceiling, and the recommendation engine only appends
 * similarity neighbours — neither guarantees the viewer can ever reach
 * ALL published clips. This endpoint pages through the exact /scroll
 * predicate (published + kill_visible + team_killer + clip + thumbnail)
 * so the client backfill (useCatalogBackfill) can append the long tail
 * until the catalogue is exhausted.
 *
 * Query params :
 *   cursor  int  row offset into the (score DESC, created_at DESC, id)
 *                total order. Default 0. Capped at MAX_OFFSET.
 *   limit   int  1..50, default 40.
 *
 * Response :
 *   { rows: RecommendedKillRow[], nextCursor: number | null, total }
 *
 * Rows reuse the RecommendedKillRow envelope ({ kill, similarity: 0 })
 * so the client folds them through the SAME recommendationToFeedItem
 * mapper as the recommendation engine — no new view-model.
 *
 * Cache : public, s-maxage=300 — the payload is identical for every
 * visitor (public rows, no personalisation), so the CDN absorbs
 * repeat deep-scroll traffic instead of Supabase (egress guard).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getPublishedKcKillCount,
  getPublishedKcKillsPage,
} from "@/lib/supabase/kills";
import type { RecommendedKillRow } from "@/lib/supabase/recommendations";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 40;
/** ~6× today's catalogue (851) — bumps trivially, blocks silly walks. */
const MAX_OFFSET = 5000;

const Query = z.object({
  cursor: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

interface ApiResponse {
  rows: RecommendedKillRow[];
  nextCursor: number | null;
  total: number;
}

const HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
  "Content-Type": "application/json",
};

export async function GET(
  req: NextRequest,
): Promise<NextResponse<ApiResponse> | NextResponse> {
  // Same budget as the recommendations endpoint — a full catalogue walk
  // is ~22 requests, so 30/min leaves headroom for fast scrollers
  // without letting a bot hammer the paged SELECT.
  const rate = await rateLimit(req, "scroll-catalog", { windowSec: 60, max: 30 });
  if (rate.blocked) return rate.response!;

  const url = new URL(req.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid params", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { cursor, limit } = parsed.data;

  const [page, total] = await Promise.all([
    getPublishedKcKillsPage(cursor, limit),
    getPublishedKcKillCount(),
  ]);

  // Wave 38.2 — an empty page while the count says rows remain means the
  // paged SELECT failed (the loader swallows Supabase errors into []),
  // not that the catalogue ended. Without this check we replied
  // nextCursor: null AND the CDN cached that "exhausted" verdict for 5
  // minutes — every scroller hitting the tail during a Supabase blip got
  // a feed that permanently claimed "you've seen everything". Return a
  // retryable, uncacheable error instead ; the client's !res.ok path
  // keeps the cursor and retries on the next swipe.
  if (page.length === 0 && cursor < total) {
    return NextResponse.json(
      { error: "upstream" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // A short page means we ran off the end of the catalogue. A full page
  // MAY still be the last one — the client eats one extra empty fetch
  // and then sees nextCursor: null, which is cheaper than a count-based
  // comparison racing new publications.
  const nextCursor = page.length === limit ? cursor + limit : null;

  const body: ApiResponse = {
    rows: page.map((kill) => ({ kill, similarity: 0 })),
    nextCursor,
    total,
  };
  return NextResponse.json(body, { headers: HEADERS });
}
