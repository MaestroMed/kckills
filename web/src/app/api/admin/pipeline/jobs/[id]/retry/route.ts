/**
 * POST /api/admin/pipeline/jobs/[id]/retry
 *
 * Reset a failed pipeline_jobs row to `pending` so the worker picks
 * it back up on the next claim cycle. Resets `attempts=0` and
 * `run_after=now()` ; clears `last_error`, `result`, lease.
 *
 * Only `failed` jobs are eligible — a row that's already pending
 * doesn't need retrying, and resetting a claimed/succeeded job would
 * be confusing.
 *
 * The unique partial index `idx_pipeline_jobs_active_unique` on
 * (type, entity_type, entity_id) WHERE status IN ('pending', 'claimed')
 * means a retry can fail with 23505 if a NEW active job already exists
 * for the same entity. We surface that as a 409.
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

  const { data: job, error: fetchErr } = await sb
    .from("pipeline_jobs")
    .select(
      "id, type, entity_type, entity_id, status, attempts, last_error"
    )
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (job.status !== "failed") {
    return NextResponse.json(
      { error: `cannot retry job in status '${job.status}' — only 'failed' is eligible` },
      { status: 409 }
    );
  }

  const { error: updateErr } = await sb
    .from("pipeline_jobs")
    .update({
      status: "pending",
      attempts: 0,
      run_after: new Date().toISOString(),
      last_error: null,
      result: null,
      locked_by: null,
      locked_until: null,
      claimed_at: null,
      finished_at: null,
    })
    .eq("id", id);

  if (updateErr) {
    // Unique-violation : a new active job already exists for the same
    // (type, entity_type, entity_id) — the user probably already
    // retried via the trigger UI or the worker re-enqueued.
    const isUniqueViolation =
      updateErr.code === "23505" ||
      /duplicate key|unique constraint/i.test(updateErr.message);
    if (isUniqueViolation) {
      return NextResponse.json(
        {
          error:
            "another active job already exists for this entity (type+entity_id+entity_type unique). Cancel that one first.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logAdminAction({
    action: "pipeline_job.retry",
    entityType: "pipeline_job",
    entityId: id,
    before: {
      status: job.status,
      attempts: job.attempts,
      last_error: job.last_error,
    },
    after: {
      type: job.type,
      entity_type: job.entity_type,
      entity_id: job.entity_id,
      status: "pending",
    },
    actorRole: deriveActorRole(admin),
    request: req,
  });

  return NextResponse.json({ ok: true });
}
