/**
 * /face-off — data layer.
 *
 * One file per concern :
 *   - getPlayerFaceOffStats(slug)    : aggregated tracked-team kill/death
 *     stats for a single player (current roster OR alumni), computed from
 *     the `kills` table by joining `players.ign`.
 *   - getTopKillsByPlayer(slug)      : top N published clips by
 *     highlight_score where this player is the killer.
 *   - getMostKilledOpponent(slug)    : the opponent killed most often
 *     BY this player (victim-side count).
 *   - getMostVictimizedBy(slug)      : the opponent who killed THIS
 *     player most often (victim flip).
 *   - getFaceOffTally(a, b)          : current community vote tally,
 *     normalised to the caller's a/b ordering.
 *   - recordFaceOffVote(...)         : casts a vote via RPC.
 *   - getTopFaceOffDuels()           : top N most-engaged duels.
 *
 * Every helper degrades to a "neutral" return value on failure (empty
 * arrays, zeroed stats) — /face-off must never 500.
 *
 * The kills queries DO NOT use `tracked_team_involvement` because that
 * field is KC-side only — and the comparison must work for alumni who
 * killed KC players too (e.g. Hans Sama on Vitality vs Caliste). We
 * always match the kill via `players.ign` exact match.
 */

import "server-only";
import { cache } from "react";

import { createAnonSupabase, rethrowIfDynamic } from "./server";
import {
  championSplashUrl,
} from "@/lib/constants";

// ════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════

export interface FaceOffPlayerStats {
  slug: string;                    // input slug, lower-cased
  ign: string;                     // canonical ign from DB (or fallback to slug)
  role: string | null;             // top/jungle/mid/bottom/support
  imageUrl: string | null;
  /** Total kills where this player is the killer. */
  totalKills: number;
  /** Total deaths where this player is the victim. */
  totalDeaths: number;
  /** Multi-kills (triple/quadra/penta) counted on the kill side. */
  multiKillCount: number;
  /** First-blood kills landed by this player. */
  firstBloods: number;
  /** Avg highlight_score on this player's kill clips (Gemini IA). */
  avgHighlightScore: number;       // 0-10, null in DB → 0
  /** Avg community avg_rating across this player's kill clips. */
  avgCommunityRating: number;      // 0-5
  /** Single best clip score. */
  bestClipScore: number;
  /** Distinct champions used as killer. */
  championsCount: number;
  /** Total clip count we have published for this player. */
  publishedClipCount: number;
}

/** Per-row shape returned to the UI for the side-by-side top-10 grid. */
export interface FaceOffTopKill {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  victim_name: string | null;
  thumbnail_url: string | null;
  clip_url_vertical: string | null;
  highlight_score: number | null;
  avg_rating: number | null;
  rating_count: number;
  multi_kill: string | null;
  is_first_blood: boolean;
  ai_description: string | null;
  created_at: string;
  match_stage: string | null;
}

export interface MostKilledOpponent {
  victim_ign: string;
  victim_champion: string | null;   // most-used champion when killed
  count: number;
}

export interface FaceOffTally {
  votes_a: number;
  votes_b: number;
  votes_draw: number;
}

export interface FaceOffVoteResult extends FaceOffTally {
  inserted: boolean;
}

export interface TopFaceOffDuel {
  player_a_slug: string;
  player_b_slug: string;
  votes_a: number;
  votes_b: number;
  votes_draw: number;
  total_votes: number;
}

// ════════════════════════════════════════════════════════════════════
// Raw row shapes (defined here, NOT inferred from supabase-js generics)
// ════════════════════════════════════════════════════════════════════
//
// supabase-js infers the column type from the SELECT string literal at
// compile-time. When the string contains FK joins with custom aliases
// (`victim:players!fk(...)`) the inference falls back to
// `GenericStringError`. The kill helpers in `kills.ts` work around this
// by casting `data as unknown as RawXxxSelect` ; we do the same here.

interface RawKillAggRow {
  id?: string | null;
  killer_champion?: string | null;
  multi_kill?: string | null;
  is_first_blood?: boolean | null;
  highlight_score?: number | null;
  avg_rating?: number | null;
  clip_url_vertical?: string | null;
  status?: string | null;
}

interface RawJoinedPlayer {
  ign?: string | null;
}

interface RawJoinedMatch {
  stage?: string | null;
}

interface RawJoinedGame {
  matches?: RawJoinedMatch | RawJoinedMatch[] | null;
}

