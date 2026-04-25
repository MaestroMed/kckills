/**
 * Server-side search loader for kills (Wave 6, Agent Z).
 *
 * Implements CLAUDE.md §6.5 — full-text search via the `search_vector`
 * tsvector column on `kills` (migration 001 + trigger
 * `fn_update_kill_search_vector`, GIN-indexed via `idx_kills_search`).
 *
 * Why a dedicated module instead of extending `kills.ts` :
 *   - Search has fundamentally different filter semantics (sliders, multi-
 *     facets, opaque cursor) that would balloon the existing fetchers.
 *   - We need both a tsvector path (websearch when query is non-empty)
 *     AND a fallback ILIKE path so the lib still works on a fresh staging
 *     DB where the GIN index hasn't been populated yet.
 *
 * RLS : the anon Supabase client only sees rows that match the
 *   "Public kills" policy (status = 'published'). The status filter is
 *   re-applied here defensively for the legacy `status` column AND the
 *   new `publication_status` (PR23 split-status migration 027).
 *
 * Cursor format : base64(JSON({score, created_at, id})). The id breaks
 * ties so identical (score, created_at) pairs don't drop or duplicate
 * rows across pages. Stable across days.
 */

import "server-only";
import { createAnonSupabase, createServerSupabase, rethrowIfDynamic } from "./server";
import type { PublishedKillRow } from "./kills";
import { getEraById } from "@/lib/eras";

// ─── Public types ──────────────────────────────────────────────────────

/**
 * Filter spec accepted by `searchKills`. All fields are optional —
 * passing an empty object returns the full published catalog (subject
 * to limit + cursor). Combine with the `query` arg for FTS narrowing.
 *
 * Note on `playerSlug` : we accept the IGN-as-slug (lowercased) and
 * resolve to the player UUID at query time. The resolution miss case
 * (slug doesn't match any tracked player) returns an empty result set
 * rather than ignoring the filter — fail-loud beats fail-silent here.
 */
export interface SearchFilters {
  /** Killer player's slug (= lowercase ign). Resolved to UUID server-side. */
  playerSlug?: string;
  /** Multi-kill class. Matches `kills.multi_kill` exactly. */
  multiKill?: "double" | "triple" | "quadra" | "penta";
  /** First-blood toggle. Only "true" filters; undefined = no filter. */
  isFirstBlood?: boolean;
  /** Single AI tag from `kills.ai_tags`. Uses .contains([tag]) under the hood. */
  tag?: string;
  /** KCEra.id — translated to a date range on `games.matches.scheduled_at`. */
  eraId?: string;
  /** Match's `external_id` — narrows to a single game's kills. */
  matchExternalId?: string;
  /** Highlight score floor (0-10). */
  minScore?: number;
  /** Average rating floor (0-5). */
  minRating?: number;
  /** Tracked-team relationship: 'team_killer' = KC kill, 'team_victim' = KC death. */
  trackedTeam?: "team_killer" | "team_victim" | "team_assist";
}

export interface SearchOpts {
  /** Page size. Caller-side cap is enforced (max 60). */
  limit?: number;
  /** Opaque cursor from a previous response's `nextCursor`. */
  cursor?: string;
  /** Build-time mode (sitemap, ISR pre-render) — uses the anon client. */
  buildTime?: boolean;
}

export interface SearchResult {
  rows: PublishedKillRow[];
  /** Pass to the next call's `opts.cursor`. NULL = no more rows. */
  nextCursor: string | null;
}

// ─── Cursor helpers ────────────────────────────────────────────────────

/** Compact triplet stored inside the cursor. */
interface CursorPayload {
  s: number; // highlight_score (or -1 if NULL)
  c: string; // created_at ISO
  i: string; // last row id (tie-breaker)
}

