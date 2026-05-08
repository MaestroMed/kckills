import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadRealData, getKCRoster } from "@/lib/real-data";

/**
 * GET /api/v1/players — Public API for KC roster with stats.
 *
 * Returns the current KC roster with aggregate stats (kills, deaths,
 * assists, KDA, games played, champion pool).
 */

// No query params today, but validate strictly so unknown keys are tolerated
// without coercion surprises and the schema is in place for future filters.
const Query = z.object({}).passthrough();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parsed = Query.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid params", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = loadRealData();
  const roster = getKCRoster(data);

  const players = roster.map((p) => ({
    name: p.name,
    role: p.role,
    games_played: p.gamesPlayed,
    total_kills: p.totalKills,
    total_deaths: p.totalDeaths,
    total_assists: p.totalAssists,
    kda: p.totalDeaths > 0
      ? +((p.totalKills + p.totalAssists) / p.totalDeaths).toFixed(2)
      : null,
    champion_count: p.champions.length,
    top_champions: p.champions.slice(0, 5),
  }));

  return NextResponse.json(
    { players, count: players.length },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
