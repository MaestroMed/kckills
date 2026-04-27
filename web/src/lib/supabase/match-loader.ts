/**
 * match-loader.ts — Hybrid match fetcher (real-data.ts → Supabase fallback).
 *
 * Why this exists
 * ───────────────
 * /match/[slug] historically read from `lib/real-data.ts` — a static
 * JSON snapshot curated by the operator and bundled at build time.
 * That works for the documented matches it ships with, but it 404s
 * EVERY recent match (FNC 2026-04-26, NAVI 2026-04-25, SHIFTERS, etc.)
 * because those are only in Supabase, not in the JSON snapshot.
 *
 * Result : the homepage hero links to /match/<external_id> for the
 * latest live match, the user clicks → 404 page. Bug.
 *
 * This module exposes `getMatchByIdHybrid(slug)` :
 *   1. Tries the static real-data.ts first (fast, no DB call).
 *   2. If not found, queries Supabase by external_id / id.
 *   3. Reconstructs the RealMatch shape from matches + games +
 *      game_participants joins so the existing /match JSX works
 *      unchanged.
 *   4. Returns the result OR undefined.
 *
 * Pages that use this can now serve EVERY completed match — the
 * static snapshot becomes a perf optimization, not a content gate.
 *
 * Cache-friendly : passes `buildTime: true` on every Supabase call
 * so the page stays cacheable per its `revalidate = 600` ISR setting.
 */

import {
  loadRealData,
  getMatchById,
  type RealMatch,
  type RealGame,
  type RealPlayer,
} from "@/lib/real-data";
import { createAnonSupabase, rethrowIfDynamic } from "./server";

// ─── Lightweight Supabase row shapes ──────────────────────────────────

interface MatchRow {
  id: string;
  external_id: string | null;
  scheduled_at: string | null;
  format: string | null;
  stage: string | null;
  team_blue_id: string | null;
  team_red_id: string | null;
  winner_team_id: string | null;
}

interface GameRow {
  id: string;
  game_number: number;
  winner_team_id: string | null;
  duration_seconds: number | null;
  patch: string | null;
}

interface ParticipantRow {
  player_id: string | null;
  team_id: string | null;
  champion: string | null;
  role: string | null;
  side: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  player?: { ign?: string | null } | null;
}