function encodeCursor(payload: CursorPayload): string {
  // Buffer.from is available in Node + Edge runtimes.
  // base64url avoids "+/=" so the cursor is URL-safe without escaping.
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (
      typeof parsed.s === "number" &&
      typeof parsed.c === "string" &&
      typeof parsed.i === "string"
    ) {
      return { s: parsed.s, c: parsed.c, i: parsed.i };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Field selection ───────────────────────────────────────────────────
//
// Mirror the same SELECT clause as `getPublishedKills` so the `rows`
// returned here are drop-in compatible with the rest of the UI (KillCard,
// ClipsGrid, etc.). Duplicating the literal vs importing keeps `search.ts`
// independent of `kills.ts`'s internal renames — search is a different
// surface and shouldn't break when an unrelated grid loader changes.

const SEARCH_KILL_SELECT = `
  id,
  killer_player_id,
  killer_champion,
  victim_champion,
  game_time_seconds,
  highlight_score,
  avg_rating,
  rating_count,
  clip_url_horizontal,
  clip_url_vertical,
  clip_url_vertical_low,
  hls_master_url,
  thumbnail_url,
  og_image_url,
  assets_manifest,
  ai_description,
  ai_description_fr,
  ai_description_en,
  ai_description_ko,
  ai_description_es,
  ai_tags,
  multi_kill,
  is_first_blood,
  tracked_team_involvement,
  kill_visible,
  lane_phase,
  fight_type,
  objective_context,
  matchup_lane,
  champion_class,
  game_minute_bucket,
  impression_count,
  comment_count,
  created_at,
  data_source,
  status,
  pipeline_status,
  publication_status,
  qc_status,
  asset_status,
  games!inner (
    external_id,
    game_number,
    matches!inner (
      id,
      external_id,
      scheduled_at,
      stage,
      format
    )
  )
`.trim();

// Mirror RawKillSelect from kills.ts so we can normalize without
// importing the private interface. Same shape, same null-tolerance.
interface RawSearchRow {
  id?: string | null;
  killer_player_id?: string | null;
  killer_champion?: string | null;
  victim_champion?: string | null;
  game_time_seconds?: number | null;
  highlight_score?: number | null;
  avg_rating?: number | null;
  rating_count?: number | null;
  clip_url_horizontal?: string | null;
  clip_url_vertical?: string | null;
  clip_url_vertical_low?: string | null;
  hls_master_url?: string | null;
  thumbnail_url?: string | null;
  og_image_url?: string | null;
  assets_manifest?: PublishedKillRow["assets_manifest"];
  ai_description?: string | null;
  ai_description_fr?: string | null;
  ai_description_en?: string | null;
  ai_description_ko?: string | null;
  ai_description_es?: string | null;
  ai_tags?: string[] | null;
  multi_kill?: string | null;
  is_first_blood?: boolean | null;
  tracked_team_involvement?: string | null;
  kill_visible?: boolean | null;
  lane_phase?: PublishedKillRow["lane_phase"];
  fight_type?: PublishedKillRow["fight_type"];
  objective_context?: PublishedKillRow["objective_context"];
  matchup_lane?: PublishedKillRow["matchup_lane"];
  champion_class?: PublishedKillRow["champion_class"];
  game_minute_bucket?: PublishedKillRow["game_minute_bucket"];
  impression_count?: number | null;
  comment_count?: number | null;
  created_at?: string | null;
  data_source?: string | null;
  status?: string | null;
  pipeline_status?: string | null;
  publication_status?: string | null;
  qc_status?: string | null;
  asset_status?: string | null;
  games?: RawSearchGame | RawSearchGame[] | null;
}

interface RawSearchGame {
  external_id?: string | null;
  game_number?: number | null;
  matches?: RawSearchMatch | RawSearchMatch[] | null;
}

interface RawSearchMatch {
  id?: string | null;
  external_id?: string | null;
  scheduled_at?: string | null;
  stage?: string | null;
  format?: string | null;
}

function normalize(row: RawSearchRow): PublishedKillRow {
  const games = Array.isArray(row.games) ? row.games[0] ?? null : row.games ?? null;
  let gamesNormalized: PublishedKillRow["games"] = null;
  if (games) {
    const matches = Array.isArray(games.matches)
      ? games.matches[0] ?? null
      : games.matches ?? null;
    gamesNormalized = {
      external_id: String(games.external_id ?? ""),
      game_number: Number(games.game_number ?? 1),
      matches: matches
        ? {
            id: String(matches.id ?? ""),
            external_id: String(matches.external_id ?? ""),
            scheduled_at: matches.scheduled_at ?? null,
            stage: matches.stage ?? null,
            format: matches.format ?? null,
          }
        : null,
    };
  }
  return {
    id: String(row.id ?? ""),
    killer_player_id: row.killer_player_id ?? null,
    killer_champion: row.killer_champion ?? null,
    victim_champion: row.victim_champion ?? null,
    game_time_seconds: row.game_time_seconds ?? null,
    highlight_score: row.highlight_score ?? null,
    avg_rating: row.avg_rating ?? null,
    rating_count: Number(row.rating_count ?? 0),
    clip_url_horizontal: row.clip_url_horizontal ?? null,
    clip_url_vertical: row.clip_url_vertical ?? null,
    clip_url_vertical_low: row.clip_url_vertical_low ?? null,
    hls_master_url: row.hls_master_url ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    og_image_url: row.og_image_url ?? null,
    assets_manifest: row.assets_manifest ?? null,
    ai_description: row.ai_description ?? null,
    ai_description_fr: row.ai_description_fr ?? null,
    ai_description_en: row.ai_description_en ?? null,
    ai_description_ko: row.ai_description_ko ?? null,
    ai_description_es: row.ai_description_es ?? null,
    ai_tags: Array.isArray(row.ai_tags) ? row.ai_tags : [],
    multi_kill: row.multi_kill ?? null,
    is_first_blood: Boolean(row.is_first_blood),
    tracked_team_involvement: row.tracked_team_involvement ?? null,
    kill_visible: row.kill_visible ?? null,
    lane_phase: row.lane_phase ?? null,
    fight_type: row.fight_type ?? null,
    objective_context: row.objective_context ?? null,
    matchup_lane: row.matchup_lane ?? null,
    champion_class: row.champion_class ?? null,
    game_minute_bucket: row.game_minute_bucket ?? null,
    impression_count: Number(row.impression_count ?? 0),
    comment_count: Number(row.comment_count ?? 0),
    created_at: String(row.created_at ?? ""),
    data_source: row.data_source ?? null,
    status: row.status ?? null,
    pipeline_status: row.pipeline_status ?? null,
    publication_status: row.publication_status ?? null,
    qc_status: row.qc_status ?? null,
    asset_status: row.asset_status ?? null,
    games: gamesNormalized,
  };
}

// ─── Player slug → UUID resolver ───────────────────────────────────────

/**
 * Resolve an IGN-as-slug (`caliste`, `canna`, …) to a player UUID.
 * Returns null if no tracked player matches — caller should treat as
 * "no results" so the user sees a clean empty state instead of the
 * filter being silently dropped.
 */
async function resolvePlayerSlugToId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  slug: string,
): Promise<string | null> {
  const trimmed = slug.trim();
  if (!trimmed) return null;
  try {
    const { data, error } = await supabase
      .from("players")
      .select("id")
      .ilike("ign", trimmed)
      .limit(1);
    if (error) {
      console.warn("[supabase/search] resolvePlayerSlugToId error:", error.message);
      return null;
    }
    const row = (data ?? [])[0] as { id?: string | null } | undefined;
    return row?.id ?? null;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/search] resolvePlayerSlugToId threw:", err);
    return null;
  }
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Search published kills with optional FTS query + filter chips.
 *
 * Behaviour :
 *   - Empty `query` + empty filters → returns the most recent / highest-scored
 *     published kills (same default ordering as the homepage feed).
 *   - Non-empty `query` → applies `.textSearch('search_vector', q, ...)`.
 *     Falls back to ILIKE on `killer_champion || victim_champion ||
 *     ai_description` if the textSearch call errors (covers "missing
 *     migration on staging" + "tsquery syntax error" cases).
 *   - All filters AND together. Cursor pagination by (score_desc,
 *     created_at_desc, id_desc) — opaque base64 token in `nextCursor`.
 *
 * Always returns — never throws. On any unexpected error returns
 * `{rows: [], nextCursor: null}` so the UI degrades to "no results"
 * rather than 500'ing.
 */
export async function searchKills(
  query: string,
  filters: SearchFilters,
  opts: SearchOpts = {},
): Promise<SearchResult> {
  const limit = Math.max(1, Math.min(60, Math.floor(opts.limit ?? 24)));
  // Fetch limit+1 so we know whether there's a next page without an
  // extra COUNT() query (that would double our egress per call).
  const fetchLimit = limit + 1;

  try {
    const supabase = opts.buildTime ? createAnonSupabase() : await createServerSupabase();

    // Resolve player slug → UUID up front. Empty result on miss means
    // we short-circuit the rest of the query — cheaper than running a
    // doomed full table scan.
    let resolvedKillerId: string | null = null;
    if (filters.playerSlug) {
      resolvedKillerId = await resolvePlayerSlugToId(supabase, filters.playerSlug);
      if (!resolvedKillerId) {
        return { rows: [], nextCursor: null };
      }
    }

    // Resolve era → date window. Unknown era id = no results (don't
    // silently ignore an invalid filter).
    let dateRange: { startISO: string; endISO: string } | null = null;
    if (filters.eraId) {
      const era = getEraById(filters.eraId);
      if (!era) {
        return { rows: [], nextCursor: null };
      }
      dateRange = {
        startISO: `${era.dateStart}T00:00:00Z`,
        endISO: `${era.dateEnd}T23:59:59Z`,
      };
    }

    // Build the base query. We always join games!inner+matches!inner
    // (same as `getPublishedKills`) so the row shape stays consistent
    // and we can filter on match-level fields (era window, externalId).
    let q = supabase
      .from("kills")
      .select(SEARCH_KILL_SELECT)
      // PR23 split-status fallback (mirrors getPublishedKills).
      .or(
        "publication_status.eq.published," +
          "and(publication_status.is.null,status.eq.published)",
      )
      .eq("kill_visible", true)
      // Real R2 asset required — same gate as the scroll feed so search
      // never returns clip-less rows that the UI can't render.
      .not("clip_url_vertical", "is", null)
      .not("thumbnail_url", "is", null);

    // ── FTS / fallback ILIKE ───────────────────────────────────────
    const trimmedQ = query.trim();
    if (trimmedQ.length > 0) {
      // websearch type accepts user-friendly syntax (foo bar, "phrase",
      // -negation, OR). The 'french' config matches the trigger that
      // builds the search_vector column.
      q = q.textSearch("search_vector", trimmedQ, {
        type: "websearch",
        config: "french",
      });
    }

    // ── Filter chips ───────────────────────────────────────────────
    if (resolvedKillerId) {
      q = q.eq("killer_player_id", resolvedKillerId);
    }
    if (filters.multiKill) {
      q = q.eq("multi_kill", filters.multiKill);
    }
    if (filters.isFirstBlood === true) {
      q = q.eq("is_first_blood", true);
    }
    if (filters.tag) {
      // ai_tags is a jsonb array — `cs` (contains) checks the value
      // contains the given array. Wrap the single tag.
      q = q.contains("ai_tags", [filters.tag]);
    }
    if (filters.matchExternalId) {
      q = q.eq("games.matches.external_id", filters.matchExternalId);
    }
    if (typeof filters.minScore === "number" && Number.isFinite(filters.minScore)) {
      q = q.gte("highlight_score", filters.minScore);
    }
    if (typeof filters.minRating === "number" && Number.isFinite(filters.minRating)) {
      q = q.gte("avg_rating", filters.minRating);
    }
    if (filters.trackedTeam) {
      q = q.eq("tracked_team_involvement", filters.trackedTeam);
    }
    if (dateRange) {
      q = q
        .gte("games.matches.scheduled_at", dateRange.startISO)
        .lte("games.matches.scheduled_at", dateRange.endISO);
    }

    // ── Cursor pagination ──────────────────────────────────────────
    // We sort by (highlight_score DESC NULLS LAST, created_at DESC, id DESC)
    // so the cursor must compare the same triplet. PostgREST doesn't expose
    // a clean "tuple <" operator across multiple sort keys, so we fall
    // back to a pragmatic compromise : use created_at as the primary
    // cursor key and apply an in-memory dedupe on the id when we read
    // back the page. Rows with identical created_at on the boundary
    // are extraordinarily rare (worker writes batch on different
    // microsecond timestamps), but the +1 fetch buffer + id tie-break
    // catches them.
    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        // PostgREST `lt` on a timestamptz string is a lexicographical
        // ISO compare, which equals chronological compare when both
        // ends use the same Z-terminated UTC format.
        q = q.lt("created_at", decoded.c);
      }
    }

    q = q
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(fetchLimit);

    const { data, error } = await q;

    if (error) {
      console.warn("[supabase/search] textSearch error:", error.message);

      // FALLBACK ILIKE PATH — covers :
      //   - tsquery syntax errors when the user types unbalanced quotes
      //   - missing search_vector column on a fresh staging DB (theory)
      //   - trigger never fired on legacy rows (worker bug)
      //
      // We re-run with .ilike on the three text columns. This is a
      // soft fallback — the GIN index doesn't help, but the row count
      // is bounded by the same filters + limit so the cost is OK for
      // what's effectively a degraded mode.
      if (trimmedQ.length > 0) {
        return await searchKillsIlikeFallback(
          supabase,
          trimmedQ,
          filters,
          resolvedKillerId,
          dateRange,
          opts,
          limit,
          fetchLimit,
        );
      }
      return { rows: [], nextCursor: null };
    }

    const all = (data ?? []).map((row) => normalize(row as unknown as RawSearchRow));
    const hasMore = all.length > limit;
    const rows = hasMore ? all.slice(0, limit) : all;

    let nextCursor: string | null = null;
    if (hasMore && rows.length > 0) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor({
        s: last.highlight_score ?? -1,
        c: last.created_at,
        i: last.id,
      });
    }

    return { rows, nextCursor };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/search] searchKills threw:", err);
    return { rows: [], nextCursor: null };
  }
}

