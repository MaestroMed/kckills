/**
 * POST /api/admin/pipeline/jobs/[id]/cancel
 *
 * Mark a pipeline_jobs row as `status='cancelled'`. Only allowed when
 * the job is currently `pending` or `claimed` — finished/failed jobs
 * are immutable history.
 *
 * If the job is `claimed`, the in-flight worker won't notice the
 * cancellation until its next status update — so the row may briefly
 * be 'cancelled' while a worker still has the lease. That's
 * acceptable : the worker's next write will conflict on a CHECK
 * constraint or be ignored, and the next claim cycle will skip the row
 * (status filter on `pending`).
 *
 * Audit row written to admin_actions for traceability.
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

  // Read first so we can audit the original state and reject illegal
  // transitions (e.g. trying to cancel an already-finished job).
  const { data: job, error: fetchErr } = await sb
    .from("pipeline_jobs")
    .select("id, type, entity_type, entity_id, status, attempts, locked_by")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (job.status !== "pending" && job.status !== "claimed") {
    return NextResponse.json(
      { error: `cannot cancel job in status '${job.status}'` },
      { status: 409 }
    );
  }

  const { error: updateErr } = await sb
    .from("pipeline_jobs")
    .update({
      status: "cancelled",
      last_error: "cancelled by admin via /admin/pipeline/jobs",
      // Release the lease so a stuck claim doesn't keep the row
      // locked. A cancelled row will never be re-claimed (the claim
      // function filters on status='pending').
      locked_by: null,
      locked_until: null,
    })
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logAdminAction({
    action: "pipeline_job.cancel",
    entityType: "pipeline_job",
    entityId: id,
    before: {
      status: job.status,
      attempts: job.attempts,
      locked_by: job.locked_by,
    },
    after: {
      type: job.type,
      entity_type: job.entity_type,
      entity_id: job.entity_id,
      status: "cancelled",
    },
    actorRole: deriveActorRole(admin),
    request: req,
  });

  return NextResponse.json({ ok: true });
}
