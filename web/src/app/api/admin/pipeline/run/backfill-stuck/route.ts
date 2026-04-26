/**
 * POST /api/admin/pipeline/run/backfill-stuck
 *
 * Enqueue a `worker.backfill` job that triggers the
 * `backfill_stuck_pipeline` script on the worker host.
 *
 * Body shape :
 *   { state: "all"|"manual_review"|"vod_found"|"clipped"|"analyzed"
 *     dry_run?: boolean
 *     limit?: number
 *     min_score?: number
 *     since?: number }   // days
 *
 * `state` is REQUIRED — refuse without it. We intentionally don't
 * default to 'all' so a typoed body doesn't accidentally drain every
 * bucket at once.
 */
import { NextResponse } from "next/server";
import { deriveActorRole, requireAdmin } from "@/lib/admin/audit";
import { coerceArgs, enqueueAdminRun } from "../_shared";

const VALID_STATES = new Set([
  "all", "manual_review", "vod_found", "clipped", "analyzed",
]);

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const rawArgs = coerceArgs(body);
  const state = rawArgs.state;
  if (typeof state !== "string" || !VALID_STATES.has(state)) {
    return NextResponse.json(
      {
        error:
          `state must be one of : ${Array.from(VALID_STATES).join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Build the args object — drop anything we don't recognise so the
  // audit row stays clean.
  const args: Record<string, unknown> = { state };
  if (typeof rawArgs.dry_run === "boolean") args.dry_run = rawArgs.dry_run;
  if (typeof rawArgs.limit === "number") args.limit = rawArgs.limit;
  if (typeof rawArgs.min_score === "number") args.min_score = rawArgs.min_score;
  if (typeof rawArgs.since === "number") args.since = rawArgs.since;

  return enqueueAdminRun({
    script: "backfill_stuck_pipeline",
    args,
    request: req,
    admin,
    actorRole: deriveActorRole(admin),
    auditAction: "pipeline.trigger_run.backfill_stuck_pipeline",
  });
}
