/**
 * GET /api/search — Public kill search endpoint (Wave 6, Agent Z).
 *
 * Implements CLAUDE.md §6.5 — full-text + filter chips. Hit by both
 * SearchBar (debounced typing → live results) and the /search page
 * (server-render + infinite scroll).
 *
 * Query params :
 *   q                  — search query (sent to PostgreSQL FTS websearch)
 *   player             — IGN slug (lowercase)
 *   multi              — 'double' | 'triple' | 'quadra' | 'penta'
 *   fb                 — '1'/'true' to require first blood
 *   tag                — single AI tag from kills.ai_tags
 *   era                — KCEra.id (resolved to date range server-side)
 *   match              — match external_id
 *   min_score          — highlight_score floor
 *   min_rating         — avg_rating floor
 *   kc_role            — 'team_killer' | 'team_victim' | 'team_assist'
 *   cursor             — opaque base64 cursor from previous response
 *   limit              — page size (default 24, max 60)
 *
 * Response :
 *   200 { rows: PublishedKillRow[], nextCursor: string | null, total: number }
 *        total = rows.length on this page (cursor-based — we don't run a
 *        COUNT() to keep egress low).
 *
 * Cache : 60s edge cache + 5min SWR. Search results are eventually-consistent
 *         and the cursor token already encodes the cutoff timestamp.
 *
 * Runtime : nodejs (NOT edge) because `createServerSupabase()` reads
 *   request cookies for the optional auth-aware session. `cookies()` is
 *   not available in the edge runtime. The endpoint is still cached
 *   aggressively at the edge via the Cache-Control header.
 */

import { NextRequest, NextResponse } from "next/server";
import { searchKills, type SearchFilters } from "@/lib/supabase/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Query param parsing ───────────────────────────────────────────────

const ALLOWED_MULTI = new Set(["double", "triple", "quadra", "penta"]);
const ALLOWED_KC_ROLE = new Set(["team_killer", "team_victim", "team_assist"]);

/**
 * Parse + sanitise the query string into a SearchFilters object plus
 * the bare `q` and pagination opts. All values are length-capped and
 * type-narrowed before reaching the supabase layer — defence in depth
 * against junk URLs.
 */
function parseSearchParams(sp: URLSearchParams): {
  q: string;
  filters: SearchFilters;
  cursor: string | undefined;
  limit: number;
} {
  const q = (sp.get("q") ?? "").trim().slice(0, 120);

  const filters: SearchFilters = {};

  const player = sp.get("player")?.trim().toLowerCase();
  if (player && player.length > 0 && player.length <= 32) {
    filters.playerSlug = player;
  }

  const multi = sp.get("multi")?.trim().toLowerCase();
  if (multi && ALLOWED_MULTI.has(multi)) {
    filters.multiKill = multi as SearchFilters["multiKill"];
  }

  const fb = sp.get("fb");
  if (fb === "1" || fb === "true") {
    filters.isFirstBlood = true;
  }

  const tag = sp.get("tag")?.trim();
  if (tag && tag.length > 0 && tag.length <= 32) {
    filters.tag = tag;
  }

  const era = sp.get("era")?.trim();
  if (era && era.length > 0 && era.length <= 64) {
    filters.eraId = era;
  }

  const match = sp.get("match")?.trim();
  if (match && match.length > 0 && match.length <= 64) {
    filters.matchExternalId = match;
  }

  const minScoreRaw = sp.get("min_score");
  if (minScoreRaw) {
    const n = Number(minScoreRaw);
    if (Number.isFinite(n) && n >= 0 && n <= 10) {
      filters.minScore = n;
    }
  }

  const minRatingRaw = sp.get("min_rating");
  if (minRatingRaw) {
    const n = Number(minRatingRaw);
    if (Number.isFinite(n) && n >= 0 && n <= 5) {
      filters.minRating = n;
    }
  }

  const kcRole = sp.get("kc_role")?.trim();
  if (kcRole && ALLOWED_KC_ROLE.has(kcRole)) {
    filters.trackedTeam = kcRole as SearchFilters["trackedTeam"];
  }

  const cursorRaw = sp.get("cursor")?.trim();
  // Cursor format is base64url — cap length defensively. Real cursors
  // are <100 chars, anything bigger is a malformed URL.
  const cursor = cursorRaw && cursorRaw.length > 0 && cursorRaw.length <= 256 ? cursorRaw : undefined;

  const limitRaw = Number(sp.get("limit") ?? "24");
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(60, Math.floor(limitRaw)))
    : 24;

  return { q, filters, cursor, limit };
}

