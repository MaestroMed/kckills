/**
 * hero-stats.ts — LIVE hero overlay data, sourced from Supabase.
 *
 * Replaces the static `getTeamStats` + `getMatchesSorted` from
 * `lib/real-data.ts` for the homepage hero cards :
 *   * Last completed KC match (with date / opponent / score)
 *   * Career stats : kills / wins / losses / WR / total clips
 *   * Top scorer of the current career window
 *
 * Why : the real-data.ts source is a hand-curated JSON snapshot. As soon
 * as a new match completes (e.g. KC vs SHIFTERS hier après-midi), the
 * hero showed last week's Vitality match for hours. The live loader
 * pulls from the SAME database the worker writes to → hero refreshes
 * within one ISR window (5 min).
 *
 * Caching : `revalidate = 300` (5 min ISR) so the page stays fast,
 * but new matches surface within minutes of Sentinel writing them.
 */

import { cache } from "react";
import {
  createAnonSupabase,
  createServerSupabase,
  rethrowIfDynamic,
} from "@/lib/supabase/server";

export interface HeroLastMatch {
  matchId: string;
  externalId: string | null;
  scheduledAt: string;
  opponent: { code: string; name: string };
  kcScore: number;
  oppScore: number;
  kcWon: boolean;
  stage: string | null;
  bestOf: number;
}

export interface HeroCareerStats {
  totalKills: number;
  totalGames: number;
  wins: number;
  losses: number;
  winRate: number; // 0..1
  publishedClips: number;
  yearStart: number;
  yearEnd: number;
}

export interface HeroTopScorer {
  ign: string;
  role: string | null;
  totalKills: number;
  gamesPlayed: number;
  imageUrl: string | null;
}

/**
 * Identify the tracked team (KC) from the teams table. Cached per request.
 */
