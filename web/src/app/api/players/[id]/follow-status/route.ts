/**
 * GET /api/players/[id]/follow-status — V31 (Wave 25.1).
 *
 * Returns `{ ok: true, followed: bool }` for the authenticated user
 * vs the requested player. 401 for anonymous.
 *
 * Used by the PlayerDrawer to hydrate the Follow / Suivi button on
 * open. Cheap : single-row check on `player_follows`.
 */

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth required" }, { status: 401 });
  }
  const { data } = await sb
    .from("player_follows")
    .select("id")
    .eq("user_id", user.id)
    .eq("player_id", id)
    .maybeSingle();
  return NextResponse.json({ ok: true, followed: !!data });
}
