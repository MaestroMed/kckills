/**
 * GET /api/search/facets — Filter chip options for the search page.
 *
 * Returns the dropdowns + chip-strip facet data :
 *   - tags    : top 30 most-frequent ai_tags (with counts)
 *   - players : top 100 KC roster players by killer kill count
 *
 * Cached 1h at the edge — facets change slowly (new tags appear maybe
 * once per patch). The chip strip can tolerate a stale player count
 * by an hour without UX impact.
 *
 * Runtime : nodejs (createServerSupabase reads cookies via the SSR
 * client). The 1h s-maxage means real traffic almost always hits
 * the edge cache and never the lambda.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSearchFacets } from "@/lib/supabase/search";

export const runtime = "nodejs";
export const revalidate = 3600;

// No filters today — schema is in place so future facet params are
// validated on arrival (and so the validation pattern matches the rest
// of the public API surface).
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

  const facets = await getSearchFacets();
  return NextResponse.json(facets, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
