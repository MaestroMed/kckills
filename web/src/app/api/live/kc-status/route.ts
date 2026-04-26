import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/live/kc-status — is a KC match currently in progress?
 *
 * This is the DB-native truth source used by /scroll to flip into "mode live"
 * (15s polling + animated banner). Distinct from /api/live which proxies the
 * upstream LolEsports getLive API — this endpoint only queries our own
 * `matches` + `teams` + `games` tables, which reflect whatever the worker
 * has already written.
 *
 * Response shape (stable even on error):
 *   { isLive: boolean, matchId?: string, opponentCode?: string, gameNumber?: number }
 *
 * Picked `edge` runtime because this is a cheap polling endpoint — a low
 * cold-start keeps the 60s client cadence from dominating serverless
 * invocation minutes.
 *
 * Cache headers: s-maxage=30 / stale-while-revalidate=60. The status of a
 * live match rarely flips in under 30s (game start / end / between-map
 * breaks last longer than that), so a 30s edge cache is safe.
 *
 * Degradation: on ANY error (Supabase 500, env missing, malformed row) we
 * return `{ isLive: false }`. The scroll feed must never break because the
 * live probe 5xx'd.
 */

export const runtime = "edge";

interface KcStatusResponse {
  isLive: boolean;
  matchId?: string;
  opponentCode?: string;
  gameNumber?: number;
}

// Module-scoped cache for the tracked team UUID — it's set by `teams.is_tracked`
// which flips only when Mehdi decides to track a new team. Re-query when the
// module is cold-started (edge workers are short-lived anyway).
let cachedTrackedTeamId: string | null = null;
let cachedTrackedTeamCode: string | null = null;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

async function resolveTrackedTeamId(sb: ReturnType<typeof supabase>): Promise<{ id: string; code: string } | null> {
  if (cachedTrackedTeamId && cachedTrackedTeamCode) {
    return { id: cachedTrackedTeamId, code: cachedTrackedTeamCode };
  }
  const { data, error } = await sb
    .from("teams")
    .select("id, code")
    .eq("is_tracked", true)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as { id?: string; code?: string };
  if (!row.id) return null;
  cachedTrackedTeamId = String(row.id);
  cachedTrackedTeamCode = String(row.code ?? "KC");
  return { id: cachedTrackedTeamId, code: cachedTrackedTeamCode };
}

interface MatchRow {
  id: string;
  external_id: string | null;
  team_blue_id: string | null;
  team_red_id: string | null;
  team_blue?: { code?: string | null } | null;
  team_red?: { code?: string | null } | null;
  games?: Array<{ game_number?: number | null; state?: string | null }> | null;
}

export async function GET(): Promise<NextResponse<KcStatusResponse>> {
  try {
    const sb = supabase();
    const tracked = await resolveTrackedTeamId(sb);
    if (!tracked) {
      return NextResponse.json({ isLive: false }, { headers: cacheHeaders() });
    }

    // Find the most recent match where state=inProgress AND either side is KC.
    // We also pull the opposing team's `code` in one round-trip via Supabase
    // embedded selects, plus games[] to get the current game number (live
    // match = the game with the highest game_number that's not completed).
    const { data, error } = await sb
      .from("matches")
      .select(
        "id, external_id, team_blue_id, team_red_id, " +
          "team_blue:teams!matches_team_blue_id_fkey(code), " +
          "team_red:teams!matches_team_red_id_fkey(code), " +
          "games(game_number, state)",
      )
      .eq("state", "inProgress")
      .or(`team_blue_id.eq.${tracked.id},team_red_id.eq.${tracked.id}`)
      .order("scheduled_at", { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      return NextResponse.json({ isLive: false }, { headers: cacheHeaders() });
    }

    const match = data[0] as unknown as MatchRow;
    const isKcBlue = match.team_blue_id === tracked.id;
    const opponentCode = isKcBlue ? match.team_red?.code : match.team_blue?.code;

    // Current game = highest game_number whose state != 'completed'; if all
    // are completed we still report the max (between-games is still "live").
    let gameNumber: number | undefined;
    const games = match.games ?? [];
    if (games.length > 0) {
      const inProgress = games
        .filter((g) => g && typeof g.game_number === "number" && g.state !== "completed")
        .sort((a, b) => (b.game_number ?? 0) - (a.game_number ?? 0));
      const pick = inProgress[0] ?? games.sort((a, b) => (b.game_number ?? 0) - (a.game_number ?? 0))[0];
      if (pick && typeof pick.game_number === "number") {
        gameNumber = pick.game_number;
      }
    }

    const payload: KcStatusResponse = {
      isLive: true,
      matchId: match.external_id ?? match.id,
      opponentCode: opponentCode ?? undefined,
      gameNumber,
    };
    return NextResponse.json(payload, { headers: cacheHeaders() });
  } catch {
    // ANY failure → degrade gracefully. The scroll must never break.
    return NextResponse.json({ isLive: false }, { headers: cacheHeaders() });
  }
}

function cacheHeaders(): Record<string, string> {
  return {
    "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
  };
}
