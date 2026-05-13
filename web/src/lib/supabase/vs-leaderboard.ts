/**
 * /vs/leaderboard — data layer.
 *
 * Wraps the RPCs shipped in migrations 059 + 064 :
 *   - `fn_top_elo_kills_v2(p_limit, p_offset, p_filter_role, p_filter_champion,
 *      p_era_date_start, p_era_date_end, p_min_battles)` → main board.
 *   - `fn_elo_leaderboard_stats()` → sidebar counters in one round-trip.
 *
 * Plus client-callable helpers :
 *   - `getSessionVoteCount(sessionHash)` — counts rows in `vs_battles`
 *     whose `voter_session_hash` matches the caller's localStorage id.
 *     Server-side OR client-side ; both paths use the anon SDK.
 *
 * Every helper degrades to a neutral value (empty arrays, zero counters,
 * null featured rows) so /vs/leaderboard never 500s.
 */

import "server-only";
import { cache } from "react";

import { createAnonSupabase, rethrowIfDynamic } from "./server";

// ════════════════════════════════════════════════════════════════════
// Types — mirror the SQL projections
// ════════════════════════════════════════════════════════════════════

/** One row in the main leaderboard, post-pagination. */
export interface EloLeaderboardRow {
  kill_id: string;
  elo_rating: number;
  battles_count: number;
  wins: number;
  killer_champion: string | null;
  victim_champion: string | null;
  killer_name: string | null;
  killer_role: string | null;
  victim_name: string | null;
  clip_url_vertical: string | null;
  clip_url_vertical_low: string | null;
  thumbnail_url: string | null;
  highlight_score: number | null;
  avg_rating: number | null;
  ai_description: string | null;
  multi_kill: string | null;
  is_first_blood: boolean;
  created_at: string | null;
  match_date: string | null;
}

/** Shape of the JSONB featured kill blobs emitted by
 *  `fn_elo_leaderboard_stats`. Identical to `EloLeaderboardRow` minus
 *  the columns the sidebar doesn't need (created_at, match_date, victim
 *  champion etc.) and PLUS a derived win_rate (0..1). */
export interface FeaturedEloKill {
  kill_id: string;
  elo_rating: number;
  battles_count: number;
  wins: number;
  win_rate: number;
  killer_champion: string | null;
  victim_champion: string | null;
  killer_name: string | null;
  killer_role: string | null;
  victim_name: string | null;
  thumbnail_url: string | null;
  clip_url_vertical: string | null;
  clip_url_vertical_low: string | null;
  multi_kill: string | null;
  is_first_blood: boolean;
  ai_description: string | null;
  highlight_score: number | null;
}

export interface EloLeaderboardStats {
  total_battles: number;
  total_kills_with_battles: number;
  most_active: FeaturedEloKill | null;
  most_contested: FeaturedEloKill | null;
  most_dominant: FeaturedEloKill | null;
}

export interface EloLeaderboardFilters {
  role?: string | null;
  champion?: string | null;
  eraDateStart?: string | null;
  eraDateEnd?: string | null;
  minBattles?: number;
  limit?: number;
  offset?: number;
}

// ════════════════════════════════════════════════════════════════════
// Helpers — raw row → typed row
// ════════════════════════════════════════════════════════════════════

interface RawLeaderboardRow {
  kill_id?: string | null;
  elo_rating?: number | null;
  battles_count?: number | null;
  wins?: number | null;
  killer_champion?: string | null;
  victim_champion?: string | null;
  killer_name?: string | null;
  killer_role?: string | null;
  victim_name?: string | null;
  clip_url_vertical?: string | null;
  clip_url_vertical_low?: string | null;
  thumbnail_url?: string | null;
  highlight_score?: number | null;
  avg_rating?: number | null;
  ai_description?: string | null;
  multi_kill?: string | null;
  is_first_blood?: boolean | null;
  created_at?: string | null;
  match_date?: string | null;
}

