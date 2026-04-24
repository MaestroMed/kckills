import { NextResponse } from "next/server";
import { getKillsByEra } from "@/lib/supabase/kills";
import { getEraById } from "@/lib/eras";

export const revalidate = 300; // 5 min — same cadence as the homepage RSC

/**
 * GET /api/kills/by-era?eraId=<id>&limit=<n>
 *
 * Public endpoint for the homepage KC Timeline filter. When the user
 * picks an era card, the client-side EraKillsFeed hits this route to
 * pull the era's published clips without forcing a full server re-render
 * of the heavy homepage RSC.
 *
 * Resolves `eraId` against the canonical eras table so date ranges stay
 * server-side (the client only ever sees ids — keeps the surface tight).
 *
 * Anonymous reads — RLS policy "Public kills" is the only gate.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const eraId = url.searchParams.get("eraId");
    if (!eraId) {
      return NextResponse.json({ error: "eraId required" }, { status: 400 });
    }
    const era = getEraById(eraId);
    if (!era) {
      return NextResponse.json({ error: "unknown era" }, { status: 404 });
    }
    const limitRaw = Number(url.searchParams.get("limit") ?? "30");
    // Clamp to a sane window — this endpoint is hit on every era click.
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(60, Math.floor(limitRaw)))
      : 30;

    const kills = await getKillsByEra({
      startDate: era.dateStart,
      endDate: era.dateEnd,
      limit,
    });

    return NextResponse.json(
      { era: { id: era.id, label: era.label, color: era.color }, kills },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    console.warn("[api/kills/by-era] threw:", err);
    return NextResponse.json({ kills: [] }, { status: 200 });
  }
}