async function getTrackedTeamId(buildTime = false): Promise<string | null> {
  const sb = buildTime
    ? createAnonSupabase()
    : await createServerSupabase();
  const { data } = await sb
    .from("teams")
    .select("id")
    .eq("is_tracked", true)
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Last completed match involving the tracked team.
 * Pulls scores from games (KC's per-game wins).
 */
export const getHeroLastMatch = cache(async function getHeroLastMatch(
  buildTime = false,
): Promise<HeroLastMatch | null> {
  try {
    const sb = buildTime
      ? createAnonSupabase()
      : await createServerSupabase();
    const teamId = await getTrackedTeamId(buildTime);
    if (!teamId) return null;

    const { data: matches } = await sb
      .from("matches")
      .select(
        `id, external_id, scheduled_at, state, stage, format,
         team_blue_id, team_red_id, winner_team_id`,
      )
      .or(`team_blue_id.eq.${teamId},team_red_id.eq.${teamId}`)
      .eq("state", "completed")
      .order("scheduled_at", { ascending: false })
      .limit(1);

    if (!matches || matches.length === 0) return null;
    const m = matches[0] as {
      id: string;
      external_id: string | null;
      scheduled_at: string;
      state: string;
      stage: string | null;
      format: string | null;
      team_blue_id: string | null;
      team_red_id: string | null;
      winner_team_id: string | null;
    };

    const opponentId =
      m.team_blue_id === teamId ? m.team_red_id : m.team_blue_id;
    if (!opponentId) return null;

    const { data: oppRow } = await sb
      .from("teams")
      .select("code, name")
      .eq("id", opponentId)
      .maybeSingle();

    // Per-game scoring : count KC wins vs opponent wins
    const { data: games } = await sb
      .from("games")
      .select("id, winner_team_id")
      .eq("match_id", m.id);

    let kcScore = 0;
    let oppScore = 0;
    for (const g of (games ?? []) as Array<{ winner_team_id: string | null }>) {
      if (g.winner_team_id === teamId) kcScore++;
      else if (g.winner_team_id === opponentId) oppScore++;
    }

    const bestOfMatch = (m.format ?? "bo1").match(/(\d)/);
    const bestOf = bestOfMatch ? parseInt(bestOfMatch[1], 10) : 1;

    return {
      matchId: m.id,
      externalId: m.external_id,
      scheduledAt: m.scheduled_at,
      opponent: {
        code: (oppRow?.code as string | undefined) ?? "?",
        name: (oppRow?.name as string | undefined) ?? "Inconnu",
      },
      kcScore,
      oppScore,
      kcWon: m.winner_team_id === teamId,
      stage: m.stage,
      bestOf,
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[hero-stats] getHeroLastMatch threw:", err);
    return null;
  }
});

/**
 * Aggregate career stats for the tracked team across the current
 * pilot window (2024 → today). Counts kills (KC offensive only),
 * wins/losses/games from completed matches.
 */
export const getHeroCareerStats = cache(async function getHeroCareerStats(
  buildTime = false,
): Promise<HeroCareerStats | null> {
  try {
    const sb = buildTime
      ? createAnonSupabase()
      : await createServerSupabase();
    const teamId = await getTrackedTeamId(buildTime);
    if (!teamId) return null;

    // Completed matches involving KC
    const { data: matches } = await sb
      .from("matches")
      .select("id, winner_team_id, team_blue_id, team_red_id, scheduled_at")
      .or(`team_blue_id.eq.${teamId},team_red_id.eq.${teamId}`)
      .eq("state", "completed");

    let wins = 0;
    let losses = 0;
    const matchIds: string[] = [];
    let yearMin = 9999;
    let yearMax = 0;
    for (const m of (matches ?? []) as Array<{
      id: string;
      winner_team_id: string | null;
      scheduled_at: string;
    }>) {
      matchIds.push(m.id);
      if (m.winner_team_id === teamId) wins++;
      else losses++;
      const yr = new Date(m.scheduled_at).getUTCFullYear();
      if (yr < yearMin) yearMin = yr;
      if (yr > yearMax) yearMax = yr;
    }

    // Total games + total KC kills (tracked_team_involvement = team_killer)
    let totalGames = 0;
    let totalKills = 0;
    if (matchIds.length > 0) {
      const { count: gamesCount } = await sb
        .from("games")
        .select("id", { count: "exact", head: true })
        .in("match_id", matchIds);
      totalGames = gamesCount ?? 0;

      // KC offensive kills count via the tracked_team_involvement filter.
      // Only counts PUBLISHED kills with kill_visible=true so the displayed
      // total matches what users see on the scroll feed and avoids inflated
      // numbers from unpublished raw rows (pipeline in-flight, Gemini
      // failures, manual_review queue, etc.).
      //
      // ⚠️ Bug history (2026-04-26) : without these two filters the counter
      // returned 124+ "career" kills which the user flagged as suspicious
      // after only NAVI (yesterday) + SHIFTERS (today) had been processed —
      // that was raw harvested rows, not the actual visible-on-feed count.
      const { count: killsCount } = await sb
        .from("kills")
        .select("id", { count: "exact", head: true })
        .eq("tracked_team_involvement", "team_killer")
        .eq("status", "published")
        .eq("kill_visible", true);
      totalKills = killsCount ?? 0;
    }

    // Total published clips count (separate metric, used in the rail)
    const { count: clipsCount } = await sb
      .from("kills")
      .select("id", { count: "exact", head: true })
      .eq("status", "published");

    const winRate =
      wins + losses > 0 ? wins / (wins + losses) : 0;

    return {
      totalKills,
      totalGames,
      wins,
      losses,
      winRate,
      publishedClips: clipsCount ?? 0,
      yearStart: yearMin === 9999 ? new Date().getUTCFullYear() : yearMin,
      yearEnd: yearMax === 0 ? new Date().getUTCFullYear() : yearMax,
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[hero-stats] getHeroCareerStats threw:", err);
    return null;
  }
});

/**
 * Top KC scorer across the current career window. Returns the player
 * with the most published kills (offensive kills, KC side).
 */
export const getHeroTopScorer = cache(async function getHeroTopScorer(
  buildTime = false,
): Promise<HeroTopScorer | null> {
  try {
    const sb = buildTime
      ? createAnonSupabase()
      : await createServerSupabase();
    const teamId = await getTrackedTeamId(buildTime);
    if (!teamId) return null;

    // The simplest path that doesn't require a custom RPC : pull all
    // published kills with their killer_player_id, group in JS. At ~600
    // published kills today (and ~10K projected by end of pilot), this
    // is cheap. If it becomes hot we can swap to a Supabase view.
    const { data: kills } = await sb
      .from("kills")
      .select("killer_player_id")
      .eq("status", "published")
      .eq("tracked_team_involvement", "team_killer")
      .not("killer_player_id", "is", null)
      .limit(20000);

    const counts = new Map<string, number>();
    for (const k of (kills ?? []) as Array<{ killer_player_id: string | null }>) {
      if (!k.killer_player_id) continue;
      counts.set(
        k.killer_player_id,
        (counts.get(k.killer_player_id) ?? 0) + 1,
      );
    }
    if (counts.size === 0) return null;
    const [topId, topKills] = [...counts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0];

    const { data: player } = await sb
      .from("players")
      .select("ign, role, image_url")
      .eq("id", topId)
      .maybeSingle();
    if (!player) return null;

    // Games played (best-effort via game_participants table)
    const { count: gamesCount } = await sb
      .from("game_participants")
      .select("id", { count: "exact", head: true })
      .eq("player_id", topId);

    return {
      ign: player.ign as string,
      role: (player.role as string | null) ?? null,
      totalKills: topKills,
      gamesPlayed: gamesCount ?? 0,
      imageUrl: (player.image_url as string | null) ?? null,
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[hero-stats] getHeroTopScorer threw:", err);
    return null;
  }
});
