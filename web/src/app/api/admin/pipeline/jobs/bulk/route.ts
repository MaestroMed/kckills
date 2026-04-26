/**
 * POST /api/admin/pipeline/jobs/bulk
 *
 * Bulk-action endpoint for the /admin/pipeline/jobs page.
 *
 * Body shape:
 *   {
 *     "action": "cancel" | "retry" | "reprioritize",
 *     "job_ids": string[]            // UUIDs of pipeline_jobs rows
 *     "priority"?: number            // required when action === "reprioritize"
 *   }
 *
 * Each job is processed independently — partial failures are tolerated
 * and reported per-row in `results`. The endpoint returns:
 *
 *   {
 *     ok: true,
 *     counts: { ok: N, failed: M, skipped: K },
 *     results: [{ id, status: "ok"|"failed"|"skipped", error?: string }, ...]
 *   }
 *
 * Cancel + retry mirror the per-row /[id]/cancel and /[id]/retry handlers
 * (same status-transition rules) so the operator gets the same behavior
 * whether they click one row or 50 rows. Reprioritize sets `priority`
 * to the requested value but only on rows still `pending` (a claimed
 * job has already been picked up — bumping its priority does nothing).
 *
 * Audit: one admin_actions row per successful action + one summary row
 * for the bulk call. The summary captures the operator's intent ; the
 * per-row rows give us a paper trail when triaging "who cancelled X".
 *
 * SECURITY: requireAdmin() at entry, hard cap of 500 ids per request to
 * prevent runaway invocations.
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { deriveActorRole, logAdminAction, requireAdmin } from "@/lib/admin/audit";

type BulkAction = "cancel" | "retry" | "reprioritize";

interface BulkBody {
  action?: BulkAction;
  job_ids?: unknown;
  priority?: unknown;
}

interface RowResult {
  id: string;
  status: "ok" | "failed" | "skipped";
  error?: string;
}

const MAX_IDS_PER_REQUEST = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  let body: BulkBody;
  try {
    body = (await req.json()) as BulkBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  if (action !== "cancel" && action !== "retry" && action !== "reprioritize") {
    return NextResponse.json(
      {
        error:
          "missing/invalid `action` (expected 'cancel' | 'retry' | 'reprioritize')",
      },
      { status: 400 },
    );
  }

  const rawIds = Array.isArray(body.job_ids) ? body.job_ids : null;
  if (!rawIds || rawIds.length === 0) {
    return NextResponse.json(
      { error: "missing/empty `job_ids`" },
      { status: 400 },
    );
  }
  if (rawIds.length > MAX_IDS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `too many ids: max ${MAX_IDS_PER_REQUEST} per request, got ${rawIds.length}`,
      },
      { status: 400 },
    );
  }
  const jobIds = rawIds
    .filter((v): v is string => typeof v === "string" && UUID_RE.test(v));
  if (jobIds.length === 0) {
    return NextResponse.json(
      { error: "no valid UUID in `job_ids`" },
      { status: 400 },
    );
  }

  let priority: number | null = null;
  if (action === "reprioritize") {
    const p = body.priority;
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 100) {
      return NextResponse.json(
        {
          error:
            "missing/invalid `priority` for reprioritize (expected 0-100 integer)",
        },
        { status: 400 },
      );
    }
    priority = Math.round(p);
  }

  const sb = await createServerSupabase();
  const results: RowResult[] = [];
  const okCount = { value: 0 };
  const failCount = { value: 0 };
  const skipCount = { value: 0 };

  // We process rows serially. The ops UX wants accurate per-row status
  // and Supabase doesn't ship a row-by-row update-with-different-conditions
  // primitive for what we need ; serial loops are fine for ≤500 rows.
  for (const id of jobIds) {
    const row = await processOne(sb, action, id, priority);
    results.push(row);
    if (row.status === "ok") okCount.value++;
    else if (row.status === "failed") failCount.value++;
    else skipCount.value++;
  }

  // Summary audit row — gives a single line in /admin/audit covering
  // the bulk operator click. Per-row audit rows are written by
  // processOne() itself.
  await logAdminAction({
    action: `pipeline_job.bulk.${action}`,
    entityType: "pipeline_jobs_bulk",
    after: {
      action,
      count_requested: jobIds.length,
      count_ok: okCount.value,
      count_failed: failCount.value,
      count_skipped: skipCount.value,
      priority: priority ?? undefined,
    },
    actorRole: deriveActorRole(admin),
    request: req,
  });

  return NextResponse.json({
    ok: true,
    counts: {
      ok: okCount.value,
      failed: failCount.value,
      skipped: skipCount.value,
    },
    results,
  });
}

// ─── Per-row workers ─────────────────────────────────────────────────

type SBClient = Awaited<ReturnType<typeof createServerSupabase>>;

async function processOne(
  sb: SBClient,
  action: BulkAction,
  id: string,
  priority: number | null,
): Promise<RowResult> {
  // Fetch first — we need the current state to decide whether to skip
  // (e.g. cancelling an already-finished job is a no-op, not an error).
  const { data: job, error: fetchErr } = await sb
    .from("pipeline_jobs")
    .select(
      "id, type, entity_type, entity_id, status, attempts, last_error, priority",
    )
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return { id, status: "failed", error: fetchErr.message };
  }
  if (!job) {
    return { id, status: "failed", error: "not found" };
  }

  const beforeSnapshot = {
    status: job.status,
    attempts: job.attempts,
    priority: job.priority,
  };

  if (action === "cancel") {
    if (job.status !== "pending" && job.status !== "claimed") {
      return {
        id,
        status: "skipped",
        error: `not cancellable in status '${job.status}'`,
      };
    }
    const { error: updateErr } = await sb
      .from("pipeline_jobs")
      .update({
        status: "cancelled",
        last_error: "cancelled by admin via bulk action",
        locked_by: null,
        locked_until: null,
      })
      .eq("id", id);
    if (updateErr) {
      return { id, status: "failed", error: updateErr.message };
    }
    await logAdminAction({
      action: "pipeline_job.cancel",
      entityType: "pipeline_job",
      entityId: id,
      before: beforeSnapshot,
      after: {
        type: job.type,
        entity_type: job.entity_type,
        entity_id: job.entity_id,
        status: "cancelled",
        via: "bulk",
      },
    });
    return { id, status: "ok" };
  }

  if (action === "retry") {
    if (job.status !== "failed") {
      return {
        id,
        status: "skipped",
        error: `not retryable in status '${job.status}'`,
      };
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
      // Surface the unique-violation case explicitly so the operator
      // can see WHY their bulk retry skipped a row (another active job
      // already exists for the same entity).
      const isUniqueViolation =
        updateErr.code === "23505" ||
        /duplicate key|unique constraint/i.test(updateErr.message);
      return {
        id,
        status: "failed",
        error: isUniqueViolation
          ? "another active job exists for this entity"
          : updateErr.message,
      };
    }
    await logAdminAction({
      action: "pipeline_job.retry",
      entityType: "pipeline_job",
      entityId: id,
      before: beforeSnapshot,
      after: {
        type: job.type,
        entity_type: job.entity_type,
        entity_id: job.entity_id,
        status: "pending",
        via: "bulk",
      },
    });
    return { id, status: "ok" };
  }

  // reprioritize
  if (job.status !== "pending") {
    return {
      id,
      status: "skipped",
      error: `not reprioritizable in status '${job.status}'`,
    };
  }
  const newPriority = priority as number;
  const { error: updateErr } = await sb
    .from("pipeline_jobs")
    .update({ priority: newPriority })
    .eq("id", id);
  if (updateErr) {
    return { id, status: "failed", error: updateErr.message };
  }
  await logAdminAction({
    action: "pipeline_job.reprioritize",
    entityType: "pipeline_job",
    entityId: id,
    before: beforeSnapshot,
    after: {
      type: job.type,
      entity_type: job.entity_type,
      entity_id: job.entity_id,
      priority: newPriority,
      via: "bulk",
    },
  });
  return { id, status: "ok" };
}
