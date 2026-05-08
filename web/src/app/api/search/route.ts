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
import { z } from "zod";
import { searchKills, type SearchFilters } from "@/lib/supabase/search";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Query param parsing ───────────────────────────────────────────────

/**
 * Zod schema for the search query string. Coerces + caps every value
 * before it reaches the supabase layer — defence in depth against junk
 * URLs. Keeps the original semantics of `parseSearchParams`: empty
 * strings become undefined filters, lengths are capped, ranges clamped.
 */
const SearchQuery = z.object({
  q: z
    .string()
    .max(120)
    .optional()
    .transform((s) => (s ?? "").trim().slice(0, 120)),
  player: z
    .string()
    .max(32)
    .optional()
    .transform((s) => {
      if (!s) return undefined;
      const v = s.trim().toLowerCase();
      return v.length > 0 ? v : undefined;
    }),
  multi: z
    .enum(["double", "triple", "quadra", "penta"])
    .optional(),
  fb: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  tag: z
    .string()
    .max(32)
    .optional()
    .transform((s) => {
      if (!s) return undefined;
      const v = s.trim();
      return v.length > 0 ? v : undefined;
    }),
  era: z
    .string()
    .max(64)
    .optional()
    .transform((s) => {
      if (!s) return undefined;
      const v = s.trim();
      return v.length > 0 ? v : undefined;
    }),
  match: z
    .string()
    .max(64)
    .optional()
    .transform((s) => {
      if (!s) return undefined;
      const v = s.trim();
      return v.length > 0 ? v : undefined;
    }),
  min_score: z.coerce.number().min(0).max(10).optional(),
  min_rating: z.coerce.number().min(0).max(5).optional(),
  kc_role: z
    .enum(["team_killer", "team_victim", "team_assist"])
    .optional(),
  cursor: z
    .string()
    .max(256)
    .optional()
    .transform((s) => {
      if (!s) return undefined;
      const v = s.trim();
      return v.length > 0 ? v : undefined;
    }),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

interface ParsedSearch {
  q: string;
  filters: SearchFilters;
  cursor: string | undefined;
  limit: number;
}

function toFilters(parsed: z.infer<typeof SearchQuery>): ParsedSearch {
  const filters: SearchFilters = {};
  if (parsed.player) filters.playerSlug = parsed.player;
  if (parsed.multi) filters.multiKill = parsed.multi;
  if (parsed.fb) filters.isFirstBlood = true;
  if (parsed.tag) filters.tag = parsed.tag;
  if (parsed.era) filters.eraId = parsed.era;
  if (parsed.match) filters.matchExternalId = parsed.match;
  if (typeof parsed.min_score === "number") filters.minScore = parsed.min_score;
  if (typeof parsed.min_rating === "number") filters.minRating = parsed.min_rating;
  if (parsed.kc_role) filters.trackedTeam = parsed.kc_role;
  return { q: parsed.q, filters, cursor: parsed.cursor, limit: parsed.limit };
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
  // Wave 18 W6 — fixed-window rate limit. Search is more expensive
  // (full-text + facets) than scroll, so 60/min is reasonable.
  const rate = await rateLimit(req, "search", { windowSec: 60, max: 60 });
  if (rate.blocked) return rate.response!;

  const sp = req.nextUrl.searchParams;
  const parsed = SearchQuery.safeParse(Object.fromEntries(sp));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid params", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { q, filters, cursor, limit } = toFilters(parsed.data);

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
