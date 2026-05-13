/**
 * Server-side data helpers for the /match/[slug] premium replay viewer.
 *
 * This module is the single source of truth that the Match Replay page
 * uses to fetch a full BO payload (match + games + participants + kills),
 * compute the per-match MVP, and resolve the surrounding matches
 * (previous / next vs the same opponent, etc.).
 *
 * Designed to coexist with `match-loader.ts` (the legacy hybrid loader
 * built around the `real-data.ts` snapshot) — we do NOT route through
 * the JSON snapshot here. The Wave-30 replay viewer is purely Supabase-
 * driven so it can render every match the worker has imported, including
 * the ones the operator hasn't curated into kc_matches.json yet.
 *
 * RLS-safe : every query goes through the anon client (`createAnonSupabase`)
 * so the page stays cacheable per its `revalidate = 600` ISR setting.
 * The matches / games / players / participants tables all rely on the
 * public read policy (no row-level filtering for them).
 *
 * Naming convention : helpers return rich, nested objects (`MatchPayload`,
 * `MatchMVP`, `RelatedMatches`) so the page component doesn't have to do
 * five JOIN ladders inline.
 */

import "server-only";
import { cache } from "react";
import { createAnonSupabase, rethrowIfDynamic } from "./server";
import { getKillsByMatchExternalId, type PublishedKillRow } from "./kills";

// ─── Types ────────────────────────────────────────────────────────────

export interface MatchTeam {
  id: string;
  name: string;
  code: string;
  slug: string;
  logoUrl: string | null;
  isTracked: boolean;
}

export interface MatchGameParticipant {
  playerId: string | null;
  playerIgn: string;
  playerImageUrl: string | null;
  teamId: string | null;
  champion: string;
  role: string | null;
  side: "blue" | "red" | null;
  kills: number;
  deaths: number;
  assists: number;
  participantId: number;
}

export interface MatchGame {
  id: string;
  externalId: string;
  number: number;
  winnerTeamId: string | null;
  durationSeconds: number | null;
  patch: string | null;
  participants: MatchGameParticipant[];
  /** YouTube VOD parameters (provider/locale pulled from livestats VOD index). */
  vodYoutubeId: string | null;
  vodOffsetSeconds: number | null;
}

export interface MatchTournament {
  id: string | null;
  name: string;
  slug: string | null;
  leagueId: string | null;
  year: number | null;
  split: string | null;
}

export interface MatchPayload {
  id: string;
  externalId: string;
  scheduledAt: string | null;
  stage: string | null;
  format: string;
  bestOf: number;
  state: string;
  blueTeam: MatchTeam | null;
  redTeam: MatchTeam | null;
  winnerTeamId: string | null;
  kcTeam: MatchTeam | null;
  opponentTeam: MatchTeam | null;
  kcScore: number;
  oppScore: number;
  kcWon: boolean;
  totalDurationSeconds: number;
  tournament: MatchTournament | null;
  games: MatchGame[];
}

export interface MatchMVP {
  /** Internal Supabase player UUID — falls back to null when the kill rows
   *  don't have `killer_player_id` populated (early livestats imports). */
  playerId: string | null;
  /** Display name. Pulled from game_participants → players when available,
   *  otherwise derived from the killer_champion + KC side. */
  ign: string;
  /** Champion this player rode through the match. Picked from the game
   *  in which they had the highest aggregate highlight contribution. */
  signatureChampion: string;
  /** Aggregate Gemini highlight score across all KC-side kills in this
   *  match. Higher = the carry of the BO. */
  aggregateScore: number;
  /** Number of clipped kills this player contributed to the match. */
  killCount: number;
  /** Optional photo URL — null when we can't resolve the player. */
  photoUrl: string | null;
}

export interface RelatedMatches {
  previousVsOpponent: MatchPreviewRow | null;
  next: MatchPreviewRow | null;
  topKillId: string | null;
  topKillScore: number | null;
}

export interface MatchPreviewRow {
  externalId: string;
  scheduledAt: string | null;
  stage: string | null;
  opponentCode: string;
  opponentName: string;
  kcWon: boolean | null;
  kcScore: number;
  oppScore: number;
}

// ─── Raw row shapes ───────────────────────────────────────────────────

interface RawTeamRow {
  id?: string | null;
  name?: string | null;
  code?: string | null;
  slug?: string | null;
  logo_url?: string | null;
  is_tracked?: boolean | null;
}

interface RawParticipantRow {
  player_id?: string | null;
  team_id?: string | null;
  champion?: string | null;
  role?: string | null;
  side?: "blue" | "red" | null;
  kills?: number | null;
  deaths?: number | null;
  assists?: number | null;
  participant_id?: number | null;
  players?: { ign?: string | null; image_url?: string | null } | null;
}

