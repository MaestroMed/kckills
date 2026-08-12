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
import {
  fetchDetectedKcKillsCount,
  fetchGamesAllCompetCount,
  fetchMatchesAllCompet,
  fetchPublishedClipsCount,
} from "@/lib/stats-scopes";

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
  /** Matchs terminés sans winner_team_id en base (backfill gol.gg) —
   *  exclus de `losses` ET du winrate depuis l'audit compteurs 12/08. */
  unknownResults: number;
  winRate: number; // 0..1 — sur matchs décidés uniquement (W+L)
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
 *
 * 🐛 2026-08-12 fix : les matchs backfillés gol.gg ont `scheduled_at`
 * NULL et des games sans `winner_team_id`. `ORDER BY scheduled_at DESC`
 * remontait les NULL en tête (défaut Postgres) → la carte hero affichait
 * « KC 0 - 0 GX · 1 janv. » (new Date(null) = epoch 1970) alors que la
 * grande section « DERNIER MATCH » plus bas montrait le bon match. On ne
 * considère désormais qu'un lot de matchs terminés ET datés, et on garde
 * le premier avec un VRAI score (au moins une game gagnée par un des deux
 * camps). Si aucun candidat ne qualifie — cas actuel tant que le worker
 * n'a pas rempli games.winner_team_id — on renvoie null : HeroLiveStats
 * retombe alors sur le snapshot statique real-data.ts, la même source que
 * la section complète → les deux surfaces montrent le même match.
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
      .not("scheduled_at", "is", null)
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .limit(12);

    if (!matches || matches.length === 0) return null;
    const candidates = matches as Array<{
      id: string;
      external_id: string | null;
      scheduled_at: string;
      state: string;
      stage: string | null;
      format: string | null;
      team_blue_id: string | null;
      team_red_id: string | null;
      winner_team_id: string | null;
    }>;

    // Une seule requête games pour l'ensemble des candidats (12 max).
    const { data: games } = await sb
      .from("games")
      .select("match_id, winner_team_id")
      .in(
        "match_id",
        candidates.map((c) => c.id),
      );
    const gamesByMatch = new Map<
      string,
      Array<{ winner_team_id: string | null }>
    >();
    for (const g of (games ?? []) as Array<{
      match_id: string;
      winner_team_id: string | null;
    }>) {
      const bucket = gamesByMatch.get(g.match_id);
      if (bucket) bucket.push(g);
      else gamesByMatch.set(g.match_id, [g]);
    }

    for (const m of candidates) {
      // Date plausible uniquement (même clamp que getHeroCareerStats) —
      // écarte les fallbacks epoch/1970 et les années aberrantes.
      const yr = new Date(m.scheduled_at).getUTCFullYear();
      if (!Number.isFinite(yr) || yr < 2011 || yr > 2030) continue;

      const opponentId =
        m.team_blue_id === teamId ? m.team_red_id : m.team_blue_id;
      if (!opponentId) continue;

      // Per-game scoring : count KC wins vs opponent wins
      let kcScore = 0;
      let oppScore = 0;
      for (const g of gamesByMatch.get(m.id) ?? []) {
        if (g.winner_team_id === teamId) kcScore++;
        else if (g.winner_team_id === opponentId) oppScore++;
      }

      // Un match terminé a forcément au moins une game gagnée : un 0-0
      // signifie que le worker n'a pas (encore) posé games.winner_team_id
      // → candidat suivant.
      if (kcScore + oppScore === 0) continue;

      const { data: oppRow } = await sb
        .from("teams")
        .select("code, name")
        .eq("id", opponentId)
        .maybeSingle();

      const bestOfMatch = (m.format ?? "bo1").match(/(\d)/);
      const bestOf = bestOfMatch ? parseInt(bestOfMatch[1], 10) : 1;

      // 🐛 2026-04-28 fix : `matches.winner_team_id` is occasionally null
      // for recently-completed matches when the worker hasn't backfilled
      // that column yet (the games rows always have it, the matches row
      // is set in a separate write that can race or fail). Derive kcWon
      // from the per-game tally instead so the hero never flashes "L"
      // while KC actually won.
      let kcWon: boolean;
      if (m.winner_team_id) {
        kcWon = m.winner_team_id === teamId;
      } else {
        kcWon = kcScore > oppScore;
      }

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
        kcWon,
        stage: m.stage,
        bestOf,
      };
    }

    // Aucun match daté avec un vrai score → laisse le fallback statique
    // (real-data.ts) prendre le relai côté composant.
    return null;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[hero-stats] getHeroLastMatch threw:", err);
    return null;
  }
});

/**
 * Aggregate career stats for the tracked team. La requête n'a AUCUN
 * filtre de ligue ni de date : elle agrège TOUS les matchs terminés de
 * KC, toutes compétitions confondues (LFL 2021, EU Masters, LEC…) — le
 * libellé de la carte hero doit donc dire « toutes compétitions », pas
 * « LEC ».
 *
 * ♻️ Audit compteurs 2026-08-12 : cette fonction COMPOSE désormais les
 * compteurs canoniques de `lib/stats-scopes.ts` au lieu de porter ses
 * propres requêtes. Deux bugs corrigés au passage :
 *   * `losses` comptait « pas gagné = perdu » → les 42 matchs backfillés
 *     sans winner_team_id gonflaient les défaites (305W-232L, WR 56,8 %)
 *     — ils vivent maintenant dans `unknownResults` (305W-190L, 61,6 %).
 *   * `publishedClips` comptait TOUTES les lignes status=published (deux
 *     camps, avec ou sans clip → « 9 276 CLIPS » sur la home) alors que
 *     /scroll affichait 5 224. C'est maintenant LE compteur « clips »
 *     canonique (kills KC publiés avec clip jouable).
 *
 * Le paramètre `buildTime` est conservé pour compat d'appel mais n'a
 * plus d'effet : les compteurs canoniques sont anon-only (données
 * publiques, clé de cache stable cross-request).
 */
export const getHeroCareerStats = cache(async function getHeroCareerStats(
  _buildTime = false,
): Promise<HeroCareerStats | null> {
  try {
    const [tally, totalGames, totalKills, publishedClips] = await Promise.all([
      fetchMatchesAllCompet(),
      fetchGamesAllCompetCount(),
      fetchDetectedKcKillsCount(),
      fetchPublishedClipsCount(),
    ]);
    if (!tally) return null;

    return {
      totalKills,
      totalGames,
      wins: tally.wins,
      losses: tally.losses,
      unknownResults: tally.unknown,
      winRate: tally.winratePct != null ? tally.winratePct / 100 : 0,
      publishedClips,
      yearStart: tally.yearStart,
      yearEnd: tally.yearEnd,
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
