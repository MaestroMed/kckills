/**
 * GET /api/leagues — public catalog of pro LoL leagues (migration 043).
 *
 * Powers <LeagueNav /> (the chip strip in the navbar) and the league
 * filter inside <TeamSelector />. Same env gating as /api/teams :
 *
 *   * `NEXT_PUBLIC_LOLTOK_PUBLIC=false` (default, KC pilot mode) → only
 *     LEC is surfaced. Today's homepage is KC-LEC-only ; we don't want
 *     the chip strip suddenly showing LCK / LPL during the pilot.
 *   * `NEXT_PUBLIC_LOLTOK_PUBLIC=true` → every active league surfaces,
 *     ordered by priority (LEC=10 → LCS=20 → LCK=30 → …).
 *
 * Edge runtime ; 5 minute SWR cache.
 */

import { NextResponse } from "next/server";
import {
  getLeagues,
  filterLeaguesForPublic,
  isLoltokPublic,
} from "@/lib/leagues-loader";

export const runtime = "edge";
export const revalidate = 300;

interface WireLeague {
  slug: string;
  name: string;
  short_name: string;
  region: string;
  priority: number;
}

export async function GET() {
  const all = await getLeagues();
  const visible = filterLeaguesForPublic(all);

  const payload: WireLeague[] = visible.map((l) => ({
    slug: l.slug,
    name: l.name,
    short_name: l.short_name,
    region: l.region,
    priority: l.priority,
  }));

  return NextResponse.json(
    { leagues: payload, count: payload.length, mode: isLoltokPublic() ? "loltok" : "kc_pilot" },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
