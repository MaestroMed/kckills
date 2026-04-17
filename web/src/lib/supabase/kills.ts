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
import { createServerSupabase, rethrowIfDynamic } from "./server";

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

function normalize(row: Record<string, unknown>): PublishedKillRow {
  // Supabase returns the joined games either as an object or an array depending
  // on the version — collapse both cases so downstream code doesn't branch.
  const rawGames = row.games;
  const games = Array.isArray(rawGames) ? rawGames[0] ?? null : (rawGames as Record<string, unknown> | null);
  let gamesNormalized: PublishedKillRow["games"] = null;
  if (games) {
    const rawMatches = games.matches;
    const matches = Array.isArray(rawMatches) ? rawMatches[0] ?? null : (rawMatches as Record<string, unknown> | null);
    gamesNormalized = {
      external_id: String(games.external_id ?? ""),
      game_number: Number(games.game_number ?? 1),
      matches: matches
        ? {
            id: String(matches.id ?? ""),
            external_id: String(matches.external_id ?? ""),
            scheduled_at: (matches.scheduled_at as string | null) ?? null,
            stage: (matches.stage as string | null) ?? null,
            format: (matches.format as string | null) ?? null,
          }
        : null,
    };
  }
  return {
    id: String(row.id ?? ""),
    killer_player_id: (row.killer_player_id as string | null) ?? null,
    killer_champion: (row.killer_champion as string | null) ?? null,
    victim_champion: (row.victim_champion as string | null) ?? null,
    game_time_seconds: (row.game_time_seconds as number | null) ?? null,
    highlight_score: (row.highlight_score as number | null) ?? null,
    avg_rating: (row.avg_rating as number | null) ?? null,
    rating_count: Number(row.rating_count ?? 0),
    clip_url_horizontal: (row.clip_url_horizontal as string | null) ?? null,
    clip_url_vertical: (row.clip_url_vertical as string | null) ?? null,
    clip_url_vertical_low: (row.clip_url_vertical_low as string | null) ?? null,
    thumbnail_url: (row.thumbnail_url as string | null) ?? null,
    og_image_url: (row.og_image_url as string | null) ?? null,
    ai_description: (row.ai_description as string | null) ?? null,
    ai_tags: Array.isArray(row.ai_tags) ? (row.ai_tags as string[]) : [],
    multi_kill: (row.multi_kill as string | null) ?? null,
    is_first_blood: Boolean(row.is_first_blood),
    tracked_team_involvement: (row.tracked_team_involvement as string | null) ?? null,
    kill_visible: (row.kill_visible as boolean | null) ?? null,
    lane_phase: (row.lane_phase as LanePhase | null) ?? null,
    fight_type: (row.fight_type as FightType | null) ?? null,
    objective_context: (row.objective_context as ObjectiveContext | null) ?? null,
    matchup_lane: (row.matchup_lane as MatchupLane | null) ?? null,
    champion_class: (row.champion_class as ChampionClass | null) ?? null,
    game_minute_bucket: (row.game_minute_bucket as MinuteBucket | null) ?? null,
    impression_count: Number(row.impression_count ?? 0),
    comment_count: Number(row.comment_count ?? 0),
    created_at: String(row.created_at ?? ""),
    games: gamesNormalized,
  };
}

/** Get the published kill feed sorted by highlight score. */
export async function getPublishedKills(limit = 50): Promise<PublishedKillRow[]> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("kills")
      .select(KILL_SELECT)
      .eq("status", "published")
      .not("clip_url_vertical", "is", null)
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[supabase/kills] getPublishedKills error:", error.message);
      return [];
    }
    return (data ?? []).map((row) => normalize(row as unknown as Record<string, unknown>));
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
    return data ? normalize(data as unknown as Record<string, unknown>) : null;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getKillById threw:", err);
    return null;
  }
}

/** Get all published kills for a given match_external_id. */
export async function getKillsByMatchExternalId(
  matchExternalId: string
): Promise<PublishedKillRow[]> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("kills")
      .select(KILL_SELECT)
      .eq("status", "published")
      .eq("games.matches.external_id", matchExternalId)
      .order("game_time_seconds", { ascending: true });
    if (error) {
      console.warn("[supabase/kills] getKillsByMatchExternalId error:", error.message);
      return [];
    }
    return (data ?? []).map((row) => normalize(row as unknown as Record<string, unknown>));
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getKillsByMatchExternalId threw:", err);
    return [];
  }
}

/** Get published kills where a given champion is the killer. */
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
      .eq("killer_champion", championName)
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) {
      console.warn("[supabase/kills] getKillsByKillerChampion error:", error.message);
      return [];
    }
    return (data ?? []).map((row) => normalize(row as unknown as Record<string, unknown>));
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getKillsByKillerChampion threw:", err);
    return [];
  }
}