// ─── Server-side analytics ─────────────────────────────────────────────

/**
 * Fire a `search.executed` event server-side via /api/track. Uses
 * sendBeacon-equivalent fetch — fire-and-forget, never awaits the
 * response on the hot path.
 *
 * We send minimal metadata : query length (NOT the query — protects
 * users from search-history snooping), the filter chip count, and the
 * page-1 result size. /api/track sanitises further (drops PII-shaped
 * strings, caps values).
 *
 * This complements the client-side `track('search.executed')` fired
 * from SearchBar — having both gives us a sanity check : client-side
 * is what users SEE (real opens), server-side is what was QUERIED
 * (includes prefetches + crawler hits).
 */
function fireSearchExecutedEvent(opts: {
  qLen: number;
  hasFilters: boolean;
  results: number;
  origin: string;
  cookieHeader: string | null;
}): void {
  // Build the absolute URL since fetch from a server route handler
  // doesn't infer the host. Origin comes from the inbound request.
  const url = `${opts.origin}/api/track`;
  const body = JSON.stringify({
    events: [
      {
        event_type: "search.executed",
        metadata: {
          q_len: opts.qLen,
          has_filters: opts.hasFilters,
          results: opts.results,
          source: "api_search_route",
        },
        // Server-side events don't have a real session — synthesize a
        // stable per-request id so /api/track's rate limiter has
        // something to bucket on without affecting real client sessions.
        anonymous_user_id: "server",
        session_id: `server-${Math.floor(Date.now() / 60000)}`,
        client_ts: new Date().toISOString(),
        client_kind: "desktop",
      },
    ],
  });

  // Forward the cookie header so /api/track can resolve auth.user.id
  // when the search came from a logged-in user.
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.cookieHeader) headers["cookie"] = opts.cookieHeader;

  // Fire-and-forget — explicitly do NOT await. Wrap in a try/catch
  // because top-level fetch errors (e.g. ECONNREFUSED in a self-call
  // during build) shouldn't 500 the search response.
  try {
    void fetch(url, { method: "POST", headers, body, keepalive: true }).catch(() => undefined);
  } catch {
    /* swallow — analytics must never break the user-facing path */
  }
}

// ─── Handler ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { q, filters, cursor, limit } = parseSearchParams(req.nextUrl.searchParams);

  const result = await searchKills(q, filters, { cursor, limit });

  const hasFilters =
    !!filters.playerSlug ||
    !!filters.multiKill ||
    filters.isFirstBlood === true ||
    !!filters.tag ||
    !!filters.eraId ||
    !!filters.matchExternalId ||
    typeof filters.minScore === "number" ||
    typeof filters.minRating === "number" ||
    !!filters.trackedTeam;

  // Fire the analytics event AFTER the response has been computed —
  // never await it. The fetch call uses keepalive so the request
  // survives even if the response stream closes.
  fireSearchExecutedEvent({
    qLen: q.length,
    hasFilters,
    results: result.rows.length,
    origin: req.nextUrl.origin,
    cookieHeader: req.headers.get("cookie"),
  });

  return NextResponse.json(
    {
      rows: result.rows,
      nextCursor: result.nextCursor,
      total: result.rows.length,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
