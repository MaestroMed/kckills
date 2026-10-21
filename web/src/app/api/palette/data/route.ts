import { NextResponse } from "next/server";
import { getRealData } from "@/lib/real-data-server";
import { buildPaletteDataEntries } from "@/lib/palette-data";

/**
 * GET /api/palette/data — joueurs, champions et 40 dernières séries pour
 * la palette ⌘K, depuis le kc_matches.json publié sur R2 par le worker.
 * Même fraîcheur que getRealData (30 min).
 */
export const revalidate = 1800;

export async function GET() {
  const data = await getRealData();
  return NextResponse.json(buildPaletteDataEntries(data.matches), {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=1800, stale-while-revalidate=600" },
  });
}
