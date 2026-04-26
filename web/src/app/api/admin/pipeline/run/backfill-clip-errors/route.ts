/**
 * POST /api/admin/pipeline/run/backfill-clip-errors
 *
 * Enqueue a `worker.backfill` job that triggers the
 * `backfill_clip_errors` script on the worker host.
 *
 * Body shape (all fields optional) :
 *   { dry_run?: boolean, min_score?: number, limit?: number }
 *
 * Validation : the `script` field is hard-coded here (not from the
 * client) so even a malformed body cannot escape the whitelist. The
 * worker's admin_job_runner re-validates before subprocess.run.
 */
import { NextResponse } from "next/server";
import { deriveActorRole, requireAdmin } from "@/lib/admin/audit";
import { coerceArgs, enqueueAdminRun } from "../_shared";

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // Empty / malformed body is fine — fall back to script defaults.
  }

  const rawArgs = coerceArgs(body);
  // Only forward the args the script understands. The worker's
  // SCRIPT_ARG_SCHEMA also drops unknown args, but stripping here
  // keeps audit records clean (no garbage in admin_actions.after.args).
  const args: Record<string, unknown> = {};
  if (typeof rawArgs.dry_run === "boolean") args.dry_run = rawArgs.dry_run;
  if (typeof rawArgs.min_score === "number") args.min_score = rawArgs.min_score;
  if (typeof rawArgs.limit === "number") args.limit = rawArgs.limit;

  return enqueueAdminRun({
    script: "backfill_clip_errors",
    args,
    request: req,
    admin,
    actorRole: deriveActorRole(admin),
    auditAction: "pipeline.trigger_run.backfill_clip_errors",
  });
}