/**
 * Fallback search path when `.textSearch()` errors. ILIKE-based.
 * Same filter set, same cursor format, same row shape — just no
 * tsvector. Slower but resilient. Kept as a separate function so the
 * happy-path stays linear and easy to read.
 */
async function searchKillsIlikeFallback(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  trimmedQ: string,
  filters: SearchFilters,
  resolvedKillerId: string | null,
  dateRange: { startISO: string; endISO: string } | null,
  opts: SearchOpts,
  limit: number,
  fetchLimit: number,
): Promise<SearchResult> {
  // Escape % and _ so user input doesn't accidentally turn into wildcards.
  const escaped = trimmedQ.replace(/[%_\\]/g, (m) => `\\${m}`);
  const pattern = `%${escaped}%`;

  let q = supabase
    .from("kills")
    .select(SEARCH_KILL_SELECT)
    .or(
      "publication_status.eq.published," +
        "and(publication_status.is.null,status.eq.published)",
    )
    .eq("kill_visible", true)
    .not("clip_url_vertical", "is", null)
    .not("thumbnail_url", "is", null)
    // Multi-column ILIKE — Postgres OR. PostgREST `or()` accepts a
    // comma-separated list of expressions.
    .or(
      `killer_champion.ilike.${pattern},` +
        `victim_champion.ilike.${pattern},` +
        `ai_description.ilike.${pattern}`,
    );

  if (resolvedKillerId) q = q.eq("killer_player_id", resolvedKillerId);
  if (filters.multiKill) q = q.eq("multi_kill", filters.multiKill);
  if (filters.isFirstBlood === true) q = q.eq("is_first_blood", true);
  if (filters.tag) q = q.contains("ai_tags", [filters.tag]);
  if (filters.matchExternalId) q = q.eq("games.matches.external_id", filters.matchExternalId);
  if (typeof filters.minScore === "number" && Number.isFinite(filters.minScore)) {
    q = q.gte("highlight_score", filters.minScore);
  }
  if (typeof filters.minRating === "number" && Number.isFinite(filters.minRating)) {
    q = q.gte("avg_rating", filters.minRating);
  }
  if (filters.trackedTeam) q = q.eq("tracked_team_involvement", filters.trackedTeam);
  if (dateRange) {
    q = q
      .gte("games.matches.scheduled_at", dateRange.startISO)
      .lte("games.matches.scheduled_at", dateRange.endISO);
  }
  if (opts.cursor) {
    const decoded = decodeCursor(opts.cursor);
    if (decoded) q = q.lt("created_at", decoded.c);
  }
  q = q
    .order("highlight_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(fetchLimit);

  const { data, error } = await q;
  if (error) {
    console.warn("[supabase/search] ILIKE fallback error:", error.message);
    return { rows: [], nextCursor: null };
  }

  const all = (data ?? []).map((row: unknown) => normalize(row as RawSearchRow));
  const hasMore = all.length > limit;
  const rows = hasMore ? all.slice(0, limit) : all;
  let nextCursor: string | null = null;
  if (hasMore && rows.length > 0) {
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor({
      s: last.highlight_score ?? -1,
      c: last.created_at,
      i: last.id,
    });
  }
  return { rows, nextCursor };
}

// ─── Facets loader (used by /api/search/facets) ────────────────────────

export interface SearchFacets {
  /** Top tags by frequency in published kills. */
  tags: { tag: string; count: number }[];
  /** Top tracked players by killer kill count. */
  players: { slug: string; ign: string; role: string | null; count: number }[];
}

/**
 * Aggregate facets used by the FilterChips dropdowns. Cached aggressively
 * (1h via the route handler) — the catalog grows slowly and a stale
 * tag list is harmless.
 *
 * Implementation choice : we run two independent queries instead of
 * relying on a Postgres function. The aggregations are lightweight
 * (top-30 + top-100), and we don't ship dedicated SQL helpers in this
 * worktree — keeping the lib portable.
 */
export async function getSearchFacets(opts: { buildTime?: boolean } = {}): Promise<SearchFacets> {
  try {
    const supabase = opts.buildTime ? createAnonSupabase() : await createServerSupabase();

    // Sample 800 most-recent published kills for tag aggregation. A bigger
    // sample gives more accurate frequency; 800 keeps the egress under
    // ~50 KB and covers ~6 months of LEC at current pace.
    const tagsPromise = supabase
      .from("kills")
      .select("ai_tags")
      .or(
        "publication_status.eq.published," +
          "and(publication_status.is.null,status.eq.published)",
      )
      .eq("kill_visible", true)
      .not("clip_url_vertical", "is", null)
      .order("created_at", { ascending: false })
      .limit(800);

    // Top players by killer kill count — pull tracked roster and count
    // their kills via an aggregation-style join. We can't do GROUP BY
    // through PostgREST cleanly, so we fetch the players list + a
    // killer_player_id slice and count in JS. Cheap : tracked roster
    // is < 30 players over the project's lifetime.
    const playersPromise = supabase
      .from("players")
      .select("id, ign, role, teams!inner(is_tracked)")
      .eq("teams.is_tracked", true);

    const killerCountsPromise = supabase
      .from("kills")
      .select("killer_player_id")
      .or(
        "publication_status.eq.published," +
          "and(publication_status.is.null,status.eq.published)",
      )
      .eq("kill_visible", true)
      .not("clip_url_vertical", "is", null)
      .not("killer_player_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000);

    const [tagsRes, playersRes, killerCountsRes] = await Promise.all([
      tagsPromise,
      playersPromise,
      killerCountsPromise,
    ]);

    // ── Tags aggregation ────────────────────────────────────────────
    const tagCounts = new Map<string, number>();
    for (const row of (tagsRes.data ?? []) as { ai_tags?: string[] | null }[]) {
      const tags = Array.isArray(row.ai_tags) ? row.ai_tags : [];
      for (const t of tags) {
        if (typeof t !== "string" || t.length === 0 || t.length > 32) continue;
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    const tags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([tag, count]) => ({ tag, count }));

    // ── Players aggregation ─────────────────────────────────────────
    interface PlayerFacet {
      id: string;
      ign: string;
      role: string | null;
    }
    const players: PlayerFacet[] = ((playersRes.data ?? []) as Record<string, unknown>[]).map(
      (p) => ({
        id: String(p.id ?? ""),
        ign: String(p.ign ?? "?"),
        role: (p.role as string | null) ?? null,
      }),
    );
    const killerCounts = new Map<string, number>();
    for (const row of (killerCountsRes.data ?? []) as { killer_player_id?: string | null }[]) {
      const id = row.killer_player_id;
      if (!id) continue;
      killerCounts.set(id, (killerCounts.get(id) ?? 0) + 1);
    }
    const playersOut = players
      .map((p) => ({
        slug: p.ign.toLowerCase(),
        ign: p.ign,
        role: p.role,
        count: killerCounts.get(p.id) ?? 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100);

    return { tags, players: playersOut };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/search] getSearchFacets threw:", err);
    return { tags: [], players: [] };
  }
}
