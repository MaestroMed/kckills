/**
 * POST /api/admin/editorial/feature
 *
 * Pins a kill to the homepage hero for an arbitrary time window.
 * Differs from the day-based PUT /api/admin/featured/[date] in two
 * dimensions :
 *
 *   1. Range-based — uses valid_from / valid_to instead of a single
 *      feature_date column. Lets the editor pin a clip for a weekend,
 *      an event, or even a couple of hours.
 *   2. Editorial provenance — set_by tracks WHO pinned it
 *      ("admin", "kill_of_the_week", a Discord ID, etc.) and a
 *      custom_note carries an optional editorial blurb.
 *
 * Body : { kill_id, valid_from, valid_to, custom_note? }
 *
 * SECURITY : requireAdmin() at the top, identical to the rest of the
 * /api/admin/* routes (PR-SECURITY-A).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";

interface PinBody {
  kill_id?: string;
  valid_from?: string;
  valid_to?: string;
  custom_note?: string | null;
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  let body: PinBody;
  try {
    body = (await request.json()) as PinBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { kill_id, valid_from, valid_to } = body;
  const custom_note =
    typeof body.custom_note === "string" && body.custom_note.trim()
      ? body.custom_note.slice(0, 200)
      : null;

  if (!kill_id || !valid_from || !valid_to) {
    return NextResponse.json(
      { error: "kill_id, valid_from, valid_to are required" },
      { status: 400 },
    );
  }

  // Sanity-check the range — refuse zero-length or inverted windows so
  // the editor can't accidentally hide a clip from the public scroll
  // by pinning it for a microsecond.
  const fromMs = Date.parse(valid_from);
  const toMs = Date.parse(valid_to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return NextResponse.json({ error: "Invalid timestamp(s)" }, { status: 400 });
  }
  if (toMs <= fromMs) {
    return NextResponse.json({ error: "valid_to must be after valid_from" }, { status: 400 });
  }
  if (toMs - fromMs > 30 * 24 * 3600 * 1000) {
    return NextResponse.json(
      { error: "Window too long (max 30 days — use a longer-lived editorial decision)" },
      { status: 400 },
    );
  }

  const sb = await createServerSupabase();

  // Make sure the kill actually exists & is published — refusing to
  // pin a draft saves the editor from a broken homepage hero.
  const { data: kill, error: killErr } = await sb
    .from("kills")
    .select("id,status,kill_visible")
    .eq("id", kill_id)
    .maybeSingle();
  if (killErr) return NextResponse.json({ error: killErr.message }, { status: 500 });
  if (!kill) return NextResponse.json({ error: "Kill not found" }, { status: 404 });
  if (kill.status !== "published") {
    return NextResponse.json({ error: `Cannot pin kill in status="${kill.status}"` }, { status: 400 });
  }

  // Use the date portion of valid_from as feature_date for the legacy
  // unique constraint. The range columns are the source of truth ;
  // feature_date is just there to keep the existing /featured calendar
  // working without a schema split.
  const featureDate = new Date(fromMs).toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const { error: upErr } = await sb
    .from("featured_clips")
    .upsert(
      {
        feature_date: featureDate,
        kill_id,
        valid_from,
        valid_to,
        custom_note,
        set_by: "admin",
        set_by_actor: "admin",
        set_at: nowIso,
      },
      { onConflict: "feature_date" },
    );
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Editorial-specific audit (separate from admin_actions).
  await sb.from("editorial_actions").insert({
    action: "feature.pin",
    kill_id,
    performed_by: "admin",
    payload: { valid_from, valid_to, custom_note, feature_date: featureDate },
  });

  return NextResponse.json({ ok: true, feature_date: featureDate });
}
