import { NextRequest, NextResponse } from "next/server";
import { deriveActorRole, logAdminAction, requireAdmin } from "@/lib/admin/audit";
import { createServerSupabase } from "@/lib/supabase/server";

const VALID_VERDICTS = ["great", "good", "ok", "meh", "bad"];

/**
 * POST /api/admin/lab/vote — record a verdict on a lab evaluation.
 *
 * Body : { eval_id: UUID, verdict: "great"|"good"|"ok"|"meh"|"bad", note?: string }
 *
 * Auth : requireAdmin (cookie kc_admin OR Discord allowlist).
 * Audited via admin_actions.
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  let body: { eval_id?: string; verdict?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.eval_id) {
    return NextResponse.json({ error: "eval_id required" }, { status: 400 });
  }
  if (!body.verdict || !VALID_VERDICTS.includes(body.verdict)) {
    return NextResponse.json(
      { error: `verdict must be one of : ${VALID_VERDICTS.join(", ")}` },
      { status: 400 },
    );
  }

  const sb = await createServerSupabase();
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
  const { error } = await sb
    .from("lab_evaluations")
    .update({
      user_verdict: body.verdict,
      user_note: note,
      voted_at: new Date().toISOString(),
      voted_by: "admin",
    })
    .eq("id", body.eval_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAction({
    action: "lab.vote",
    entityType: "lab_evaluation",
    entityId: body.eval_id,
    after: { verdict: body.verdict, note },
    actorRole: deriveActorRole(admin),
    request: req,
  });

  return NextResponse.json({ ok: true });
}