function normaliseRow(row: RawLeaderboardRow): EloLeaderboardRow | null {
  if (!row.kill_id) return null;
  return {
    kill_id: String(row.kill_id),
    elo_rating: typeof row.elo_rating === "number" ? row.elo_rating : 1500,
    battles_count: Number(row.battles_count ?? 0),
    wins: Number(row.wins ?? 0),
    killer_champion: row.killer_champion ?? null,
    victim_champion: row.victim_champion ?? null,
    killer_name: row.killer_name ?? null,
    killer_role: row.killer_role ?? null,
    victim_name: row.victim_name ?? null,
    clip_url_vertical: row.clip_url_vertical ?? null,
    clip_url_vertical_low: row.clip_url_vertical_low ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    highlight_score:
      typeof row.highlight_score === "number" ? row.highlight_score : null,
    avg_rating: typeof row.avg_rating === "number" ? row.avg_rating : null,
    ai_description: row.ai_description ?? null,
    multi_kill: row.multi_kill ?? null,
    is_first_blood: Boolean(row.is_first_blood),
    created_at: row.created_at ?? null,
    match_date: row.match_date ?? null,
  };
}

interface RawFeaturedKill {
  kill_id?: string | null;
  elo_rating?: number | null;
  battles_count?: number | null;
  wins?: number | null;
  win_rate?: number | null;
  killer_champion?: string | null;
  victim_champion?: string | null;
  killer_name?: string | null;
  killer_role?: string | null;
  victim_name?: string | null;
  thumbnail_url?: string | null;
  clip_url_vertical?: string | null;
  clip_url_vertical_low?: string | null;
  multi_kill?: string | null;
  is_first_blood?: boolean | null;
  ai_description?: string | null;
  highlight_score?: number | null;
}

function parseFeaturedKill(raw: unknown): FeaturedEloKill | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawFeaturedKill;
  if (!r.kill_id) return null;
  const battles = Number(r.battles_count ?? 0);
  const wins = Number(r.wins ?? 0);
  // Recompute win_rate defensively : the RPC emits NULL when battles=0.
  const winRate =
    typeof r.win_rate === "number"
      ? r.win_rate
      : battles > 0
        ? wins / battles
        : 0;
  return {
    kill_id: String(r.kill_id),
    elo_rating: typeof r.elo_rating === "number" ? r.elo_rating : 1500,
    battles_count: battles,
    wins,
    win_rate: winRate,
    killer_champion: r.killer_champion ?? null,
    victim_champion: r.victim_champion ?? null,
    killer_name: r.killer_name ?? null,
    killer_role: r.killer_role ?? null,
    victim_name: r.victim_name ?? null,
    thumbnail_url: r.thumbnail_url ?? null,
    clip_url_vertical: r.clip_url_vertical ?? null,
    clip_url_vertical_low: r.clip_url_vertical_low ?? null,
    multi_kill: r.multi_kill ?? null,
    is_first_blood: Boolean(r.is_first_blood),
    ai_description: r.ai_description ?? null,
    highlight_score:
      typeof r.highlight_score === "number" ? r.highlight_score : null,
  };
}

// ════════════════════════════════════════════════════════════════════
// getEloLeaderboard — main fetcher
// ════════════════════════════════════════════════════════════════════

