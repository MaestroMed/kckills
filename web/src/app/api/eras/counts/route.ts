/**
 * GET /api/eras/counts — published-kill count per KC era.
 *
 * Wave 31a — feeds the KCTimeline kill-count badges. Loops the static
 * ERAS array and runs one `count=planned` query per era in parallel.
 * Planned counts are statistics-based estimates (cached by Postgres'
 * pg_stats) — accurate to ~1% and orders of magnitude faster than exact
 * counts for big tables.
 *
 * Response shape :
 *   { counts: { [eraId: string]: number } }
 *
 * Cache : public 5-min with stale-while-revalidate 30s. Matches the
 * cadence at which new kills land on stage during live matches and
 * is good enough for a marketing badge.
 */

import { NextResponse } from "next/server";
import { ERAS } from "@/lib/eras";
import { countKillsByEra } from "@/lib/supabase/kills";

export const revalidate = 300;

export async function GET() {
  try {
    // Fan out one count query per era. Each is a HEAD request with
    // `count=planned` so the wall-clock total is bounded by the
    // slowest one (~100-300ms each).
    const entries = await Promise.all(
      ERAS.map(async (era) => {
        const n = await countKillsByEra({
          startDate: era.dateStart,
          endDate: era.dateEnd,
        });
        return [era.id, n] as const;
      }),
    );
    const counts: Record<string, number> = {};
    for (const [id, n] of entries) {
      counts[id] = n;
    }
    return NextResponse.json(
      { counts },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=30",
        },
      },
    );
  } catch (err) {
    console.warn("[api/eras/counts] threw:", err);
    return NextResponse.json({ counts: {} }, { status: 200 });
  }
}
