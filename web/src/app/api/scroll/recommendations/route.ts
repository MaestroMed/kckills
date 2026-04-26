/**
 * GET /api/scroll/recommendations — per-session similarity-ranked feed.
 *
 * Query params (all optional except for the basic safety net) :
 *   session   string  per-tab session id (kc_session_id from track.ts).
 *                    Used to compute the watched-list exclusion in the
 *                    RPC. Empty/missing → exclusion falls back to anchors
 *                    only.
 *   anchors   string  comma-separated UUIDs of the user's recently watched
 *                    kills. Empty → cold start, response is `{rows: [],
 *                    nextCursor: null, fallback: true}` so the client
 *                    knows to flip back to the recency feed.
 *   limit     int     1..50, default 10. Caps how many recommendations to
 *                    return per request.
 *   cursor    string  base64(JSON({ skip: N })). Lets the infinite query
 *                    paginate by skipping the first N rows of the rerun
 *                    similarity sort. The server caps `skip` at 200 so a
 *                    malicious client can't ask for arbitrary depth.
 *
 * Response :
 *   { rows: RecommendedKillRow[], nextCursor: string | null,
 *     fallback?: true (cold start), source: 'rec' | 'fallback' }
 *
 * Cache : `Cache-Control: private, max-age=60`. Per-session — we don't
 * want a CDN edge to share a recommendation set across users.
 *
 * Runtime : `nodejs` because the recommender loader uses
 * createServerSupabase (which depends on `next/headers` cookies()), and
 * Next.js disallows that in the edge runtime.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getRecommendedKills,
  type RecommendedKillRow,
} from "@/lib/supabase/recommendations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const MAX_ANCHORS = 20;
const MAX_SKIP = 200;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CursorPayload {
  skip: number;
}

function parseCursor(raw: string | null): CursorPayload | null {
  if (!raw) return null;
  try {
    // base64url-safe → base64
    const normalised = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(normalised, "base64").toString("utf-8");
    const obj = JSON.parse(json) as { skip?: unknown };
    if (typeof obj.skip !== "number" || !Number.isFinite(obj.skip)) {
      return null;
    }
    return { skip: Math.max(0, Math.min(MAX_SKIP, Math.floor(obj.skip))) };
  } catch {
    return null;
  }
}

function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify({ skip: payload.skip });
  return Buffer.from(json, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

interface ApiResponse {
  rows: RecommendedKillRow[];
  nextCursor: string | null;
  fallback?: true;
  source: "rec" | "fallback";
}

const HEADERS = {
  "Cache-Control": "private, max-age=60",
  "Content-Type": "application/json",
};

export async function GET(req: NextRequest): Promise<NextResponse<ApiResponse>> {
  const url = new URL(req.url);
  const sessionId = (url.searchParams.get("session") ?? "").slice(0, 64) || null;
  const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw)))
    : DEFAULT_LIMIT;
  const anchorsRaw = url.searchParams.get("anchors") ?? "";
  const cursor = parseCursor(url.searchParams.get("cursor"));
  const skip = cursor?.skip ?? 0;

  // Validate + dedup + cap the anchor list before it crosses module
  // boundaries. Anything that's not a valid UUID is silently dropped.
  const anchorIds = Array.from(
    new Set(
      anchorsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => UUID_RE.test(s)),
    ),
  ).slice(0, MAX_ANCHORS);

  // Cold start : no anchors → empty response with `fallback: true` so the
  // client can swap back to the recency feed without a second round-trip.
  if (anchorIds.length === 0) {
    const body: ApiResponse = {
      rows: [],
      nextCursor: null,
      fallback: true,
      source: "fallback",
    };
    return NextResponse.json(body, { headers: HEADERS });
  }

  try {
    // We over-fetch by `skip + limit` so cursor-based pagination lands
    // on the same global similarity-ranked set every time within the
    // 5-min loader cache window. Cheaper than re-running the RPC with
    // a real OFFSET.
    const fetched = await getRecommendedKills({
      sessionId,
      anchorKillIds: anchorIds,
      limit: skip + limit,
    });

    const window = fetched.slice(skip, skip + limit);
    const hasMore = fetched.length > skip + limit;
    const nextCursor = hasMore
      ? encodeCursor({ skip: skip + limit })
      : null;

    const body: ApiResponse = {
      rows: window,
      nextCursor,
      source: "rec",
    };
    return NextResponse.json(body, { headers: HEADERS });
  } catch (err) {
    // Swallow — the recommender loader already swallows everything, but
    // this is the last line of defence for an unexpected throw inside
    // the encode/cursor path.
    console.warn("[api/scroll/recommendations] threw:", err);
    const body: ApiResponse = {
      rows: [],
      nextCursor: null,
      fallback: true,
      source: "fallback",
    };
    return NextResponse.json(body, { headers: HEADERS });
  }
}
