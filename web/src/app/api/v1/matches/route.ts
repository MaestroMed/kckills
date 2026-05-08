import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadRealData, getMatchesSorted } from "@/lib/real-data";

/**
 * GET /api/v1/matches — Public API for KC match history.
 *
 * Query params:
 *   limit (default 20, max 100)
 *   year — filter by year (2024, 2025, 2026)
 *
 * Returns match list with opponent, result, game scores, date, stage.
 */

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parsed = Query.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid params", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { limit, year } = parsed.data;

  const data = loadRealData();
  const matches = getMatchesSorted(data, year).slice(0, limit);

  const result = matches.map((m) => ({
    id: m.id,
    date: m.date,
    league: m.league,
    stage: m.stage,
    opponent: m.opponent,
    kc_won: m.kc_won,
    kc_score: m.kc_score,
    opp_score: m.opp_score,
    best_of: m.best_of,
    games_count: m.games.length,
    total_kc_kills: m.games.reduce((a, g) => a + g.kc_kills, 0),
    total_opp_kills: m.games.reduce((a, g) => a + g.opp_kills, 0),
  }));

  return NextResponse.json(
    { matches: result, count: result.length },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
