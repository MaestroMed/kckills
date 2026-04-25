/**
 * Shared helpers for /api/admin/pipeline/run/* endpoints.
 *
 * Each endpoint enqueues a pipeline_jobs row of kind 'worker.backfill'.
 * The payload schema is :
 *   { script: string, args: Record<string, unknown> }
 *
 * The whitelist below is the LAST line of defense before subprocess.run
 * fires on the worker host. Order :
 *   1. Endpoint route validates `script` is one of these keys
 *   2. We POST to pipeline_jobs (PostgREST CHECK on `type` enforces
 *      the kind 'worker.backfill' is allowed — see migration 033)
 *   3. The worker's admin_job_runner.SCRIPT_WHITELIST re-validates
 *      before calling subprocess
 *
 * If any of those layers gets bypassed, the others still hold.
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { logAdminAction, type AdminCheckResult, type AdminActorRole } from "@/lib/admin/audit";

/** Whitelisted operator scripts the admin UI can trigger. */
export const ADMIN_RUN_WHITELIST = new Set<string>([
  "backfill_clip_errors",
  "backfill_stuck_pipeline",
  "recon_videos_now",
  "dlq_drain",
]);

/** Map UI-provided priority to a queue priority. Default 80 = above
 * normal score-based priorities (which top out at 100), but below
 * editorial pin (90+). High enough that operator clicks jump the line
 * over the daemon's own enqueues without crowding out the highest-
 * priority work.
 */
export const ADMIN_RUN_DEFAULT_PRIORITY = 80;

/** Type field used in pipeline_jobs.type for admin-triggered runs. */
export const ADMIN_RUN_JOB_TYPE = "worker.backfill";

interface EnqueueParams {
  script: string;
  args: Record<string, unknown>;
  priority?: number;
  request: Request;
  admin: AdminCheckResult;
  actorRole: AdminActorRole;
  /** Audit `action` field — distinct per endpoint so the operator can
   * search admin_actions for "pipeline.trigger_run.backfill_clip_errors"
   * etc. */
  auditAction: string;
}

/** Insert + audit + return the JSON response. Centralises the boring
 * parts so each route handler stays small + readable.
 *
 * Returns a NextResponse — the caller just `return enqueueAdminRun(...)`.
 */
export async function enqueueAdminRun(params: EnqueueParams): Promise<NextResponse> {
  // Defence-in-depth : route should already have rejected, but a typo
  // there shouldn't open the door to arbitrary scripts.
  if (!ADMIN_RUN_WHITELIST.has(params.script)) {
    return NextResponse.json(
      { error: `script '${params.script}' is not whitelisted` },
      { status: 400 },
    );
  }

  const sb = await createServerSupabase();

  // Idempotent : the unique partial index on (type, entity_type,
  // entity_id) WHERE status IN ('pending','claimed') uses NULL/NULL
  // for entity_type+entity_id on these admin jobs. PostgREST treats
  // NULL+NULL as distinct rows so the operator CAN queue the same
  // script twice in a row — that's deliberate, since each click is
  // its own intent. If we wanted true coalescing we'd derive a
  // synthetic entity_id from the payload hash, but operator-driven
  // duplication is rare enough not to be worth the complexity.
  const { data, error } = await sb
    .from("pipeline_jobs")
    .insert({
      type: ADMIN_RUN_JOB_TYPE,
      entity_type: "admin_run",
      entity_id: null,
      payload: { script: params.script, args: params.args },
      priority: params.priority ?? ADMIN_RUN_DEFAULT_PRIORITY,
      max_attempts: 1,    // operator triggers shouldn't auto-retry
                          //  silently — fail fast → operator decides
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Audit. Use a stable `action` namespace so the audit search can
  // group all run-page triggers under a common prefix.
  await logAdminAction({
    action: params.auditAction,
    entityType: "pipeline_job",
    entityId: data.id,
    after: {
      type: ADMIN_RUN_JOB_TYPE,
      script: params.script,
      args: params.args,
      priority: data.priority,
    },
    actorRole: params.actorRole,
    request: params.request,
  });

  return NextResponse.json({ ok: true, job: data });
}

/**
 * Lightly coerce `unknown` to a record. Returns `{}` on null/non-object
 * input rather than throwing — the API endpoints accept JSON bodies
 * but should handle empty / malformed gracefully (the worker's per-arg
 * schema does the real validation).
 */
export function coerceArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}
