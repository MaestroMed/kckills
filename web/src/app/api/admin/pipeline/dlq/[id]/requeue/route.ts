/**
 * POST /api/admin/pipeline/dlq/[id]/requeue
 *
 * Re-queue a dead-letter-job into pipeline_jobs and mark the DLQ row
 * as `resolution_status='requeued'`. Idempotent : if the new
 * pipeline_jobs insert clashes with an existing active job for the
 * same (type, entity_type, entity_id) — the unique index just rejects
 * it, the DLQ row is still marked requeued (assumed someone already
 * re-queued it elsewhere).
 *
 * Auth + audit follow the same pattern as /api/admin/pipeline/jobs.
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

  // Fetch the DLQ row first — we need its (type, entity_type,
  // entity_id, payload) to seed the new pipeline_jobs row, AND we
  // want to make sure it's still pending before mutating anything.
  const { data: dlq, error: fetchErr } = await sb
    .from("dead_letter_jobs")
    .select(
      "id, type, entity_type, entity_id, payload, resolution_status"
    )
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

  // Insert a fresh pipeline_jobs row. We intentionally don't carry
  // over `attempts` from the failed job — this is a clean retry, not
  // a continuation, so the new job starts at attempts=0 with the
  // default max_attempts.
  const { data: newJob, error: insertErr } = await sb
    .from("pipeline_jobs")
    .insert({
      type: dlq.type,
      entity_type: dlq.entity_type,
      entity_id: dlq.entity_id,
      payload: dlq.payload ?? {},
      status: "pending",
      priority: 60, // bump above default — admin asked for it
    })
    .select("id")
    .maybeSingle();

  // Unique index can fire here — that's fine, treat as soft-success.
  let newJobId: string | null = newJob?.id ?? null;
  if (insertErr) {
    const isUniqueViolation =
      insertErr.code === "23505" ||
      /duplicate key|unique constraint/i.test(insertErr.message);
    if (!isUniqueViolation) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
  }

  // Mark the DLQ row resolved.
  const { error: updateErr } = await sb
    .from("dead_letter_jobs")
    .update({
      resolution_status: "requeued",
      resolved_by: "admin",
      resolved_at: new Date().toISOString(),
      resolution_note: newJobId
        ? `requeued as pipeline_jobs:${newJobId}`
        : "requeue no-op (duplicate active job already exists)",
    })
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logAdminAction({
    action: "dlq.requeue",
    entityType: "dead_letter_job",
    entityId: id,
    before: {
      resolution_status: dlq.resolution_status,
      type: dlq.type,
      entity_type: dlq.entity_type,
      entity_id: dlq.entity_id,
    },
    after: {
      resolution_status: "requeued",
      type: dlq.type,
      entity_type: dlq.entity_type,
      entity_id: dlq.entity_id,
      new_pipeline_job_id: newJobId,
    },
    actorRole: deriveActorRole(admin),
    request: req,
  });

  return NextResponse.json({ ok: true, new_pipeline_job_id: newJobId });
}
