import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";

const VALID_REASONS = ["toxic", "spam", "off_topic", "other"];

/** POST /api/comments/[id]/report — user reports a comment as inappropriate */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const reason = String(body.reason ?? "other");
  const note = body.note ? String(body.note).slice(0, 500) : null;

  if (!VALID_REASONS.includes(reason)) {
    return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
  }

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Auth required" }, { status: 401 });
  }

  // Insert report
  const { error: reportErr } = await sb.from("comment_reports").insert({
    comment_id: id,
    reporter_id: user.id,
    reason,
    note,
  });
  if (reportErr) {
    return NextResponse.json({ error: reportErr.message }, { status: 500 });
  }

  // Compteur de signalements : colonne non accordée à `authenticated` (083),
  // la mise à jour de session ne faisait rien → service role.
  const service = createServiceSupabase();
  if (service) {
    const { data: existing } = await service.from("comments").select("report_count").eq("id", id).maybeSingle();
    const newCount = (existing?.report_count ?? 0) + 1;
    await service.from("comments").update({ report_count: newCount }).eq("id", id);
  }

  return NextResponse.json({ ok: true });
}
