/**
 * GET /api/hero-videos — public read endpoint for the homepage hero rotation.
 *
 * Returns the operator-curated hero videos sorted by `order`. The home page
 * RSC calls this server-side via the local helper (no fetch round-trip),
 * but we expose it as a route handler too for client-side previews and
 * any future consumer (e.g. the /scroll page might surface its own hero).
 *
 * Cache : 15 min CDN + 1 h stale-while-revalidate. Hero videos change
 * infrequently (when Mehdi pushes a new montage) — the long TTL minimises
 * Vercel function invocations and Supabase egress.
 *
 * Returns `{videos: []}` (not 404) when no operator has uploaded anything,
 * so the home page always gets a valid array to merge with the YouTube
 * fallback.
 */

import { NextResponse } from "next/server";
import { loadHeroVideos } from "@/lib/hero-videos/storage";

export const runtime = "nodejs"; // fs/promises requires node, not edge
export const revalidate = 900; // 15 min

export async function GET() {
  const videos = await loadHeroVideos();
  return NextResponse.json(
    { videos },
    {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
      },
    },
  );
}
