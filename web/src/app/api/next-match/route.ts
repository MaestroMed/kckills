import { NextResponse } from "next/server";
import { fetchNextKcMatch } from "@/lib/next-match-server";

/**
 * GET /api/next-match — public endpoint returning the next KC match.
 *
 * Pulls from LoL Esports getSchedule API server-side (CDN-cached 5min),
 * for EVERY league KC can play in (LEC, Worlds, MSI, First Stand — see
 * lib/next-match-server). Falls back to null if the API is down.
 */

export const revalidate = 300;

export async function GET() {
  try {
    const next = await fetchNextKcMatch();
    return NextResponse.json({ next }, { headers: cacheHeaders() });
  } catch {
    return NextResponse.json({ next: null });
  }
}

function cacheHeaders(): Record<string, string> {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" };
}
