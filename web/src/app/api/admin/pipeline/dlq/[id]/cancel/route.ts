/**
 * POST /api/admin/pipeline/dlq/[id]/cancel
 *
 * Mark a dead-letter-job as `resolution_status='cancelled'` — admin
 * has reviewed it and decided NOT to retry. The original failure
 * stays in the DB for audit ; the row just stops appearing in the
 * pending triage view.
 *
 * Audit row inserted into admin_actions for traceability.
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { deriveActorRole, logAdminAction, requireAdmin } from "@/lib/admin/audit";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  const sb = await createServerSupabase();

  // Read first so we can audit what was cancelled and reject double-cancels.
  const { data: dlq, error: fetchErr } = await sb
    .from("dead_letter_jobs")
    .select("id, type, entity_id, resolution_status")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!dlq) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (dlq.resolution_status !== "pending") {
    return NextResponse.json(
      { error: `already resolved as '${dlq.resolution_status}'` },
      { status: 409 }
    );
  }

  const { error: updateErr } = await sb
    .from("dead_letter_jobs")
    .update({
      resolution_status: "cancelled",
      resolved_by: "admin",
      resolved_at: new Date().toISOString(),
      resolution_note: "cancelled from /admin/pipeline/dlq",
    })
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logAdminAction({
    action: "dlq.cancel",
    entityType: "dead_letter_job",
    entityId: id,
    before: { resolution_status: dlq.resolution_status, type: dlq.type, entity_id: dlq.entity_id },
    after: { resolution_status: "cancelled", type: dlq.type, entity_id: dlq.entity_id },
    actorRole: deriveActorRole(admin),
    request: req,
  });

  return NextResponse.json({ ok: true });
}
