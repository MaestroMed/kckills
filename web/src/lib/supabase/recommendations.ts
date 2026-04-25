/**
 * Server-side loader for the per-session recommendation feed.
 *
 * Wraps the `fn_recommend_kills` RPC (migration 046) and maps the
 * returned (kill_id, similarity) tuples back to the full
 * `PublishedKillRow` shape via a second SELECT — that way every consumer
 * (FeedItem, FeedPlayerPool, JsonLd…) sees the exact same row shape as
 * the existing `getPublishedKills()` and we don't have to touch the
 * downstream view-models.
 *
 * Behaviour contracts :
 *
 *   * Cold start (no anchors) → empty array. The caller is expected to
 *     fall back to `getPublishedKills()` so the user always sees a feed.
 *
 *   * RPC missing (migration 046 not yet applied) → empty array, NO
 *     throw. Detected via the well-known PostgREST error code PGRST202
 *     ("No matches found") OR the message substring
 *     "function fn_recommend_kills does not exist". The loader logs once
 *     to console.warn and returns []. Caller falls back gracefully.
 *
 *   * Per-session cache (5 min TTL) — keyed by sessionId + sorted-anchor
 *     hash. Lives in module scope (memoised across requests within the
 *     same Vercel instance). Egress saver — same user scrolling a few
 *     seconds apart hits the same set instead of re-running the AVG +
 *     KNN every poll.
 *
 * RLS contract :
 *   * The RPC is SECURITY DEFINER and reads `kills` (Public kills RLS) +
 *     `user_events` (admin-only). The caller never directly touches
 *     user_events — only the centroid computation does, and only what
 *     it needs to exclude already-watched kills.
 */

import "server-only";
import {
  type PublishedKillRow,
  type KillAssetsManifest,
  type LanePhase,
  type FightType,
  type ObjectiveContext,
  type MatchupLane,
  type ChampionClass,
  type MinuteBucket,
} from "./kills";
import { createAnonSupabase, createServerSupabase, rethrowIfDynamic } from "./server";

/**
 * Same column set as `KILL_SELECT` in kills.ts. Repeated here because
 * exporting it from kills.ts would create a circular module dependency
 * for the loader hot path (recommendations.ts is intended to be tree-
 * shaken into the edge runtime ; importing the bigger kills.ts module
 * pulls in the whole grid/era/match queryset).
 */
