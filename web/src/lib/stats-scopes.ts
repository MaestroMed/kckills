/**
 * stats-scopes.ts — compteurs canoniques par périmètre (audit 2026-08-12).
 *
 * PROBLÈME : mesuré le 12/08 sur le build prod, cinq surfaces affichaient
 * cinq vérités différentes pour « clips » / « kills » / « matchs » :
 *   * Home      : « 9 276 CLIPS » (= TOUTES les lignes kills publiées,
 *                 deux camps confondus, avec ou sans clip — mal libellé)
 *   * /scroll   : « 5 224 CLIPS » (kills KC publiés avec clip jouable)
 *   * /clips    : « 1 181 clips publiés » (cap fetch 2000 → sous-compte)
 *   * /matches  : « 300 CLIPS » (= cap getPublishedKills(300), pas un total)
 *   * /stats    : périmètre log détaillé (112 games) sans le dire
 *
 * VOCABULAIRE UNIQUE (règles produit) :
 *   * « clips »  = kills KC PUBLIÉS avec clip jouable (le prédicat exact
 *                  du feed /scroll : published + kill_visible +
 *                  team_killer + clip_url_vertical + thumbnail_url).
 *                  Même périmètre ⇒ même chiffre partout. → 5 224 au 12/08.
 *   * « kills »  = événements de kill KC détectés et publiés (clip OU
 *                  data-only). → 5 234 au 12/08.
 *   * matchs vs games : jamais mélangés sans libellés distincts ; un W-L
 *     affiché à côté d'un total doit sommer avec lui (d'où le champ
 *     `unknown` : matchs terminés sans winner_team_id en base).
 *
 * UNE implémentation par compteur, réutilisée par les 5 surfaces :
 *   * Home (HeroLiveStats via hero-stats.ts getHeroCareerStats)
 *   * /scroll (header du feed — catalogTotal)
 *   * /clips (header du catalogue)
 *   * /matches (chips du hero)
 *   * /stats (KPI du dashboard — périmètre « log détaillé », statique)
 *
 * SOURCE : la vue SQL `v_kc_stats_scopes` (migration 095, appliquée à la
 * main par Mehdi) renvoie tous les compteurs en UN SELECT. Tant qu'elle
 * n'existe pas en prod, chaque compteur retombe sur les requêtes REST
 * historiques (HEAD counts) — mêmes prédicats, mêmes chiffres.
 *
 * CACHE : les wrappers getCached* suivent le pattern hero-stats-cached
 * (unstable_cache, TTL 300 s, tag partagé). Les fetch* bruts restent
 * exposés pour composition dans des fonctions déjà cachées (hero-stats).
 */

import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createAnonSupabase, rethrowIfDynamic } from "@/lib/supabase/server";
import { getPublishedKcKillCount } from "@/lib/supabase/kills";
import { loadRealData } from "@/lib/real-data";

/** Tag d'invalidation : `revalidateTag(STATS_SCOPES_TAG)` après un write
 *  worker. On garde aussi le tag 'hero-stats' historique côté wrappers
 *  pour que la revalidation existante continue de toucher ces compteurs. */
export const STATS_SCOPES_TAG = "stats-scopes" as const;

// ─── Types ────────────────────────────────────────────────────────────

/** Bilan matchs toutes compétitions (2021→) depuis la DB worker.
 *  Invariant : wins + losses + unknown === total. */
export interface MatchesAllCompet {
  total: number;
  wins: number;
  losses: number;
  /** Matchs terminés SANS winner_team_id en base (backfill gol.gg
   *  incomplet). Exclus du winrate — « dont X sans résultat connu ». */
  unknown: number;
  /** Winrate sur matchs DÉCIDÉS uniquement : wins / (wins + losses). */
  winratePct: number | null;
  yearStart: number;
  yearEnd: number;
}

/** Périmètre « log détaillé » : les games du snapshot statique
 *  kc_matches.json (stats par game vérifiées : kills, gold, picks…).
 *  C'est le périmètre de /stats — PAS la carrière complète. */
export interface TrackedGamesDetailed {
  games: number;
  /** Games « gagnées » via le proxy kc_kills > opp_kills (le log ne
   *  porte pas le vainqueur par game) — d'où le libellé « est. ». */
  gameWins: number;
  gameWinratePct: number | null;
  kcKills: number;
  matches: number;
  matchWins: number;
  matchLosses: number;
}

// ─── Vue SQL (migration 095) — un SELECT pour tous les compteurs ──────

interface StatsScopesViewRow {
  published_clips: number | null;
  detected_kc_kills: number | null;
  matches_total: number | null;
  matches_wins: number | null;
  matches_unknown: number | null;
  games_total: number | null;
  year_start: number | null;
  year_end: number | null;
}

