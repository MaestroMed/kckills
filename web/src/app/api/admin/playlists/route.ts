/**
 * GET / POST /api/admin/playlists
 *
 * Stores both wolf-player playlists (homepage / scroll) in a single
 * JSON file at the project root (`web/.cache/playlists.json`). This
 * mirrors the legacy /api/bgm pattern (single playlist) but extends
 * to multiple playlists keyed by ID.
 *
 * GET — returns `{playlists: {homepage: BgmTrack[], scroll: BgmTrack[]}}`.
 *       Falls back to DEFAULT_PLAYLISTS if the file doesn't exist yet.
 * POST — replaces the whole playlists object. Body :
 *        `{playlists: {homepage: BgmTrack[], scroll: BgmTrack[]}}`.
 *        Logged to admin_actions for audit.
 *
 * Future upgrade : move to Supabase `bgm_playlists` table for
 * multi-operator concurrent edits + RLS. The local-file approach is
 * fine for the KC pilot (single operator).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/audit";
import type { BgmTrack, PlaylistId } from "@/lib/audio/playlists";
import { loadPlaylists } from "@/lib/audio/playlists-store";
import { savePlaylists } from "@/app/admin/playlists/actions";

export async function GET(_request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }
  const stored = await loadPlaylists();
  return NextResponse.json(stored, {
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}

/** POST /api/admin/playlists — Wave 18 thin proxy onto the server
 *  action. Internal admin editor calls savePlaylists() directly without
 *  this HTTP hop ; we keep the route for any external integration. */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const playlistsRaw = (body as { playlists?: unknown }).playlists;
  const result = await savePlaylists(playlistsRaw as Record<PlaylistId, BgmTrack[]>);
  if (!result.ok) {
    const status = result.error?.includes("Forbidden") ? 403 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, updatedAt: result.updatedAt });
}
