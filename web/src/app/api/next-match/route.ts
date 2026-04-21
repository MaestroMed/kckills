import { NextResponse } from "next/server";

/**
 * GET /api/next-match — public endpoint returning the next KC match.
 *
 * Pulls from LoL Esports getSchedule API server-side (CDN-cached 5min).
 * Falls back to null if API is down. Returns the soonest upcoming match
 * involving Karmine Corp.
 */

const API_KEY = process.env.LOL_ESPORTS_API_KEY ?? "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z";
const API = "https://esports-api.lolesports.com/persisted/gw";

interface ScheduleEvent {
  startTime: string;
  state: string;
  blockName?: string;
  match?: {
    id?: string;
    teams?: Array<{ code?: string; name?: string }>;
    strategy?: { type?: string; count?: number };
  };
  league?: { name?: string };
}

export const revalidate = 300;

export async function GET() {
  try {
    // Get the LEC schedule (default returns upcoming events)
    const r = await fetch(`${API}/getSchedule?hl=fr-FR&leagueId=98767991302996019`, {
      headers: { "x-api-key": API_KEY },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 300 },
    });
    if (!r.ok) return NextResponse.json({ next: null }, { headers: cacheHeaders() });

    const data = await r.json();
    const events: ScheduleEvent[] = data.data?.schedule?.events ?? [];
    const now = Date.now();

    // Find the next KC match
    const sorted = events
      .filter((ev) => {
        if (ev.state !== "unstarted" && ev.state !== "inProgress") return false;
        const teams = ev.match?.teams ?? [];
        return teams.some((t) => t?.code === "KC");
      })
      .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

    const next = sorted[0];
    if (!next) return NextResponse.json({ next: null }, { headers: cacheHeaders() });

    const teams = next.match?.teams ?? [];
    const opponent = teams.find((t) => t?.code !== "KC");
    const fmt = next.match?.strategy;
    const formatStr = fmt?.type === "bestOf" ? `bo${fmt.count}` : "bo1";
    const kickoff = Date.parse(next.startTime);

    return NextResponse.json({
      next: {
        kickoffISO: next.startTime,
        kickoffMs: kickoff,
        msUntil: kickoff - now,
        format: formatStr,
        opponentCode: opponent?.code ?? "?",
        opponentName: opponent?.name ?? "?",
        stage: next.blockName ?? "LEC",
        isLive: next.state === "inProgress",
      },
    }, { headers: cacheHeaders() });
  } catch {
    return NextResponse.json({ next: null });
  }
}

function cacheHeaders(): Record<string, string> {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" };
}