/**
 * Lit la vue v_kc_stats_scopes. `null` si la vue n'est pas (encore)
 * appliquée en prod → chaque compteur retombe sur sa requête REST.
 * React `cache()` : un seul hit vue par render pass même si les cinq
 * compteurs sont demandés en parallèle.
 */
const getScopesFromView = cache(
  async function getScopesFromView(): Promise<StatsScopesViewRow | null> {
    try {
      const sb = createAnonSupabase();
      const { data, error } = await sb
        .from("v_kc_stats_scopes")
        .select("*")
        .maybeSingle();
      if (error || !data) return null; // vue absente / pas de droits → fallback
      return data as StatsScopesViewRow;
    } catch (err) {
      rethrowIfDynamic(err);
      return null;
    }
  },
);

/** Team trackée (KC). Dupliqué de hero-stats mais en anon-only : les
 *  compteurs canoniques sont des données publiques, pas besoin du client
 *  cookie-aware (et le cache cross-request exige une clé stable). */
const getTrackedTeamIdAnon = cache(
  async function getTrackedTeamIdAnon(): Promise<string | null> {
    const sb = createAnonSupabase();
    const { data } = await sb
      .from("teams")
      .select("id")
      .eq("is_tracked", true)
      // l'équipe suivie la plus ancienne : choix déterministe (KC a eu une
      // ligne en double ; sans tri, Postgres renvoie un ordre arbitraire)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  },
);

// ─── Compteurs canoniques (implémentation unique) ─────────────────────

/**
 * « CLIPS » — kills KC publiés avec clip jouable. La vérité de /clips,
 * /scroll, et de la chip clips partout ailleurs.
 * Implémentation : vue 095, sinon getPublishedKcKillCount (le HEAD count
 * historique de kills.ts — prédicat STRICTEMENT identique à la vue).
 */
export async function fetchPublishedClipsCount(): Promise<number> {
  const v = await getScopesFromView();
  if (v && typeof v.published_clips === "number") return v.published_clips;
  return getPublishedKcKillCount({ buildTime: true });
}

/**
 * « KILLS » — événements de kill KC détectés et publiés (kill_visible,
 * team_killer), AVEC ou SANS clip. Le gros chiffre carrière de la home.
 */
export async function fetchDetectedKcKillsCount(): Promise<number> {
  const v = await getScopesFromView();
  if (v && typeof v.detected_kc_kills === "number") return v.detected_kc_kills;
  try {
    const sb = createAnonSupabase();
    const { count, error } = await sb
      .from("kills")
      .select("id", { count: "exact", head: true })
      .or(
        "publication_status.eq.published," +
          "and(publication_status.is.null,status.eq.published)",
      )
      .eq("kill_visible", true)
      .eq("tracked_team_involvement", "team_killer");
    if (error) {
      console.warn("[stats-scopes] fetchDetectedKcKillsCount error:", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[stats-scopes] fetchDetectedKcKillsCount threw:", err);
    return 0;
  }
}

/**
 * Bilan matchs toutes compétitions — matchs KC `state=completed` en DB.
 * ⚠️ Historique du bug (12/08) : l'ancien code hero-stats comptait
 * « pas gagné = perdu », donc les 42 matchs backfillés sans
 * winner_team_id gonflaient les défaites (305W-232L au lieu de
 * 305W-190L + 42 sans résultat) et écrasaient le winrate (56,8 % au
 * lieu de 61,6 %). `unknown` les isole désormais.
 */
export async function fetchMatchesAllCompet(): Promise<MatchesAllCompet | null> {
  const currentYear = new Date().getUTCFullYear();
  const v = await getScopesFromView();
  if (
    v &&
    typeof v.matches_total === "number" &&
    typeof v.matches_wins === "number" &&
    typeof v.matches_unknown === "number"
  ) {
    const wins = v.matches_wins;
    const unknown = v.matches_unknown;
    const losses = Math.max(0, v.matches_total - wins - unknown);
    return {
      total: v.matches_total,
      wins,
      losses,
      unknown,
      winratePct: wins + losses > 0 ? (wins / (wins + losses)) * 100 : null,
      yearStart: v.year_start ?? currentYear,
      yearEnd: v.year_end ?? currentYear,
    };
  }

  // Fallback REST — même boucle que l'ancien getHeroCareerStats
  // (année du tournoi d'abord, clamp ère esport 2011-2030), mais avec
  // le split losses / unknown.
  try {
    const sb = createAnonSupabase();
    const teamId = await getTrackedTeamIdAnon();
    if (!teamId) return null;

    const { data: matches } = await sb
      .from("matches")
      .select("id, winner_team_id, scheduled_at, tournaments(year)")
      .or(`team_blue_id.eq.${teamId},team_red_id.eq.${teamId}`)
      .eq("state", "completed");

    let wins = 0;
    let losses = 0;
    let unknown = 0;
    let total = 0;
    let yearMin = 9999;
    let yearMax = 0;
    for (const m of (matches ?? []) as unknown as Array<{
      id: string;
      winner_team_id: string | null;
      scheduled_at: string | null;
      tournaments: { year: number | null } | null;
    }>) {
      total++;
      if (m.winner_team_id === teamId) wins++;
      else if (m.winner_team_id) losses++;
      else unknown++;
      const yr =
        m.tournaments?.year ??
        (m.scheduled_at ? new Date(m.scheduled_at).getUTCFullYear() : NaN);
      if (!Number.isFinite(yr) || yr < 2011 || yr > 2030) continue;
      if (yr < yearMin) yearMin = yr;
      if (yr > yearMax) yearMax = yr;
    }
    if (total === 0) return null;

    return {
      total,
      wins,
      losses,
      unknown,
      winratePct: wins + losses > 0 ? (wins / (wins + losses)) * 100 : null,
      yearStart: yearMin === 9999 ? currentYear : yearMin,
      yearEnd: yearMax === 0 ? currentYear : yearMax,
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[stats-scopes] fetchMatchesAllCompet threw:", err);
    return null;
  }
}

/**
 * Games jouées toutes compétitions — games rattachées aux matchs KC
 * terminés. NB : games.winner_team_id est NULL sur tout le backfill
 * gol.gg → PAS de winrate par game possible sur ce périmètre (seul le
 * périmètre « log détaillé » en a un, estimé).
 */
export async function fetchGamesAllCompetCount(): Promise<number> {
  const v = await getScopesFromView();
  if (v && typeof v.games_total === "number") return v.games_total;
  try {
    const sb = createAnonSupabase();
    const teamId = await getTrackedTeamIdAnon();
    if (!teamId) return 0;
    const { count } = await sb
      .from("games")
      .select("id, matches!inner(id)", { count: "exact", head: true })
      .or(`team_blue_id.eq.${teamId},team_red_id.eq.${teamId}`, {
        referencedTable: "matches",
      })
      .eq("matches.state", "completed");
    return count ?? 0;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[stats-scopes] fetchGamesAllCompetCount threw:", err);
    return 0;
  }
}

/**
 * Périmètre « log détaillé » — agrégats du snapshot statique
 * kc_matches.json (la source de /stats). Synchrone, zéro egress.
 * Implémentation unique de la boucle qui vivait dans app/stats/page.tsx.
 */
export function getTrackedGamesDetailed(): TrackedGamesDetailed {
  const data = loadRealData();
  let games = 0;
  let gameWins = 0;
  let kcKills = 0;
  let matchWins = 0;
  for (const m of data.matches) {
    if (m.kc_won) matchWins++;
    for (const g of m.games) {
      games++;
      kcKills += g.kc_kills;
      // Proxy : le log ne porte pas le vainqueur par game — on estime
      // via le différentiel de kills (libeller « est. » côté UI).
      if (g.kc_kills > g.opp_kills) gameWins++;
    }
  }
  return {
    games,
    gameWins,
    gameWinratePct: games > 0 ? (gameWins / games) * 100 : null,
    kcKills,
    matches: data.matches.length,
    matchWins,
    matchLosses: data.matches.length - matchWins,
  };
}

// ─── Wrappers cross-request (pattern hero-stats-cached) ───────────────

export const getCachedPublishedClipsCount = unstable_cache(
  async (): Promise<number> => fetchPublishedClipsCount(),
  ["stats-scopes-published-clips"],
  { revalidate: 300, tags: [STATS_SCOPES_TAG, "hero-stats"] },
);

export const getCachedDetectedKcKillsCount = unstable_cache(
  async (): Promise<number> => fetchDetectedKcKillsCount(),
  ["stats-scopes-detected-kc-kills"],
  { revalidate: 300, tags: [STATS_SCOPES_TAG, "hero-stats"] },
);

export const getCachedMatchesAllCompet = unstable_cache(
  async (): Promise<MatchesAllCompet | null> => fetchMatchesAllCompet(),
  ["stats-scopes-matches-all-compet"],
  { revalidate: 300, tags: [STATS_SCOPES_TAG, "hero-stats"] },
);

export const getCachedGamesAllCompetCount = unstable_cache(
  async (): Promise<number> => fetchGamesAllCompetCount(),
  ["stats-scopes-games-all-compet"],
  { revalidate: 300, tags: [STATS_SCOPES_TAG, "hero-stats"] },
);
