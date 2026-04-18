/**
 * Server-side loader for published kill clips from Supabase.
 *
 * Runs only in RSC / route handlers (never imported from client components).
 * Reads anonymously — the RLS policy `"Public kills"` allows SELECT whenever
 * `status = 'published'`, so no service role key is needed.
 *
 * Every kill returned here has a real MP4 on R2 (clip_url_*), a Gemini
 * highlight score, and a French hyped AI description. It is the data layer
 * that makes /scroll go from "splash-art placeholder" to "real TikTok feed".
 */

import "server-only";
import { createAnonSupabase, createServerSupabase, rethrowIfDynamic } from "./server";

export type LanePhase = "early" | "mid" | "late";
export type FightType =
  | "solo_kill"
  | "gank"
  | "skirmish_2v2"
  | "skirmish_3v3"
  | "teamfight_4v4"
  | "teamfight_5v5"
  | "pick";
export type ObjectiveContext =
  | "none"
  | "dragon"
  | "baron"
  | "herald"
  | "atakhan"
  | "tower"
  | "inhibitor"
  | "nexus";
export type MatchupLane = "top" | "jungle" | "mid" | "bot" | "support" | "cross_map";
export type ChampionClass =
  | "assassin"
  | "bruiser"
  | "mage"
  | "marksman"
  | "tank"
  | "enchanter"
  | "skirmisher";
export type MinuteBucket =
  | "0-5"
  | "5-10"
  | "10-15"
  | "15-20"
  | "20-25"
  | "25-30"
  | "30-35"
  | "35+";

export interface PublishedKillRow {
  id: string;
  killer_player_id: string | null;
  killer_champion: string | null;
  victim_champion: string | null;
  game_time_seconds: number | null;
  highlight_score: number | null;
  avg_rating: number | null;
  rating_count: number;
  clip_url_horizontal: string | null;
  clip_url_vertical: string | null;
  clip_url_vertical_low: string | null;
  /** HLS master playlist URL (migration 007). NULL until the worker's
   *  hls_packager has processed this clip. The Phase 4 player consumes
   *  this first; if NULL it falls back to clip_url_vertical MP4. */
  hls_master_url: string | null;
  thumbnail_url: string | null;
  og_image_url: string | null;
  ai_description: string | null;
  ai_tags: string[];
  multi_kill: string | null;
  is_first_blood: boolean;
  tracked_team_involvement: string | null;
  kill_visible: boolean | null;
  lane_phase: LanePhase | null;
  fight_type: FightType | null;
  objective_context: ObjectiveContext | null;
  matchup_lane: MatchupLane | null;
  champion_class: ChampionClass | null;
  game_minute_bucket: MinuteBucket | null;
  impression_count: number;
  comment_count: number;
  created_at: string;
  games: {
    external_id: string;
    game_number: number;
    matches: {
      id: string;
      external_id: string;
      scheduled_at: string | null;
      stage: string | null;
      format: string | null;
    } | null;
  } | null;
}

// hls_master_url is populated by the worker's hls_packager (TBD ship).
// Until that runs, the column stays NULL on all rows and the FeedPlayerPool
// transparently falls back to clip_url_vertical (MP4) — zero regression.
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
  ai_description,
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

/**
 * Raw row shape returned by the SELECT clause above. Mirrors the
 * Supabase response one-to-one BEFORE normalisation. Defining this in
 * code (instead of `Record<string, unknown>`) means a Supabase schema
 * change makes us a TS error here, not a silent runtime null cascade
 * downstream.
 *
 * Joined relations come back as object | array depending on the
 * supabase-js version, hence the union types on `games` and
 * `matches`. Normalize collapses both.
 */
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
  ai_description?: string | null;
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
  games?: RawGameSelect | RawGameSelect[] | null;
}

interface RawGameSelect {
  external_id?: string | null;
  game_number?: number | null;
  matches?: RawMatchSelect | RawMatchSelect[] | null;
}

interface RawMatchSelect {
  id?: string | null;
  external_id?: string | null;
  scheduled_at?: string | null;
  stage?: string | null;
  format?: string | null;
}

function normalize(row: RawKillSelect): PublishedKillRow {
  // Joined relations come back as object | array depending on the
  // supabase-js version — collapse both cases so downstream code
  // doesn't branch.
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
    ai_description: row.ai_description ?? null,
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
    games: gamesNormalized,
  };
}

/**
 * Get the published kill feed sorted by highlight score.
 *
 * `buildTime: true` swaps the cookie-bound server client for an
 * anon-only client, so this can be safely called from
 * generateStaticParams + sitemap.ts (which run outside any request
 * scope and would otherwise crash on `cookies()`). The data returned
 * is identical — the kills RLS policy is `Public kills` (status =
 * published), so no auth is needed.
 */
export async function getPublishedKills(
  limit = 50,
  opts: { buildTime?: boolean } = {},
): Promise<PublishedKillRow[]> {
  try {
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();
    const { data, error } = await supabase
      .from("kills")
      .select(KILL_SELECT)
      .eq("status", "published")
      .eq("kill_visible", true)            // Gemini QC must have confirmed the kill is in-frame
      .not("clip_url_vertical", "is", null) // real MP4 on R2
      .not("thumbnail_url", "is", null)     // poster frame so the player isn't black on load
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[supabase/kills] getPublishedKills error:", error.message);
      return [];
    }
    return (data ?? []).map((row) => normalize(row as unknown as RawKillSelect));
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getPublishedKills threw:", err);
    return [];
  }
}

/** Get a single published kill by id. */
export async function getKillById(id: string): Promise<PublishedKillRow | null> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("kills")
      .select(KILL_SELECT)
      .eq("id", id)
      .eq("status", "published")
      .maybeSingle();
    if (error) {
      console.warn("[supabase/kills] getKillById error:", error.message);
      return null;
    }
    return data ? normalize(data as unknown as RawKillSelect) : null;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getKillById threw:", err);
    return null;
  }
}

/** Get all published kills for a given match_external_id.
 *
 *  Filters kill_visible=true so the match-page reels never show clips
 *  where Gemini's QC pass said the kill isn't actually visible on screen.
 *  Direct deep-links via /kill/[id] still work via getKillById which
 *  intentionally has no kill_visible filter (the user typed the URL).
 */
export async function getKillsByMatchExternalId(
  matchExternalId: string
): Promise<PublishedKillRow[]> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("kills")
      .select(KILL_SELECT)
      .eq("status", "published")
      .eq("kill_visible", true)
      .eq("games.matches.external_id", matchExternalId)
      .order("game_time_seconds", { ascending: true });
    if (error) {
      console.warn("[supabase/kills] getKillsByMatchExternalId error:", error.message);
      return [];
    }
    return (data ?? []).map((row) => normalize(row as unknown as RawKillSelect));
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getKillsByMatchExternalId threw:", err);
    return [];
  }
}

/** Get published kills where a given champion is the killer.
 *
 *  Filters kill_visible=true (see getKillsByMatchExternalId for rationale).
 */
export async function getKillsByKillerChampion(
  championName: string,
  limit = 50
): Promise<PublishedKillRow[]> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("kills")
      .select(KILL_SELECT)
      .eq("status", "published")
      .eq("kill_visible", true)
      .eq("killer_champion", championName)
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) {
      console.warn("[supabase/kills] getKillsByKillerChampion error:", error.message);
      return [];
    }
    return (data ?? []).map((row) => normalize(row as unknown as RawKillSelect));
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getKillsByKillerChampion threw:", err);
    return [];
  }
}
