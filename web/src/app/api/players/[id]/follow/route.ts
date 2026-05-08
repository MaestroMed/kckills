/**
 * /api/players/[id]/follow — V34 (Wave 25.1).
 *
 * POST   → follow the player (idempotent — already-following = ok).
 * DELETE → unfollow.
 *
 * Authenticated only. The `notify_push` flag defaults to TRUE so a
 * follow auto-subscribes the user to player-scoped pushes (V35).
 *
 * Backed by `player_follows` table + `v_player_fans_count` view from
 * migration 057.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid player id" }, { status: 400 });
  }
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth required" }, { status: 401 });
  }

  const { error } = await sb
    .from("player_follows")
    .upsert(
      { user_id: user.id, player_id: id, notify_push: true },
      { onConflict: "user_id,player_id" },
    );
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, followed: true });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid player id" }, { status: 400 });
  }
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth required" }, { status: 401 });
  }
  const { error } = await sb
    .from("player_follows")
    .delete()
    .eq("user_id", user.id)
    .eq("player_id", id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, followed: false });
}