interface RawTopKillRow {
  id?: string | null;
  killer_champion?: string | null;
  victim_champion?: string | null;
  victim_player_id?: string | null;
  thumbnail_url?: string | null;
  clip_url_vertical?: string | null;
  highlight_score?: number | null;
  avg_rating?: number | null;
  rating_count?: number | null;
  multi_kill?: string | null;
  is_first_blood?: boolean | null;
  ai_description?: string | null;
  created_at?: string | null;
  status?: string | null;
  kill_visible?: boolean | null;
  games?: RawJoinedGame | RawJoinedGame[] | null;
  victim?: RawJoinedPlayer | RawJoinedPlayer[] | null;
}

interface RawOpponentRow {
  victim_champion?: string | null;
  killer_champion?: string | null;
  victim?: RawJoinedPlayer | RawJoinedPlayer[] | null;
  killer?: RawJoinedPlayer | RawJoinedPlayer[] | null;
}

// ════════════════════════════════════════════════════════════════════
// Helpers — internal
// ════════════════════════════════════════════════════════════════════

/** Look up the players row by ign (case-insensitive). Returns the full
 *  row so we can grab id/role/image in one round-trip. */
async function findPlayerRow(slug: string): Promise<{
  id: string;
  ign: string;
  role: string | null;
  image_url: string | null;
} | null> {
  if (!slug || slug.trim().length === 0) return null;
  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb
      .from("players")
      .select("id, ign, role, image_url")
      .ilike("ign", slug.trim())
      .limit(1);
    if (error) {
      console.warn("[face-off] findPlayerRow error:", error.message);
      return null;
    }
    const row = (data ?? [])[0];
    if (!row) return null;
    return {
      id: String(row.id ?? ""),
      ign: String(row.ign ?? slug),
      role: row.role ?? null,
      image_url: row.image_url ?? null,
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[face-off] findPlayerRow threw:", err);
    return null;
  }
}

/** Empty stats payload for the "no DB row found" case. */
function emptyStats(slug: string): FaceOffPlayerStats {
  return {
    slug: slug.toLowerCase(),
    ign: slug,
    role: null,
    imageUrl: null,
    totalKills: 0,
    totalDeaths: 0,
    multiKillCount: 0,
    firstBloods: 0,
    avgHighlightScore: 0,
    avgCommunityRating: 0,
    bestClipScore: 0,
    championsCount: 0,
    publishedClipCount: 0,
  };
}

// ════════════════════════════════════════════════════════════════════
// getPlayerFaceOffStats
// ════════════════════════════════════════════════════════════════════

/**
 * Aggregate tracked-team stats for a single player. We do ONE round-trip
 * for each side (kill side + death side) and bucket client-side — this
 * is cheaper than 6 separate aggregate queries and keeps the egress
 * budget under control.
 *
 * Cached per-request so the page can call it for both sides without
 * hitting Supabase 4 times.
 */
export const getPlayerFaceOffStats = cache(async function getPlayerFaceOffStats(
  slug: string,
): Promise<FaceOffPlayerStats> {
  const player = await findPlayerRow(slug);
  if (!player) return emptyStats(slug);

  const stats: FaceOffPlayerStats = {
    slug: slug.toLowerCase(),
    ign: player.ign,
    role: player.role,
    imageUrl: player.image_url,
    totalKills: 0,
    totalDeaths: 0,
    multiKillCount: 0,
    firstBloods: 0,
    avgHighlightScore: 0,
    avgCommunityRating: 0,
    bestClipScore: 0,
    championsCount: 0,
    publishedClipCount: 0,
  };

  try {
    const sb = createAnonSupabase();

    // ─── Kill side ────────────────────────────────────────────────
    // Pull at most 2000 kill rows — that's >5 years of KC play for a
    // single player, well above any realistic dataset. We need the
    // rows (not just count()) so we can compute avg highlight_score,
    // distinct champions, and best clip without 4 separate queries.
    const { data: killRows, error: killErr } = await sb
      .from("kills")
      .select(
        "id, killer_champion, multi_kill, is_first_blood, highlight_score, " +
          "avg_rating, clip_url_vertical, status",
      )
      .eq("killer_player_id", player.id)
      .limit(2000);
    if (killErr) {
      console.warn("[face-off] kill aggregate error:", killErr.message);
    } else {
      const rows = (killRows ?? []) as unknown as RawKillAggRow[];
      const champs = new Set<string>();
      let scoreSum = 0;
      let scoreN = 0;
      let ratingSum = 0;
      let ratingN = 0;
      let best = 0;
      let multi = 0;
      let fb = 0;
      let publishedClip = 0;
      for (const k of rows) {
        stats.totalKills += 1;
        if (k.killer_champion) champs.add(String(k.killer_champion));
        if (k.multi_kill && ["triple", "quadra", "penta"].includes(String(k.multi_kill))) {
          multi += 1;
        }
        if (k.is_first_blood) fb += 1;
        const score = typeof k.highlight_score === "number" ? k.highlight_score : null;
        if (score !== null) {
          scoreSum += score;
          scoreN += 1;
          if (score > best) best = score;
        }
        const rating = typeof k.avg_rating === "number" ? k.avg_rating : null;
        if (rating !== null && rating > 0) {
          ratingSum += rating;
          ratingN += 1;
        }
        if (k.status === "published" && k.clip_url_vertical) {
          publishedClip += 1;
        }
      }
      stats.championsCount = champs.size;
      stats.avgHighlightScore = scoreN > 0 ? scoreSum / scoreN : 0;
      stats.avgCommunityRating = ratingN > 0 ? ratingSum / ratingN : 0;
      stats.bestClipScore = best;
      stats.multiKillCount = multi;
      stats.firstBloods = fb;
      stats.publishedClipCount = publishedClip;
    }

    // ─── Death side ───────────────────────────────────────────────
    // Just need the count. HEAD-only query keeps egress at ~150 bytes.
    const { count: deathCount, error: deathErr } = await sb
      .from("kills")
      .select("id", { count: "exact", head: true })
      .eq("victim_player_id", player.id);
    if (deathErr) {
      console.warn("[face-off] death count error:", deathErr.message);
    } else {
      stats.totalDeaths = deathCount ?? 0;
    }
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[face-off] getPlayerFaceOffStats threw:", err);
  }

  return stats;
});