interface RawGameRow {
  id?: string | null;
  external_id?: string | null;
  game_number?: number | null;
  winner_team_id?: string | null;
  duration_seconds?: number | null;
  patch?: string | null;
  vod_youtube_id?: string | null;
  vod_offset_seconds?: number | null;
}

interface RawTournamentRow {
  id?: string | null;
  name?: string | null;
  slug?: string | null;
  league_id?: string | null;
  year?: number | null;
  split?: string | null;
}

interface RawMatchRow {
  id?: string | null;
  external_id?: string | null;
  scheduled_at?: string | null;
  format?: string | null;
  stage?: string | null;
  state?: string | null;
  team_blue_id?: string | null;
  team_red_id?: string | null;
  winner_team_id?: string | null;
  tournament_id?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function normalizeTeam(row: RawTeamRow | null | undefined): MatchTeam | null {
  if (!row || !row.id) return null;
  return {
    id: String(row.id),
    name: String(row.name ?? row.code ?? "?"),
    code: String(row.code ?? "?"),
    slug: String(row.slug ?? row.code ?? "?"),
    logoUrl: row.logo_url ?? null,
    isTracked: Boolean(row.is_tracked),
  };
}

function parseBestOf(format: string | null | undefined): number {
  const raw = String(format ?? "bo1").toLowerCase();
  const m = raw.match(/(\d)/);
  if (!m) return 1;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Fetch a full match payload (match + teams + games + participants +
 * tournament) keyed by the URL slug. The slug is either the
 * `matches.external_id` (Riot 18-digit ID, golgg_match_<n>, etc.) or
 * the UUID `matches.id`.
 *
 * Returns null when no match resolves — callers must call `notFound()`.
 *
 * React-cached so the page component and metadata generator share a
 * single Supabase round-trip on the same render pass.
 */
export const getMatchBySlug = cache(async function getMatchBySlug(
  slug: string,
): Promise<MatchPayload | null> {
  try {
    const sb = createAnonSupabase();

    // 1. Resolve the match row by external_id first, then by UUID.
    const { data: byExt } = await sb
      .from("matches")
      .select(
        "id, external_id, scheduled_at, format, stage, state, team_blue_id, team_red_id, winner_team_id, tournament_id",
      )
      .eq("external_id", slug)
      .maybeSingle();

    let matchRow = (byExt as RawMatchRow | null) ?? null;
    if (!matchRow) {
      const { data: byId } = await sb
        .from("matches")
        .select(
          "id, external_id, scheduled_at, format, stage, state, team_blue_id, team_red_id, winner_team_id, tournament_id",
        )
        .eq("id", slug)
        .maybeSingle();
      matchRow = (byId as RawMatchRow | null) ?? null;
    }

    if (!matchRow || !matchRow.id) return null;

    const matchId = matchRow.id;
    const teamIds = [matchRow.team_blue_id, matchRow.team_red_id].filter(
      Boolean,
    ) as string[];

    // 2. Fetch teams + games + tournament in parallel.
    const [teamsRes, gamesRes, tournamentRes] = await Promise.all([
      teamIds.length > 0
        ? sb
            .from("teams")
            .select("id, name, code, slug, logo_url, is_tracked")
            .in("id", teamIds)
        : Promise.resolve({ data: [] as RawTeamRow[] }),
      sb
        .from("games")
        .select(
          "id, external_id, game_number, winner_team_id, duration_seconds, patch, vod_youtube_id, vod_offset_seconds",
        )
        .eq("match_id", matchId)
        .order("game_number"),
      matchRow.tournament_id
        ? sb
            .from("tournaments")
            .select("id, name, slug, league_id, year, split")
            .eq("id", matchRow.tournament_id)
            .maybeSingle()
        : Promise.resolve({ data: null as RawTournamentRow | null }),
    ]);

    const teamRows = (teamsRes.data ?? []) as RawTeamRow[];
    const gameRows = (gamesRes.data ?? []) as RawGameRow[];
    const tournamentRow = (tournamentRes.data ?? null) as RawTournamentRow | null;

    // 3. Fetch participants for every game in one query.
    const gameIds = gameRows.map((g) => g.id).filter(Boolean) as string[];
    let participantRows: RawParticipantRow[] = [];
    if (gameIds.length > 0) {
      const { data } = await sb
        .from("game_participants")
        .select(
          "game_id, player_id, team_id, champion, role, side, kills, deaths, assists, participant_id, players(ign, image_url)",
        )
        .in("game_id", gameIds);
      participantRows = ((data ?? []) as unknown) as RawParticipantRow[];
    }

    // Index participants by game_id for the per-game roll-up.
    const partsByGame = new Map<string, RawParticipantRow[]>();
    for (const p of participantRows as Array<RawParticipantRow & { game_id?: string | null }>) {
      const gid = p.game_id ?? "";
      const arr = partsByGame.get(gid) ?? [];
      arr.push(p);
      partsByGame.set(gid, arr);
    }

    // 4. Normalise teams + figure out KC vs opponent.
    const teamById = new Map<string, MatchTeam>();
    for (const t of teamRows) {
      const norm = normalizeTeam(t);
      if (norm) teamById.set(norm.id, norm);
    }
    const blueTeam = matchRow.team_blue_id
      ? teamById.get(matchRow.team_blue_id) ?? null
      : null;
    const redTeam = matchRow.team_red_id
      ? teamById.get(matchRow.team_red_id) ?? null
      : null;
    const kcTeam = blueTeam?.isTracked
      ? blueTeam
      : redTeam?.isTracked
        ? redTeam
        : null;
    const opponentTeam = kcTeam
      ? kcTeam.id === blueTeam?.id
        ? redTeam
        : blueTeam
      : null;

    // 5. Build the rich per-game payload.
    const games: MatchGame[] = gameRows.map((g) => {
      const gid = g.id ?? "";
      const parts = partsByGame.get(gid) ?? [];
      const participants: MatchGameParticipant[] = parts.map((p) => ({
        playerId: p.player_id ?? null,
        playerIgn: p.players?.ign ?? `?${(p.champion ?? "?").slice(0, 4)}`,
        playerImageUrl: p.players?.image_url ?? null,
        teamId: p.team_id ?? null,
        champion: p.champion ?? "?",
        role: p.role ?? null,
        side: p.side ?? null,
        kills: p.kills ?? 0,
        deaths: p.deaths ?? 0,
        assists: p.assists ?? 0,
        participantId: p.participant_id ?? 0,
      }));
      // Sort by participant_id so the order matches the Riot panel
      // (blue 1-5 then red 6-10).
      participants.sort((a, b) => a.participantId - b.participantId);
      return {
        id: String(g.id ?? ""),
        externalId: String(g.external_id ?? ""),
        number: Number(g.game_number ?? 1),
        winnerTeamId: g.winner_team_id ?? null,
        durationSeconds: g.duration_seconds ?? null,
        patch: g.patch ?? null,
        participants,
        vodYoutubeId: g.vod_youtube_id ?? null,
        vodOffsetSeconds: g.vod_offset_seconds ?? null,
      };
    });

    // 6. Aggregate score.
    let kcScore = 0;
    let oppScore = 0;
    for (const g of games) {
      if (kcTeam && g.winnerTeamId === kcTeam.id) kcScore++;
      else if (opponentTeam && g.winnerTeamId === opponentTeam.id) oppScore++;
    }
    const kcWon =
      (kcTeam && matchRow.winner_team_id === kcTeam.id) || kcScore > oppScore;

    const totalDurationSeconds = games.reduce(
      (sum, g) => sum + (g.durationSeconds ?? 0),
      0,
    );

    const tournament: MatchTournament | null = tournamentRow
      ? {
          id: tournamentRow.id ?? null,
          name: String(tournamentRow.name ?? "LEC"),
          slug: tournamentRow.slug ?? null,
          leagueId: tournamentRow.league_id ?? null,
          year: tournamentRow.year ?? null,
          split: tournamentRow.split ?? null,
        }
      : null;

    return {
      id: matchId,
      externalId: String(matchRow.external_id ?? matchId),
      scheduledAt: matchRow.scheduled_at ?? null,
      stage: matchRow.stage ?? null,
      format: matchRow.format ?? "bo1",
      bestOf: parseBestOf(matchRow.format),
      state: matchRow.state ?? "completed",
      blueTeam,
      redTeam,
      winnerTeamId: matchRow.winner_team_id ?? null,
      kcTeam,
      opponentTeam,
      kcScore,
      oppScore,
      kcWon,
      totalDurationSeconds,
      tournament,
      games,
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/match] getMatchBySlug threw:", err);
    return null;
  }
});

/**
 * Get every kill of a match — proxies the existing
 * `getKillsByMatchExternalId` so the Match Replay page has a single
 * data-fetch import path. Sorted by (game_number, game_time_seconds).
 */
export const getMatchKills = cache(async function getMatchKills(
  matchExternalId: string,
): Promise<PublishedKillRow[]> {
  const kills = await getKillsByMatchExternalId(matchExternalId, {
    buildTime: true,
  });
  // The wrapper already sorts by game_time_seconds ; we additionally
  // sort by game_number so multi-game BOs read chronologically.
  return [...kills].sort((a, b) => {
    const gn = (a.games?.game_number ?? 0) - (b.games?.game_number ?? 0);
    if (gn !== 0) return gn;
    return (a.game_time_seconds ?? 0) - (b.game_time_seconds ?? 0);
  });
});

/**
 * Compute the MVP of the match : the player whose aggregate Gemini
 * highlight_score across KC-side kills is highest. Ties broken by raw
 * kill count.
 *
 * Returns null when no KC-side clipped kills exist — the caller falls
 * back to a "no MVP yet" card.
 *
 * The MVP is computed from the kills feed, not from `game_participants`
 * KDA — the goal is to surface the player who CARRIED the highlight
 * reel, not just the K/D leader. A 7/2/3 mid who hit two splash plays
 * with score 9.0 each outranks a 12/4/6 ADC whose kills all scored 4.5.
 */
export async function getMatchMVP(
  matchExternalId: string,
  payload?: MatchPayload | null,
): Promise<MatchMVP | null> {
  const kills = await getMatchKills(matchExternalId);
  if (kills.length === 0) return null;

  // Aggregate by killer_player_id when available, otherwise by
  // (killer_champion, game_number) so legacy livestats kills (which
  // lack killer_player_id) still group sensibly.
  type Bucket = {
    playerId: string | null;
    ign: string;
    photoUrl: string | null;
    aggregateScore: number;
    killCount: number;
    bestChampion: string;
    bestChampionScore: number;
  };
  const buckets = new Map<string, Bucket>();

  // Build a player_id → game_participant index from the payload so we
  // can recover IGN + photo + champion without an extra DB roundtrip.
  type ParticipantIndexEntry = {
    ign: string;
    photoUrl: string | null;
    champion: string;
  };
  const partsByPlayerId = new Map<string, ParticipantIndexEntry>();
  if (payload) {
    for (const g of payload.games) {
      for (const p of g.participants) {
        if (!p.playerId) continue;
        // Prefer the entry from the game with most kills as the
        // signature champion ; first-write-wins is good enough since
        // the killer aggregation below will refine it.
        if (!partsByPlayerId.has(p.playerId)) {
          partsByPlayerId.set(p.playerId, {
            ign: p.playerIgn,
            photoUrl: p.playerImageUrl,
            champion: p.champion,
          });
        }
      }
    }
  }

  for (const k of kills) {
    if (k.tracked_team_involvement !== "team_killer") continue;
    const score = k.highlight_score ?? 0;
    const key = k.killer_player_id ?? `champ:${k.killer_champion ?? "?"}`;
    const idx = k.killer_player_id ? partsByPlayerId.get(k.killer_player_id) : null;
    const bucket = buckets.get(key) ?? {
      playerId: k.killer_player_id ?? null,
      ign: idx?.ign ?? k.killer_champion ?? "?",
      photoUrl: idx?.photoUrl ?? null,
      aggregateScore: 0,
      killCount: 0,
      bestChampion: k.killer_champion ?? idx?.champion ?? "?",
      bestChampionScore: 0,
    };
    bucket.aggregateScore += score;
    bucket.killCount += 1;
    if (score > bucket.bestChampionScore && k.killer_champion) {
      bucket.bestChampion = k.killer_champion;
      bucket.bestChampionScore = score;
    }
    buckets.set(key, bucket);
  }

  if (buckets.size === 0) return null;
  const sorted = Array.from(buckets.values()).sort((a, b) => {
    if (b.aggregateScore !== a.aggregateScore) {
      return b.aggregateScore - a.aggregateScore;
    }
    return b.killCount - a.killCount;
  });
  const winner = sorted[0];
  return {
    playerId: winner.playerId,
    ign: winner.ign,
    signatureChampion: winner.bestChampion,
    aggregateScore: winner.aggregateScore,
    killCount: winner.killCount,
    photoUrl: winner.photoUrl,
  };
}

/**
 * Fetch surrounding context : previous KC match vs the same opponent,
 * next KC match (any opponent), and the highest-scored kill of THIS
 * match (proxied as a "watch the highlight" CTA).
 *
 * `previousVsOpponent` and `next` are returned as lightweight preview
 * rows so the page can build a 4-up "related" strip without hammering
 * Supabase for a full payload.
 */
export async function getRelatedMatches(
  match: MatchPayload,
): Promise<RelatedMatches> {
  if (!match.kcTeam || !match.scheduledAt) {
    return {
      previousVsOpponent: null,
      next: null,
      topKillId: null,
      topKillScore: null,
    };
  }
  try {
    const sb = createAnonSupabase();

    // 1. Previous vs same opponent — strictly before match.scheduled_at,
    //    same kcTeam involved AND same opponentTeam involved.
    let previousVsOpponent: MatchPreviewRow | null = null;
    if (match.opponentTeam) {
      const oppId = match.opponentTeam.id;
      const kcId = match.kcTeam.id;
      const { data: prevRows } = await sb
        .from("matches")
        .select(
          "id, external_id, scheduled_at, stage, team_blue_id, team_red_id, winner_team_id, format",
        )
        .lt("scheduled_at", match.scheduledAt)
        .or(
          `and(team_blue_id.eq.${kcId},team_red_id.eq.${oppId}),and(team_blue_id.eq.${oppId},team_red_id.eq.${kcId})`,
        )
        .order("scheduled_at", { ascending: false })
        .limit(1);
      const row = (prevRows ?? [])[0] as RawMatchRow | undefined;
      if (row) {
        previousVsOpponent = await summariseMatchRow(
          sb,
          row,
          match.kcTeam,
          match.opponentTeam,
        );
      }
    }

    // 2. Next match (any opponent) — strictly after.
    let next: MatchPreviewRow | null = null;
    const kcId = match.kcTeam.id;
    const { data: nextRows } = await sb
      .from("matches")
      .select(
        "id, external_id, scheduled_at, stage, team_blue_id, team_red_id, winner_team_id, format",
      )
      .gt("scheduled_at", match.scheduledAt)
      .or(`team_blue_id.eq.${kcId},team_red_id.eq.${kcId}`)
      .order("scheduled_at", { ascending: true })
      .limit(1);
    const nextRow = (nextRows ?? [])[0] as RawMatchRow | undefined;
    if (nextRow) {
      next = await summariseMatchRow(sb, nextRow, match.kcTeam, null);
    }

    // 3. Top kill of this match.
    const kills = await getMatchKills(match.externalId);
    const topKill = kills
      .filter(
        (k) =>
          k.tracked_team_involvement === "team_killer" &&
          (k.highlight_score ?? 0) > 0,
      )
      .sort(
        (a, b) => (b.highlight_score ?? 0) - (a.highlight_score ?? 0),
      )[0];

    return {
      previousVsOpponent,
      next,
      topKillId: topKill?.id ?? null,
      topKillScore: topKill?.highlight_score ?? null,
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/match] getRelatedMatches threw:", err);
    return {
      previousVsOpponent: null,
      next: null,
      topKillId: null,
      topKillScore: null,
    };
  }
}

async function summariseMatchRow(
  sb: ReturnType<typeof createAnonSupabase>,
  row: RawMatchRow,
  kcTeam: MatchTeam,
  fallbackOpponent: MatchTeam | null,
): Promise<MatchPreviewRow | null> {
  const kcId = kcTeam.id;
  const opponentId =
    row.team_blue_id === kcId ? row.team_red_id : row.team_blue_id;
  if (!opponentId) return null;

  let opponent: MatchTeam | null = null;
  if (fallbackOpponent && fallbackOpponent.id === opponentId) {
    opponent = fallbackOpponent;
  } else {
    const { data: opp } = await sb
      .from("teams")
      .select("id, name, code, slug, logo_url, is_tracked")
      .eq("id", opponentId)
      .maybeSingle();
    opponent = normalizeTeam(opp as RawTeamRow | null);
  }
  if (!opponent) return null;

  // Compute the score from the games in this match.
  const { data: g } = await sb
    .from("games")
    .select("winner_team_id")
    .eq("match_id", row.id ?? "");
  let kcGW = 0;
  let oppGW = 0;
  for (const win of (g ?? []) as Array<{ winner_team_id: string | null }>) {
    if (win.winner_team_id === kcId) kcGW++;
    else if (win.winner_team_id === opponentId) oppGW++;
  }
  // Final winner — null means unfinished / unknown.
  let kcWon: boolean | null = null;
  if (row.winner_team_id === kcId) kcWon = true;
  else if (row.winner_team_id && row.winner_team_id !== kcId) kcWon = false;
  else if (kcGW !== oppGW) kcWon = kcGW > oppGW;

  return {
    externalId: String(row.external_id ?? row.id ?? ""),
    scheduledAt: row.scheduled_at ?? null,
    stage: row.stage ?? null,
    opponentCode: opponent.code,
    opponentName: opponent.name,
    kcWon,
    kcScore: kcGW,
    oppScore: oppGW,
  };
}
