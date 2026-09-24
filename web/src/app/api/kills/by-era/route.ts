import { NextResponse } from "next/server";
import { z } from "zod";
import { getKillsByEra } from "@/lib/supabase/kills";
import { getEraById } from "@/lib/eras";

// La réponse dépend de la query string (eraId, limit) : pas de rendu
// statique possible. `revalidate` faisait tenter un prerender au build
// (« Dynamic server usage » à chaque build) sans jamais rien mettre en
// cache. Le cache réel est celui du CDN, par URL complète, via
// Cache-Control (s-maxage=300) plus bas.
export const dynamic = "force-dynamic";

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

const Query = z.object({
  eraId: z.string().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(60).default(30),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      // Preserve the original behaviour : missing eraId returned 400 with
      // `{ error: 'eraId required' }`. Zod failure also lands here.
      return NextResponse.json(
        { error: "Invalid params", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { eraId, limit } = parsed.data;

    const era = getEraById(eraId);
    if (!era) {
      return NextResponse.json({ error: "unknown era" }, { status: 404 });
    }

    const kills = await getKillsByEra({
      startDate: era.dateStart,
      endDate: era.dateEnd,
      limit,
    });

    return NextResponse.json(
      { era: { id: era.id, label: era.label, color: era.color }, kills },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (err) {
    console.warn("[api/kills/by-era] threw:", err);
    return NextResponse.json({ kills: [] }, { status: 200 });
  }
}