// ════════════════════════════════════════════════════════════════════
// getTopKillsByPlayer — top N kill clips ordered by highlight_score
// ════════════════════════════════════════════════════════════════════

export const getTopKillsByPlayer = cache(async function getTopKillsByPlayer(
  slug: string,
  limit = 10,
): Promise<FaceOffTopKill[]> {
  const player = await findPlayerRow(slug);
  if (!player) return [];

  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb
      .from("kills")
      .select(
        "id, killer_champion, victim_champion, victim_player_id, thumbnail_url, " +
          "clip_url_vertical, highlight_score, avg_rating, rating_count, " +
          "multi_kill, is_first_blood, ai_description, created_at, status, " +
          "kill_visible, games!inner(matches!inner(stage)), " +
          "victim:players!kills_victim_player_id_fkey(ign)",
      )
      .eq("killer_player_id", player.id)
      .eq("status", "published")
      .eq("kill_visible", true)
      .not("clip_url_vertical", "is", null)
      .not("thumbnail_url", "is", null)
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .order("avg_rating", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.warn("[face-off] getTopKillsByPlayer error:", error.message);
      return [];
    }

    const rows = (data ?? []) as unknown as RawTopKillRow[];
    return rows.map((row) => {
      // games/matches come back as object|array depending on supabase-js.
      const games = Array.isArray(row.games) ? row.games[0] : row.games;
      const matches = games
        ? Array.isArray(games.matches)
          ? games.matches[0]
          : games.matches
        : null;
      const victim = Array.isArray(row.victim) ? row.victim[0] : row.victim;
      return {
        id: String(row.id ?? ""),
        killer_champion: row.killer_champion ?? null,
        victim_champion: row.victim_champion ?? null,
        victim_name: victim?.ign ?? null,
        thumbnail_url: row.thumbnail_url ?? null,
        clip_url_vertical: row.clip_url_vertical ?? null,
        highlight_score:
          typeof row.highlight_score === "number" ? row.highlight_score : null,
        avg_rating: typeof row.avg_rating === "number" ? row.avg_rating : null,
        rating_count: Number(row.rating_count ?? 0),
        multi_kill: row.multi_kill ?? null,
        is_first_blood: Boolean(row.is_first_blood),
        ai_description: row.ai_description ?? null,
        created_at: String(row.created_at ?? ""),
        match_stage: matches?.stage ?? null,
      };
    });
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[face-off] getTopKillsByPlayer threw:", err);
    return [];
  }
});

// ════════════════════════════════════════════════════════════════════
// getMostKilledOpponent / getMostVictimizedBy
// ════════════════════════════════════════════════════════════════════

