/**
 * /api/achievements — read-only data feed for the achievements UI.
 *
 * GET ?session=<hash>
 *   Returns the catalogue with earned state + the global recent-unlock
 *   feed + the "Mon score" summary for the caller. Both authenticated
 *   users (cookie-based) and anon sessions (session_hash query param)
 *   resolve cleanly — the underlying RPC accepts both.
 *
 * The page server-component already returns an initial shell ; this
 * endpoint exists so the client component can refresh the data once it
 * has access to the localStorage BCC session hash that the server
 * couldn't see at SSR time.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  getRecentUnlocks,
  getUserAchievements,
  getUserPointsSummary,
} from "@/lib/supabase/achievements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sessionRaw = url.searchParams.get("session");
  const sessionHash =
    sessionRaw && sessionRaw.length >= 16 ? sessionRaw : null;

  try {
    const [rows, recent, summary] = await Promise.all([
      getUserAchievements(sessionHash),
      getRecentUnlocks(10),
      getUserPointsSummary(sessionHash),
    ]);
    return NextResponse.json({ ok: true, rows, recent, summary });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
