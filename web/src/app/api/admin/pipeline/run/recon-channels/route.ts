/**
 * POST /api/admin/pipeline/run/recon-channels
 *
 * Enqueue a `worker.backfill` job that triggers `recon_videos_now`
 * on the worker — forces an immediate channel_reconciler pass for
 * the latest backfill videos (Kameto / @LCSEsports / etc.) instead
 * of waiting for the hourly daemon cycle.
 *
 * No body args supported (the script takes no flags) — we ignore
 * whatever the client sends.
 */
import { NextResponse } from "next/server";
import { deriveActorRole, requireAdmin } from "@/lib/admin/audit";
import { enqueueAdminRun } from "../_shared";

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  // The script has no CLI args — anything the client sends is dropped.
  return enqueueAdminRun({
    script: "recon_videos_now",
    args: {},
    request: req,
    admin,
    actorRole: deriveActorRole(admin),
    auditAction: "pipeline.trigger_run.recon_videos_now",
  });
}
