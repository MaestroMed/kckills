/**
 * Server-side client for the clip-centric RPC.
 *
 * Wraps `fn_get_clips_filtered` (migration 005) so any RSC can request a
 * tailored slice of published clips with one typed call. Built for the
 * reusable `<ClipReel filter={...} />` primitive.
 */

import "server-only";
import { createServerSupabase, rethrowIfDynamic } from "./server";

// ─── Filter type — every key is optional. Mirrors the JSONB the RPC parses.
export interface ClipFilter {
  killerPlayerId?: string;
  victimPlayerId?: string;
  matchExternalId?: string;
  killerChampion?: string;
  victimChampion?: string;
  fightType?:
    | "solo_kill"
    | "gank"
    | "skirmish_2v2"
    | "skirmish_3v3"
    | "teamfight_4v4"
    | "teamfight_5v5"
    | "pick";
  matchupLane?: "top" | "jungle" | "mid" | "bot" | "support" | "cross_map";
  championClass?:
    | "assassin"
    | "bruiser"
    | "mage"
    | "marksman"
    | "tank"
    | "enchanter"
    | "skirmisher";
  minuteBucket?:
    | "0-5" | "5-10" | "10-15" | "15-20"
    | "20-25" | "25-30" | "30-35" | "35+";
  lanePhase?: "early" | "mid" | "late";
  objectiveContext?:
    | "none" | "dragon" | "baron" | "herald" | "atakhan"
    | "tower" | "inhibitor" | "nexus";
  opponentTeamCode?: string;
  trackedTeamInvolvement?: "team_killer" | "team_victim" | "team_assist";
  multiKillMin?: "double" | "triple" | "quadra" | "penta";
  isFirstBlood?: boolean;
  minHighlight?: number;
  minAvgRating?: number;
}

export interface FilteredClip {
  id: string;
  killerPlayerId: string | null;
  victimPlayerId: string | null;
  killerChampion: string | null;
  victimChampion: string | null;
  killerName: string | null;
  victimName: string | null;
  clipUrlHorizontal: string | null;
  clipUrlVertical: string | null;
  clipUrlVerticalLow: string | null;
  thumbnailUrl: string | null;
  highlightScore: number | null;
  avgRating: number | null;
  ratingCount: number;
  aiDescription: string | null;
  aiTags: string[];
  multiKill: string | null;
  isFirstBlood: boolean;
  trackedTeamInvolvement: string | null;
  fightType: string | null;
  matchupLane: string | null;
  lanePhase: string | null;
  minuteBucket: string | null;
  gameTimeSeconds: number;
  gameId: string | null;
  gameNumber: number | null;
  matchExternalId: string | null;
  matchStage: string | null;
  matchDate: string | null;
  opponentCode: string | null;
  createdAt: string | null;
}

/** Camel→snake conversion used to assemble the JSONB filter the RPC reads. */
function buildJsonbFilter(f: ClipFilter): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (f.killerPlayerId)         out.killer_player_id = f.killerPlayerId;
  if (f.victimPlayerId)         out.victim_player_id = f.victimPlayerId;
  if (f.matchExternalId)        out.match_external_id = f.matchExternalId;
  if (f.killerChampion)         out.killer_champion = f.killerChampion;
  if (f.victimChampion)         out.victim_champion = f.victimChampion;
  if (f.fightType)              out.fight_type = f.fightType;
  if (f.matchupLane)            out.matchup_lane = f.matchupLane;
  if (f.championClass)          out.champion_class = f.championClass;
  if (f.minuteBucket)           out.minute_bucket = f.minuteBucket;
  if (f.lanePhase)              out.lane_phase = f.lanePhase;
  if (f.objectiveContext)       out.objective_context = f.objectiveContext;
  if (f.opponentTeamCode)       out.opponent_team_code = f.opponentTeamCode;
  if (f.trackedTeamInvolvement) out.tracked_team_involvement = f.trackedTeamInvolvement;
  if (f.multiKillMin)           out.multi_kill_min = f.multiKillMin;
  if (typeof f.isFirstBlood === "boolean") out.is_first_blood = f.isFirstBlood;
  if (typeof f.minHighlight === "number")  out.min_highlight = String(f.minHighlight);
  if (typeof f.minAvgRating === "number")  out.min_avg_rating = String(f.minAvgRating);
  return out;
}

function normalize(row: Record<string, unknown>): FilteredClip {
  const tags = row.ai_tags;
  return {
    id: String(row.id),
    killerPlayerId: (row.killer_player_id as string | null) ?? null,
    victimPlayerId: (row.victim_player_id as string | null) ?? null,
    killerChampion: (row.killer_champion as string | null) ?? null,
    victimChampion: (row.victim_champion as string | null) ?? null,
    killerName: (row.killer_name as string | null) ?? null,
    victimName: (row.victim_name as string | null) ?? null,
    clipUrlHorizontal: (row.clip_url_horizontal as string | null) ?? null,
    clipUrlVertical: (row.clip_url_vertical as string | null) ?? null,
    clipUrlVerticalLow: (row.clip_url_vertical_low as string | null) ?? null,
    thumbnailUrl: (row.thumbnail_url as string | null) ?? null,
    highlightScore: (row.highlight_score as number | null) ?? null,
    avgRating: (row.avg_rating as number | null) ?? null,
    ratingCount: (row.rating_count as number | null) ?? 0,
    aiDescription: (row.ai_description as string | null) ?? null,
    aiTags: Array.isArray(tags) ? (tags as string[]) : [],
    multiKill: (row.multi_kill as string | null) ?? null,
    isFirstBlood: (row.is_first_blood as boolean | null) ?? false,
    trackedTeamInvolvement: (row.tracked_team_involvement as string | null) ?? null,
    fightType: (row.fight_type as string | null) ?? null,
    matchupLane: (row.matchup_lane as string | null) ?? null,
    lanePhase: (row.lane_phase as string | null) ?? null,
    minuteBucket: (row.minute_bucket as string | null) ?? null,
    gameTimeSeconds: (row.game_time_seconds as number | null) ?? 0,
    gameId: (row.game_id as string | null) ?? null,
    gameNumber: (row.game_number as number | null) ?? null,
    matchExternalId: (row.match_external_id as string | null) ?? null,
    matchStage: (row.match_stage as string | null) ?? null,
    matchDate: (row.match_date as string | null) ?? null,
    opponentCode: (row.opponent_code as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null,
  };
}

/**
 * One typed entry point for every page that wants a slice of clips.
 * Returns up to `limit` rows ordered by highlight_score, avg_rating,
 * recency. Empty array on any failure (logged via console).
 */
export async function getClipsFiltered(
  filter: ClipFilter,
  limit = 24,
): Promise<FilteredClip[]> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("fn_get_clips_filtered", {
      p_filter: buildJsonbFilter(filter),
      p_limit: limit,
    });
    if (error) {
      console.warn("[supabase/clips] fn_get_clips_filtered error:", error.message);
      return [];
    }
    return (data ?? []).map((row: Record<string, unknown>) => normalize(row));
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/clips] fn_get_clips_filtered threw:", err);
    return [];
  }
}
