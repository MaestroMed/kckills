import { NextResponse } from "next/server";

/**
 * /api/bcc/kr-ladder — Korea SoloQ Challenger ladder proxy.
 *
 * Wave 25.3 (V59) — Stark Culture room of the Antre de la BCC features a
 * scouting lab. The lab needs REAL data (per user spec : "no fake / mocked
 * ladders"). This route proxies Riot's challenger endpoint and returns the
 * top 10 entries, cached server-side for 5 minutes to stay well inside the
 * developer-key rate limit (20 req / 1s, 100 req / 2 min).
 *
 *   GET https://kr.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5
 *   Header  X-Riot-Token: $RIOT_API_KEY
 *
 * The endpoint requires a developer key (RIOT_API_KEY env). When it's
 * missing — local dev, preview branch, CI — we return a graceful empty
 * shape with a `warning` field so the cave UI shows an "API key not
 * configured" state instead of a generic 500. The cave never crashes on
 * a missing env.
 *
 * Caching :
 *   - `revalidate = 300` (5 min, matches the user-spec refresh cadence).
 *   - `fetch(..., { next: { revalidate: 300 } })` does double-duty :
 *     Vercel ISR layer dedupes concurrent requests AND tags the response
 *     so manual `revalidatePath('/api/bcc/kr-ladder')` invalidates it.
 *   - Cache-Control header is `s-maxage=300, stale-while-revalidate=600`
 *     so an unreachable Riot edge still serves the last-known good list
 *     for another 10 min while it backfills.
 */

export const revalidate = 300;
export const runtime = "nodejs";

const RIOT_KR_CHALLENGER_URL =
  "https://kr.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5";

interface RiotLeagueEntry {
  summonerId: string;
  /** Display name on the v4 endpoint is `summonerName`. Riot returns "" for
   *  hidden accounts — frontend renders a fallback. */
  summonerName: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  hotStreak: boolean;
  veteran: boolean;
  freshBlood: boolean;
  inactive: boolean;
}

interface RiotChallengerLeague {
  tier: string;
  leagueId: string;
  queue: string;
  name: string;
  entries: RiotLeagueEntry[];
}

export interface BCCKrLadderResponse {
  /** Empty when RIOT_API_KEY is missing or the upstream fetch failed. */
  entries: {
    rank: number;
    summonerName: string;
    leaguePoints: number;
    wins: number;
    losses: number;
    winrate: number;
    hotStreak: boolean;
    veteran: boolean;
    freshBlood: boolean;
  }[];
  /** In-band warning : surfaced to the UI when the API key is missing
   *  or the upstream fetch failed. Never bubbled as a 500. */
  warning?: string;
  /** ISO-8601 timestamp of the upstream snapshot (when available). */
  fetchedAt?: string;
  /** League name for fun ("Faker's League", etc.). */
  leagueName?: string;
}

export async function GET() {
  const apiKey = process.env.RIOT_API_KEY;

  if (!apiKey) {
    return NextResponse.json<BCCKrLadderResponse>(
      {
        entries: [],
        warning:
          "RIOT_API_KEY missing — set env var to enable the live KR Challenger feed.",
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  }

  try {
    const res = await fetch(RIOT_KR_CHALLENGER_URL, {
      headers: { "X-Riot-Token": apiKey },
      // Tag for Vercel ISR — same revalidation window as the route.
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      // 401/403 = bad key, 429 = rate limit, 5xx = Riot edge wobble.
      const reason =
        res.status === 401 || res.status === 403
          ? "Riot API key rejected (check RIOT_API_KEY env)"
          : res.status === 429
            ? "Riot rate limit hit — back off and retry shortly"
            : `Riot API returned ${res.status}`;
      return NextResponse.json<BCCKrLadderResponse>(
        {
          entries: [],
          warning: reason,
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          },
        },
      );
    }

    const data = (await res.json()) as RiotChallengerLeague;
    const sorted = [...(data.entries ?? [])].sort(
      (a, b) => b.leaguePoints - a.leaguePoints,
    );

    const entries = sorted.slice(0, 10).map((e, i) => {
      const total = e.wins + e.losses;
      const winrate = total > 0 ? Math.round((e.wins / total) * 100) : 0;
      return {
        rank: i + 1,
        // Empty summonerName → fallback so the UI never renders a
        // bare anonymous row. The v4 endpoint sometimes returns "" for
        // accounts that haven't surfaced a riot-id yet.
        summonerName: e.summonerName?.trim() || `Anonyme #${e.summonerId.slice(0, 6)}`,
        leaguePoints: e.leaguePoints,
        wins: e.wins,
        losses: e.losses,
        winrate,
        hotStreak: e.hotStreak,
        veteran: e.veteran,
        freshBlood: e.freshBlood,
      };
    });

    return NextResponse.json<BCCKrLadderResponse>(
      {
        entries,
        leagueName: data.name,
        fetchedAt: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json<BCCKrLadderResponse>(
      {
        entries: [],
        warning: `Erreur réseau côté Riot : ${message}`,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  }
}
