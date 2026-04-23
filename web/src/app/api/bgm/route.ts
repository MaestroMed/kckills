import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { requireAdmin } from "@/lib/admin/audit";

const PLAYLIST_PATH = path.join(process.cwd(), "src/lib/scroll/bgm-playlist.json");

/** GET /api/bgm — return current playlist (public, read-only). */
export async function GET() {
  try {
    const raw = await readFile(PLAYLIST_PATH, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    // File doesn't exist yet — return default
    const { DEFAULT_PLAYLIST } = await import("@/lib/scroll/bgm-playlist");
    return NextResponse.json(DEFAULT_PLAYLIST);
  }
}

/** POST /api/bgm — save playlist (admin only).
 *  SECURITY (PR-SECURITY-A) : was missing requireAdmin AND middleware
 *  matcher. Now : (a) middleware.ts matches /api/bgm explicitly,
 *  (b) handler-level requireAdmin() is the security boundary.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }
  const body = await request.json();
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: "Expected array of tracks" }, { status: 400 });
  }
  await writeFile(PLAYLIST_PATH, JSON.stringify(body, null, 2), "utf-8");
  return NextResponse.json({ ok: true, count: body.length });
}