/** Who did this player kill the most ? Returns the top victim by count. */
export const getMostKilledOpponent = cache(async function getMostKilledOpponent(
  slug: string,
): Promise<MostKilledOpponent | null> {
  const player = await findPlayerRow(slug);
  if (!player) return null;
  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb
      .from("kills")
      .select(
        "victim_champion, victim:players!kills_victim_player_id_fkey(ign)",
      )
      .eq("killer_player_id", player.id)
      .not("victim_player_id", "is", null)
      .limit(2000);
    if (error) {
      console.warn("[face-off] getMostKilledOpponent error:", error.message);
      return null;
    }
    const rows = (data ?? []) as unknown as RawOpponentRow[];
    const tally = new Map<string, { count: number; champion: string | null }>();
    for (const row of rows) {
      const victim = Array.isArray(row.victim) ? row.victim[0] : row.victim;
      const ign = victim?.ign ? String(victim.ign) : null;
      if (!ign) continue;
      const cur = tally.get(ign) ?? { count: 0, champion: null };
      cur.count += 1;
      if (!cur.champion && row.victim_champion) {
        cur.champion = String(row.victim_champion);
      }
      tally.set(ign, cur);
    }
    let best: MostKilledOpponent | null = null;
    for (const [ign, v] of tally.entries()) {
      if (!best || v.count > best.count) {
        best = {
          victim_ign: ign,
          victim_champion: v.champion,
          count: v.count,
        };
      }
    }
    return best;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[face-off] getMostKilledOpponent threw:", err);
    return null;
  }
});

/** Who killed this player the most ? Flip of getMostKilledOpponent. */
export const getMostVictimizedBy = cache(async function getMostVictimizedBy(
  slug: string,
): Promise<MostKilledOpponent | null> {
  const player = await findPlayerRow(slug);
  if (!player) return null;
  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb
      .from("kills")
      .select(
        "killer_champion, killer:players!kills_killer_player_id_fkey(ign)",
      )
      .eq("victim_player_id", player.id)
      .not("killer_player_id", "is", null)
      .limit(2000);
    if (error) {
      console.warn("[face-off] getMostVictimizedBy error:", error.message);
      return null;
    }
    const rows = (data ?? []) as unknown as RawOpponentRow[];
    const tally = new Map<string, { count: number; champion: string | null }>();
    for (const row of rows) {
      const killer = Array.isArray(row.killer) ? row.killer[0] : row.killer;
      const ign = killer?.ign ? String(killer.ign) : null;
      if (!ign) continue;
      const cur = tally.get(ign) ?? { count: 0, champion: null };
      cur.count += 1;
      if (!cur.champion && row.killer_champion) {
        cur.champion = String(row.killer_champion);
      }
      tally.set(ign, cur);
    }
    let best: MostKilledOpponent | null = null;
    for (const [ign, v] of tally.entries()) {
      if (!best || v.count > best.count) {
        best = {
          victim_ign: ign,
          victim_champion: v.champion,
          count: v.count,
        };
      }
    }
    return best;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[face-off] getMostVictimizedBy threw:", err);
    return null;
  }
});

// ════════════════════════════════════════════════════════════════════
// getFaceOffTally / recordFaceOffVote (browser-callable + server-callable)
// ════════════════════════════════════════════════════════════════════

/** Server-side tally read — used by the SSR shell so the page has the
 *  current vote count before any client interaction. */
export const getFaceOffTally = cache(async function getFaceOffTally(
  aSlug: string,
  bSlug: string,
): Promise<FaceOffTally> {
  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb.rpc("fn_get_face_off_tally", {
      p_a_slug: aSlug,
      p_b_slug: bSlug,
    });
    if (error) {
      console.warn("[face-off] getFaceOffTally rpc error:", error.message);
      return { votes_a: 0, votes_b: 0, votes_draw: 0 };
    }
    const rows = Array.isArray(data) ? data : [];
    const row = rows[0] as Partial<FaceOffTally> | undefined;
    return {
      votes_a: Number(row?.votes_a ?? 0),
      votes_b: Number(row?.votes_b ?? 0),
      votes_draw: Number(row?.votes_draw ?? 0),
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[face-off] getFaceOffTally threw:", err);
    return { votes_a: 0, votes_b: 0, votes_draw: 0 };
  }
});

/** Top duels by total vote count — populates the footer. */
export const getTopFaceOffDuels = cache(async function getTopFaceOffDuels(
  limit = 5,
): Promise<TopFaceOffDuel[]> {
  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb.rpc("fn_top_face_off_duels", {
      p_limit: limit,
    });
    if (error) {
      console.warn("[face-off] getTopFaceOffDuels rpc error:", error.message);
      return [];
    }
    return (data ?? []) as TopFaceOffDuel[];
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[face-off] getTopFaceOffDuels threw:", err);
    return [];
  }
});

// ════════════════════════════════════════════════════════════════════
// Champion fallback portrait — used when PLAYER_PHOTOS misses a slug
// ════════════════════════════════════════════════════════════════════

/** Best-effort portrait image : real photo when available, else the
 *  signature champion's splash art. Resolved server-side so the client
 *  bundle doesn't grow with the alumni lookup logic. */
export function portraitForSlug(opts: {
  photoUrl: string | null;
  signatureChampion: string | null;
}): string {
  if (opts.photoUrl) return opts.photoUrl;
  if (opts.signatureChampion) return championSplashUrl(opts.signatureChampion);
  return championSplashUrl("Jhin");
}