export async function getEloLeaderboard(
  filters: EloLeaderboardFilters = {},
): Promise<EloLeaderboardRow[]> {
  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb.rpc("fn_top_elo_kills_v2", {
      p_limit: Math.max(1, Math.min(filters.limit ?? 50, 200)),
      p_offset: Math.max(0, filters.offset ?? 0),
      p_filter_role: filters.role ?? null,
      p_filter_champion: filters.champion ?? null,
      p_era_date_start: filters.eraDateStart ?? null,
      p_era_date_end: filters.eraDateEnd ?? null,
      p_min_battles: Math.max(0, filters.minBattles ?? 5),
    });
    if (error) {
      console.warn("[vs-leaderboard] getEloLeaderboard rpc error:", error.message);
      return [];
    }
    const rows = (data ?? []) as RawLeaderboardRow[];
    const out: EloLeaderboardRow[] = [];
    for (const r of rows) {
      const n = normaliseRow(r);
      if (n) out.push(n);
    }
    return out;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[vs-leaderboard] getEloLeaderboard threw:", err);
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════
// getEloStats — sidebar counters (one round-trip)
// ════════════════════════════════════════════════════════════════════

interface RawStatsRow {
  total_battles?: number | string | null;
  total_kills_with_battles?: number | string | null;
  most_active_kill?: unknown;
  most_contested_kill?: unknown;
  most_dominant_kill?: unknown;
}

export const getEloStats = cache(async function getEloStats(): Promise<EloLeaderboardStats> {
  const empty: EloLeaderboardStats = {
    total_battles: 0,
    total_kills_with_battles: 0,
    most_active: null,
    most_contested: null,
    most_dominant: null,
  };
  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb.rpc("fn_elo_leaderboard_stats");
    if (error) {
      console.warn("[vs-leaderboard] getEloStats rpc error:", error.message);
      return empty;
    }
    const rows = Array.isArray(data) ? data : [];
    const row = (rows[0] ?? null) as RawStatsRow | null;
    if (!row) return empty;
    return {
      total_battles: Number(row.total_battles ?? 0),
      total_kills_with_battles: Number(row.total_kills_with_battles ?? 0),
      most_active: parseFeaturedKill(row.most_active_kill),
      most_contested: parseFeaturedKill(row.most_contested_kill),
      most_dominant: parseFeaturedKill(row.most_dominant_kill),
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[vs-leaderboard] getEloStats threw:", err);
    return empty;
  }
});

// ════════════════════════════════════════════════════════════════════
// getSessionVoteCount — count battles voted on by a given session
// ════════════════════════════════════════════════════════════════════

/** Counts rows in `vs_battles` where `voter_session_hash` equals the
 *  caller's session id. We use a HEAD-only count so egress stays at
 *  ~150 bytes regardless of how many votes the user cast.
 *
 *  Returns 0 on any failure (invalid hash, network, etc.) — the sidebar
 *  treats 0 as the "no votes yet" state, which is the right fallback. */
export async function getSessionVoteCount(sessionHash: string): Promise<number> {
  if (!sessionHash || sessionHash.length < 16) return 0;
  try {
    const sb = createAnonSupabase();
    const { count, error } = await sb
      .from("vs_battles")
      .select("id", { count: "exact", head: true })
      .eq("voter_session_hash", sessionHash);
    if (error) {
      console.warn("[vs-leaderboard] getSessionVoteCount error:", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[vs-leaderboard] getSessionVoteCount threw:", err);
    return 0;
  }
}

// ════════════════════════════════════════════════════════════════════
// Champion list — distinct killer_champion values from kill_elo
// ════════════════════════════════════════════════════════════════════
//
// The filter bar's "Champion" autocomplete shows the champions that
// actually appear on the leaderboard (kills with battles_count >= 5).
// Otherwise the dropdown would list every champion the worker ever
// clipped — useless when most have zero votes.

export const getLeaderboardChampions = cache(async function getLeaderboardChampions(): Promise<string[]> {
  try {
    const sb = createAnonSupabase();
    // Pull up to the top 200 kills (the page caps at 200 rows anyway).
    const { data, error } = await sb.rpc("fn_top_elo_kills_v2", {
      p_limit: 200,
      p_offset: 0,
      p_filter_role: null,
      p_filter_champion: null,
      p_era_date_start: null,
      p_era_date_end: null,
      p_min_battles: 1,
    });
    if (error) {
      console.warn("[vs-leaderboard] getLeaderboardChampions error:", error.message);
      return [];
    }
    const rows = (data ?? []) as RawLeaderboardRow[];
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.killer_champion && !seen.has(r.killer_champion)) {
        seen.add(r.killer_champion);
      }
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[vs-leaderboard] getLeaderboardChampions threw:", err);
    return [];
  }
});
