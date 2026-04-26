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
import { readFile } from "fs/promises";
import path from "path";
import {
  DEFAULT_PLAYLISTS,
  type BgmTrack,
  type PlaylistId,
} from "@/lib/audio/playlists";

const STORAGE_PATH = path.join(process.cwd(), ".cache", "playlists.json");

export const runtime = "nodejs"; // need fs for the cache file
export const revalidate = 900; // 15-min ISR

export async function GET() {
  let playlists: Record<PlaylistId, BgmTrack[]> = { ...DEFAULT_PLAYLISTS };
  try {
    const raw = await readFile(STORAGE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.playlists?.homepage && parsed?.playlists?.scroll) {
      playlists = parsed.playlists;
    }
  } catch {
    // First-time load — defaults are fine
  }

  return NextResponse.json(
    { playlists },
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=900, stale-while-revalidate=3600",
      },
    },
  );
}
