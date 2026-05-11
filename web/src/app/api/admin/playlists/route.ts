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
import { readFile } from "fs/promises";
import path from "path";
import { requireAdmin } from "@/lib/admin/audit";
import {
  DEFAULT_PLAYLISTS,
  type BgmTrack,
  type PlaylistId,
} from "@/lib/audio/playlists";
import { savePlaylists } from "@/app/admin/playlists/actions";

const STORAGE_PATH = path.join(process.cwd(), ".cache", "playlists.json");

interface StoredShape {
  playlists: Record<PlaylistId, BgmTrack[]>;
  updatedAt: string;
}

function isValidTrack(t: unknown): t is BgmTrack {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.artist === "string" &&
    typeof o.youtubeId === "string" &&
    /^[A-Za-z0-9_-]{11}$/.test(o.youtubeId) &&
    typeof o.durationSeconds === "number" &&
    o.durationSeconds > 0 &&
    typeof o.genre === "string"
  );
}

/** Validates the operator-editable subset (homepage + scroll). `bcc` is
 *  patched in by savePlaylists() before disk write so it can't be edited
 *  from this endpoint. */
function isValidPlaylists(
  obj: unknown,
): obj is Record<PlaylistId, BgmTrack[]> {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  for (const id of ["homepage", "scroll"] as PlaylistId[]) {
    if (!Array.isArray(o[id])) return false;
    if (!o[id].every(isValidTrack)) return false;
    if (o[id].length > 100) return false; // sanity cap
  }
  return true;
}

async function loadStored(): Promise<StoredShape> {
  try {
    const raw = await readFile(STORAGE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.playlists && isValidPlaylists(parsed.playlists)) {
      return parsed as StoredShape;
    }
  } catch {
    // File missing or malformed — return defaults
  }
  return {
    playlists: { ...DEFAULT_PLAYLISTS },
    updatedAt: new Date(0).toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }
  const stored = await loadStored();
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