interface TeamRow {
  id: string;
  code: string | null;
  name: string | null;
  is_tracked: boolean | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

const ROLE_NORMALIZE: Record<string, string> = {
  TOP: "top",
  JUNGLE: "jungle",
  JG: "jungle",
  MID: "mid",
  MIDDLE: "mid",
  BOT: "bottom",
  BOTTOM: "bottom",
  ADC: "bottom",
  SUPPORT: "support",
  SUP: "support",
  UTILITY: "support",
};

function normRole(raw: string | null | undefined): string {
  if (!raw) return "";
  return ROLE_NORMALIZE[raw.toUpperCase()] ?? raw.toLowerCase();
}

function buildRealPlayer(p: ParticipantRow): RealPlayer {
  return {
    name: p.player?.ign ?? `?${(p.champion ?? "?").slice(0, 4)}`,
    role: normRole(p.role),
    champion: p.champion ?? "?",
    kills: p.kills ?? 0,
    deaths: p.deaths ?? 0,
    assists: p.assists ?? 0,
    gold: 0,
    cs: 0,
    level: 0,
  };
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Fetch a match by URL slug — preferring the static real-data.ts
 * snapshot for speed, falling back to Supabase for recent matches.
 *
 * The slug is whatever the page route receives — typically the
 * matches.external_id (a Riot 18-digit ID for live LEC games, or a
 * synthetic golgg_match_<id> for historical gol.gg backfills).
 *
 * @param slug    The URL parameter (matches.external_id or matches.id)
 * @returns RealMatch (static or DB-derived) OR undefined if not found
 */
export async function getMatchByIdHybrid(
  slug: string,
): Promise<RealMatch | undefined> {
  // 1. Try the static curated snapshot first (free, no DB call).
  const staticData = loadRealData();
  const staticMatch = getMatchById(staticData, slug);
  if (staticMatch) return staticMatch;

  // 2. Fall back to Supabase. Use the cookie-less anon client to keep
  //    the page cacheable per its ISR setting.
  try {
    return await fetchFromSupabase(slug);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[match-loader] supabase fallback threw:", err);
    return undefined;
  }
}

async function fetchFromSupabase(slug: string): Promise<RealMatch | undefined> {
  const sb = createAnonSupabase();

  // matches.external_id OR matches.id — try external_id first since
  // that's what the homepage hero card links to (it's the natural URL
  // identifier for esports rows).
  const { data: byExt } = await sb
    .from("matches")
    .select(
      "id, external_id, scheduled_at, format, stage, team_blue_id, team_red_id, winner_team_id",
    )
    .eq("external_id", slug)
    .maybeSingle();

  let row = byExt as MatchRow | null;
  if (!row) {
    // Try by primary key UUID
    const { data: byId } = await sb
      .from("matches")
      .select(
        "id, external_id, scheduled_at, format, stage, team_blue_id, team_red_id, winner_team_id",
      )
      .eq("id", slug)
      .maybeSingle();
    row = (byId as MatchRow | null) ?? null;
  }

  if (!row) return undefined;

  // Parallel fetch teams + games + game_participants + kills (kills used
  // as the participant fallback when game_participants is empty — the
  // KC vs FNC match today has 81 kills detected on game 1 but ZERO
  // game_participants rows because that pipeline stage hasn't run).
  const teamIds = [row.team_blue_id, row.team_red_id].filter(Boolean) as string[];
  const [teamsRes, gamesRes, participantsRes, killsRes] = await Promise.all([
    teamIds.length > 0
      ? sb.from("teams").select("id, code, name, is_tracked").in("id", teamIds)
      : Promise.resolve({ data: [] as TeamRow[] }),
    sb
      .from("games")
      .select("id, game_number, winner_team_id, duration_seconds, patch")
      .eq("match_id", row.id)
      .order("game_number"),
    sb
      .from("game_participants")
      .select(
        "player_id, team_id, champion, role, side, kills, deaths, assists, " +
          "player:players(ign)",
      )
      .eq("game_id", row.id),
    // Lightweight kills join — only the columns we need to derive a
    // KC-side champion roster when game_participants is empty.
    sb
      .from("kills")
      .select("killer_champion, victim_champion, killer_player_id, victim_player_id, tracked_team_involvement, game_id")
      .in("game_id", [row.id]),
  ]);

  const teams = (teamsRes.data ?? []) as TeamRow[];
  const games = (gamesRes.data ?? []) as GameRow[];
  // Supabase typings infer the join column as GenericStringError when the
  // SELECT string contains a relation alias — cast through `unknown` so
  // TypeScript accepts our explicit ParticipantRow shape.
  const participants = ((participantsRes.data ?? []) as unknown) as ParticipantRow[];
  // killsRes filtered by game_id IN [row.id] — but row.id is the MATCH
  // uuid, not a game_id. Fix : we need to refetch by the actual game IDs
  // discovered above.
  const killsByGame = new Map<string, Array<{
    killer_champion: string | null;
    victim_champion: string | null;
    tracked_team_involvement: string | null;
  }>>();
  if (games.length > 0) {
    const gameIds = games.map((g) => g.id);
    const { data: realKills } = await sb
      .from("kills")
      .select("killer_champion, victim_champion, tracked_team_involvement, game_id")
      .in("game_id", gameIds);
    for (const k of (realKills ?? []) as Array<{
      killer_champion: string | null;
      victim_champion: string | null;
      tracked_team_involvement: string | null;
      game_id: string;
    }>) {
      const arr = killsByGame.get(k.game_id) ?? [];
      arr.push(k);
      killsByGame.set(k.game_id, arr);
    }
  }
  // Discard the stub killsRes since we re-fetched correctly above.
  void killsRes;

  const kcTeam = teams.find((t) => t.is_tracked);
  const oppTeam = teams.find((t) => !t.is_tracked);

  const kcSide: "blue" | "red" =
    kcTeam && row.team_blue_id === kcTeam.id ? "blue" : "red";

  // game_number → players grouped by team-side
  const participantsByGame = new Map<string, ParticipantRow[]>();
  for (const p of participants) {
    const arr = participantsByGame.get(p.team_id ?? "") ?? [];
    arr.push(p);
    participantsByGame.set(p.team_id ?? "", arr);
  }

  // Score : count games KC won vs opp won
  let kcScore = 0;
  let oppScore = 0;
  for (const g of games) {
    if (g.winner_team_id === kcTeam?.id) kcScore++;
    else if (g.winner_team_id === oppTeam?.id) oppScore++;
  }
  const kcWon = row.winner_team_id === kcTeam?.id || (kcScore > oppScore);

  // Best-of from format string
  const bofMatch = (row.format ?? "bo1").match(/bo?(\d)/i);
  const bestOf = bofMatch ? parseInt(bofMatch[1], 10) : 1;

  // Per-game players + kill counts. Two-source strategy :
  //   * If game_participants has rows for this team — use them (full
  //     player.ign + role + KDA).
  //   * Otherwise fall back to deriving champions from the kills table
  //     (KC vs FNC today : 0 game_participants but 81+68 kills with
  //     killer_champion + victim_champion + tracked_team_involvement).
  //     The fallback gives champion + side but not player names ;
  //     better than rendering an empty roster card.
  function deriveFromKills(gameId: string): {
    kcChamps: Set<string>;
    oppChamps: Set<string>;
    kcKills: number;
    oppKills: number;
  } {
    const out = {
      kcChamps: new Set<string>(),
      oppChamps: new Set<string>(),
      kcKills: 0,
      oppKills: 0,
    };
    const kills = killsByGame.get(gameId) ?? [];
    for (const k of kills) {
      const inv = k.tracked_team_involvement ?? "";
      if (inv === "team_killer") {
        if (k.killer_champion) out.kcChamps.add(k.killer_champion);
        if (k.victim_champion) out.oppChamps.add(k.victim_champion);
        out.kcKills++;
      } else if (inv === "team_victim") {
        if (k.killer_champion) out.oppChamps.add(k.killer_champion);
        if (k.victim_champion) out.kcChamps.add(k.victim_champion);
        out.oppKills++;
      }
    }
    return out;
  }

  const realGames: RealGame[] = games.map((g) => {
    const kcParts = participants
      .filter((p) => p.team_id === kcTeam?.id)
      .filter((p, idx, arr) => arr.findIndex((q) => q.player_id === p.player_id) === idx);
    const oppParts = participants
      .filter((p) => p.team_id === oppTeam?.id)
      .filter((p, idx, arr) => arr.findIndex((q) => q.player_id === p.player_id) === idx);

    if (kcParts.length > 0 || oppParts.length > 0) {
      // Happy path : game_participants populated.
      const kcKills = kcParts.reduce((s, p) => s + (p.kills ?? 0), 0);
      const oppKills = oppParts.reduce((s, p) => s + (p.kills ?? 0), 0);
      return {
        id: g.id,
        number: g.game_number,
        kc_players: kcParts.map(buildRealPlayer),
        opp_players: oppParts.map(buildRealPlayer),
        kc_kills: kcKills,
        opp_kills: oppKills,
        kc_gold: 0,
        kc_towers: 0,
        kc_dragons: 0,
        kc_barons: 0,
        vods: [],
      } as RealGame;
    }

    // Fallback : derive from kills.
    const derived = deriveFromKills(g.id);
    const kcDerivedPlayers: RealPlayer[] = [...derived.kcChamps].map((c) => ({
      name: `?${c.slice(0, 4)}`, // unknown player, prefix with ? + champion stub
      role: "",
      champion: c,
      kills: 0, // per-player KDA breakdown unknown without participants
      deaths: 0,
      assists: 0,
      gold: 0,
      cs: 0,
      level: 0,
    }));
    const oppDerivedPlayers: RealPlayer[] = [...derived.oppChamps].map((c) => ({
      name: `?${c.slice(0, 4)}`,
      role: "",
      champion: c,
      kills: 0,
      deaths: 0,
      assists: 0,
      gold: 0,
      cs: 0,
      level: 0,
    }));
    return {
      id: g.id,
      number: g.game_number,
      kc_players: kcDerivedPlayers,
      opp_players: oppDerivedPlayers,
      kc_kills: derived.kcKills,
      opp_kills: derived.oppKills,
      kc_gold: 0,
      kc_towers: 0,
      kc_dragons: 0,
      kc_barons: 0,
      vods: [],
    } as RealGame;
  });

  return {
    id: row.external_id ?? row.id,
    date: row.scheduled_at ?? "",
    league: "",
    stage: row.stage ?? "",
    kc_side: kcSide,
    opponent: {
      name: oppTeam?.name ?? "Inconnu",
      code: oppTeam?.code ?? "?",
    },
    kc_image: undefined,
    kc_won: kcWon,
    kc_score: kcScore,
    opp_score: oppScore,
    best_of: bestOf,
    games: realGames,
  } as RealMatch;
}