const KILL_SELECT = `
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

interface RawMatchSelect {
  id?: string | null;
  external_id?: string | null;
  scheduled_at?: string | null;
  stage?: string | null;
  format?: string | null;
}
interface RawGameSelect {
  external_id?: string | null;
  game_number?: number | null;
  matches?: RawMatchSelect | RawMatchSelect[] | null;
}
interface RawKillSelect {
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
  assets_manifest?: KillAssetsManifest | null;
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
  lane_phase?: LanePhase | null;
  fight_type?: FightType | null;
  objective_context?: ObjectiveContext | null;
  matchup_lane?: MatchupLane | null;
  champion_class?: ChampionClass | null;
  game_minute_bucket?: MinuteBucket | null;
  impression_count?: number | null;
  comment_count?: number | null;
  created_at?: string | null;
  data_source?: string | null;
  status?: string | null;
  pipeline_status?: string | null;
  publication_status?: string | null;
  qc_status?: string | null;
  asset_status?: string | null;
  games?: RawGameSelect | RawGameSelect[] | null;
}

function normalize(row: RawKillSelect): PublishedKillRow {
  const games = Array.isArray(row.games) ? row.games[0] ?? null : row.games ?? null;
  let gamesNormalized: PublishedKillRow["games"] = null;
  if (games) {
    const matches = Array.isArray(games.matches) ? games.matches[0] ?? null : games.matches ?? null;
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

/** A scored row : kill payload + the raw cosine similarity (0..1) that
 *  feed-algorithm consumes to mix with Wilson. */
export interface RecommendedKillRow {
  kill: PublishedKillRow;
  similarity: number;
}

export interface GetRecommendedKillsOpts {
  /** Per-tab session id from the client (track.ts kc_session_id). May
   *  be empty/null — RPC falls back to anchor-only exclusion. */
  sessionId: string | null;
  /** Last N kill_ids the user actively watched. Empty array = cold
   *  start ; loader returns []. */
  anchorKillIds: string[];
  /** How many recommendations to return. Capped server-side at 50. */
  limit?: number;
  /** Build-time mode — cookie-less anon client (sitemap, ISR pre-render). */
  buildTime?: boolean;
}

// ─── Per-session memo cache ──────────────────────────────────────────
//
// 5-min TTL. Keyed by (sessionId | sorted-anchor-hash | limit). Lives in
// module scope so the same Vercel lambda instance reuses results across
// requests. Hard-capped at MAX_CACHE_ENTRIES so a malicious client can't
// blow our memory by churning anchor sets.

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  expiresAt: number;
  rows: RecommendedKillRow[];
}

const cache = new Map<string, CacheEntry>();

function makeCacheKey(opts: GetRecommendedKillsOpts): string {
  const sortedAnchors = [...opts.anchorKillIds].sort().join(",");
  return `${opts.sessionId ?? ""}|${sortedAnchors}|${opts.limit ?? 10}`;
}

function readCache(key: string): RecommendedKillRow[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.rows;
}

function writeCache(key: string, rows: RecommendedKillRow[]): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Evict the oldest entry (insertion order). Map iterators yield keys
    // in insertion order — first key is the oldest.
    const firstKey = cache.keys().next().value;
    if (typeof firstKey === "string") cache.delete(firstKey);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, rows });
}

// Exposed for tests / explicit invalidation.
export function _clearRecommendationCache(): void {
  cache.clear();
}

/**
 * Fetch the top-N similarity-ranked kills for the given session +
 * anchor list.
 *
 * Returns `[]` on cold start, on RPC missing, or on any unexpected
 * error. The caller MUST fall back to a recency feed in those cases —
 * the recommender intentionally NEVER throws so the scroll page stays
 * up even when migration 046 hasn't been applied.
 */
export async function getRecommendedKills(
  opts: GetRecommendedKillsOpts,
): Promise<RecommendedKillRow[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 50));
  if (!Array.isArray(opts.anchorKillIds) || opts.anchorKillIds.length === 0) {
    return [];
  }

  const cacheKey = makeCacheKey({ ...opts, limit });
  const hit = readCache(cacheKey);
  if (hit) return hit;

  try {
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();

    const { data: rpcRows, error: rpcError } = await supabase.rpc(
      "fn_recommend_kills",
      {
        p_anchor_kill_ids: opts.anchorKillIds,
        p_session_id: opts.sessionId ?? "",
        p_limit: limit,
        p_exclude_recent_hours: 24,
      },
    );

    if (rpcError) {
      // PostgREST returns 404 + PGRST202 / message "function ... does not
      // exist" when the RPC is missing. We treat that as "migration not
      // applied yet" and bubble back an empty list — caller falls back.
      const msg = (rpcError.message ?? "").toLowerCase();
      const code = (rpcError as { code?: string }).code ?? "";
      const missing =
        code === "PGRST202" ||
        msg.includes("does not exist") ||
        msg.includes("not found");
      if (missing) {
        console.warn(
          "[supabase/recommendations] fn_recommend_kills missing — " +
            "falling back to recency feed (apply migration 046)",
        );
        writeCache(cacheKey, []);
        return [];
      }
      console.warn(
        "[supabase/recommendations] rpc error:",
        rpcError.message,
      );
      return [];
    }

    const tuples: Array<{ id?: string | null; similarity?: number | null }> =
      Array.isArray(rpcRows) ? rpcRows : [];
    if (tuples.length === 0) {
      writeCache(cacheKey, []);
      return [];
    }

    // Resolve full rows for the recommended ids in a single SELECT.
    const ids = tuples
      .map((t) => (typeof t.id === "string" ? t.id : null))
      .filter((s): s is string => !!s);
    if (ids.length === 0) {
      writeCache(cacheKey, []);
      return [];
    }

    const { data: killRows, error: selectError } = await supabase
      .from("kills")
      .select(KILL_SELECT)
      .in("id", ids);

    if (selectError) {
      console.warn(
        "[supabase/recommendations] follow-up SELECT error:",
        selectError.message,
      );
      return [];
    }

    const byId = new Map<string, PublishedKillRow>();
    for (const raw of killRows ?? []) {
      const row = normalize(raw as unknown as RawKillSelect);
      if (row.id) byId.set(row.id, row);
    }

    // Re-stitch in RPC similarity order so the highest-similarity row
    // comes first regardless of the SELECT's natural ordering.
    const result: RecommendedKillRow[] = [];
    for (const t of tuples) {
      if (!t.id) continue;
      const row = byId.get(t.id);
      if (!row) continue;
      result.push({
        kill: row,
        similarity: typeof t.similarity === "number" ? t.similarity : 0,
      });
    }

    writeCache(cacheKey, result);
    return result;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/recommendations] threw:", err);
    return [];
  }
}
