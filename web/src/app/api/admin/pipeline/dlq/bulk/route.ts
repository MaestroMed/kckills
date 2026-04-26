/**
 * POST /api/admin/pipeline/dlq/bulk
 *
 * Bulk DLQ recovery endpoint. The single-row /requeue and /cancel
 * endpoints are fine for surgical triage, but with ~822 unresolved
 * rows (Wave 9 starting state) clicking through one-at-a-time isn't
 * realistic. This route enqueues a `worker.backfill` job that shells
 * out to scripts/dlq_drain.py on the worker host — the worker then
 * applies the recovery decision matrix and reports back via
 * pipeline_jobs.result.
 *
 * Body shape :
 *   {
 *     "action": "requeue" | "cancel",
 *     "filter": {
 *       "type": "clip.create" | "publish.check" | ...     // optional
 *       "error_code": "clip_failed" | ...                  // optional
 *       "since_days": number                                // default 7
 *     },
 *     "limit": number,        // optional
 *     "dry_run": boolean,     // default false
 *   }
 *
 * The "action" field today only supports "requeue" because the script
 * applies a per-row decision (some rows requeue, some cancel based on
 * the error_code matrix). Pass "cancel" to force a "cancel-only" run :
 * dlq_drain still walks the filter but every recoverable code is
 * coerced to cancellation. (Implemented by passing --error-code with
 * a sentinel that maps to cancellation in the script — easier path :
 * we model cancel-only as the operator having to use the per-row UI
 * for now, and reject "cancel" here with a 400 explaining the script
 * model. Future work : add a --force-cancel flag to dlq_drain.)
 *
 * Auth + audit follow the same pattern as the other admin endpoints.
 */
import { NextResponse } from "next/server";
import { deriveActorRole, logAdminAction, requireAdmin } from "@/lib/admin/audit";
import { enqueueAdminRun, coerceArgs } from "../../run/_shared";

interface BulkBody {
  action?: "requeue" | "cancel";
  filter?: {
    type?: string;
    error_code?: string;
    since_days?: number;
  };
  limit?: number;
  dry_run?: boolean;
}

export async function POST(req: Request): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  let body: BulkBody;
  try {
    body = (await req.json()) as BulkBody;
  } catch {
    body = {};
  }

  const action = body.action ?? "requeue";
  if (action !== "requeue" && action !== "cancel") {
    return NextResponse.json(
      { error: `unknown action '${action}' (expected 'requeue' or 'cancel')` },
      { status: 400 },
    );
  }

  // Bulk cancel-only isn't a script flag yet ; reject explicitly so the
  // operator knows to use the per-row UI for now. Filed as TODO in the
  // route docstring.
  if (action === "cancel") {
    return NextResponse.json(
      {
        error:
          "Cancellation en masse non supportée par le script actuel. " +
          "Utilisez le bouton Cancel par ligne, ou un --force-cancel " +
          "à ajouter au script dlq_drain.",
      },
      { status: 400 },
    );
  }

  const filter = body.filter ?? {};
  const args = coerceArgs({
    dry_run: body.dry_run === true,
    type: typeof filter.type === "string" ? filter.type : undefined,
    error_code:
      typeof filter.error_code === "string" ? filter.error_code : undefined,
    since_days:
      typeof filter.since_days === "number" && filter.since_days >= 0
        ? filter.since_days
        : undefined,
    limit:
      typeof body.limit === "number" && body.limit > 0 ? body.limit : undefined,
  });

  // Drop undefined keys so we don't pass `--type undefined` to the worker.
  for (const k of Object.keys(args)) {
    if (args[k] === undefined) delete args[k];
  }

  // Audit ahead of the enqueue so the trail exists even if the insert
  // fails. The enqueueAdminRun call ALSO logs an audit row (per-job).
  // Two rows for one operator click is fine — they show different facets
  // (intent vs. actual queued job).
  await logAdminAction({
    action: "dlq.bulk.requeue",
    entityType: "dead_letter_jobs_bulk",
    after: {
      filter,
      limit: body.limit ?? null,
      dry_run: body.dry_run === true,
    },
    actorRole: deriveActorRole(admin),
    request: req,
  });

  return enqueueAdminRun({
    script: "dlq_drain",
    args,
    request: req,
    admin,
    actorRole: deriveActorRole(admin),
    auditAction: "pipeline.trigger_run.dlq_drain",
  });
}
