/**
 * GET /api/playlists
 *
 * PUBLIC read of the wolf-player playlists. Anonymous, edge-cacheable —
 * served to every visitor so the wolf player loads the operator's
 * curated tracks instead of the hardcoded defaults.
 *
 * Returns `{playlists: {homepage: BgmTrack[], scroll: BgmTrack[]}}`.
 *
 * The admin endpoint at /api/admin/playlists is the WRITE side ;
 * this route is the READ side that needs no auth + benefits from
 * aggressive CDN cache (15 minutes — re-curate isn't time-sensitive).
 */

import { NextResponse } from "next/server";
import { loadPlaylists } from "@/lib/audio/playlists-store";

export const runtime = "nodejs";
export const revalidate = 900; // 15 min ; l'admin revalide à chaque enregistrement

export async function GET() {
  const { playlists } = await loadPlaylists();
  return NextResponse.json(
    { playlists },
    { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" } },
  );
}
