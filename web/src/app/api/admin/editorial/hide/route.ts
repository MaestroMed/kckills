/**
 * POST /api/admin/editorial/hide
 *
 * Toggles `kill_visible` on a single kill — the same column the
 * public scroll feed filters on. Setting it to false yanks the kill
 * from the public surface immediately (RLS-backed) without deleting
 * any of the underlying data.
 *
 * Body : { kill_id, hide: boolean }
 *   hide=true  → kill_visible := false  (audit action: kill.hide)
 *   hide=false → kill_visible := true   (audit action: kill.unhide)
 *
 * We don't auto-unpin a hidden kill from featured_clips. If the editor
 * hides a clip that was pinned, the homepage hero will show empty
 * for that window — visible signal that something is off, beats a
 * silent unpin behind their back.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";

interface HideBody {
  kill_id?: string;
  hide?: boolean;
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  let body: HideBody;
  try {
    body = (await request.json()) as HideBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { kill_id, hide } = body;
  if (!kill_id || typeof hide !== "boolean") {
    return NextResponse.json(
      { error: "kill_id and hide (boolean) required" },
      { status: 400 },
    );
  }

  const sb = await createServerSupabase();

  // Capture the previous state so we can audit it.
  const { data: before, error: beforeErr } = await sb
    .from("kills")
    .select("id,kill_visible")
    .eq("id", kill_id)
    .maybeSingle();
  if (beforeErr) return NextResponse.json({ error: beforeErr.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: "Kill not found" }, { status: 404 });

  const nextVisible = !hide;
  const { error: upErr } = await sb
    .from("kills")
    .update({ kill_visible: nextVisible, updated_at: new Date().toISOString() })
    .eq("id", kill_id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await sb.from("editorial_actions").insert({
    action: hide ? "kill.hide" : "kill.unhide",
    kill_id,
    performed_by: "admin",
    payload: { previous_kill_visible: before.kill_visible, new_kill_visible: nextVisible },
  });

  return NextResponse.json({ ok: true, kill_visible: nextVisible });
}
