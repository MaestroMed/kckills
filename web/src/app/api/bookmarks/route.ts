/**
 * /api/bookmarks — V10 (Wave 25.1).
 *
 * GET   → list authenticated user's bookmarks (most-recent first).
 * POST  → toggle a bookmark on / off for a kill.
 *
 * Both routes require auth ; anonymous visitors fall back to the
 * localStorage cache (`kc_bookmarks_v1`) that the V3 long-press menu
 * writes. No "merge" logic on first sign-in yet — TODO if it
 * becomes a pain point.
 *
 * Backed by the `kill_bookmarks` table from migration 057.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  kill_id: z.string().uuid(),
  note: z.string().max(200).optional(),
});

export async function GET() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth required" }, { status: 401 });
  }
  const { data, error } = await sb
    .from("kill_bookmarks")
    .select("kill_id, created_at, note")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth required" }, { status: 401 });
  }
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Bad payload" }, { status: 400 });
  }
  const { kill_id, note } = parsed.data;

  // Toggle : if already bookmarked, remove ; else insert.
  const { data: existing } = await sb
    .from("kill_bookmarks")
    .select("id")
    .eq("user_id", user.id)
    .eq("kill_id", kill_id)
    .maybeSingle();

  if (existing) {
    const { error } = await sb
      .from("kill_bookmarks")
      .delete()
      .eq("id", existing.id);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, bookmarked: false });
  }

  const { error } = await sb
    .from("kill_bookmarks")
    .insert({ user_id: user.id, kill_id, note });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, bookmarked: true });
}
