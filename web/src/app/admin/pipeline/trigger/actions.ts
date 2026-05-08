"use server";

/**
 * Server Action for /admin/pipeline/trigger (Wave 18 — migrate fetch
 * POST → Server Action). Replaces the per-form fetch onto
 * /api/admin/pipeline/jobs that enqueues a job in the legacy
 * `worker_jobs` table.
 *
 * The legacy POST /api/admin/pipeline/jobs route is KEPT — it also
 * serves GET (the queue listing page polls it for updates). We just
 * delegate POST through the action.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  deriveActorRole,
  logAdminAction,
  requireAdmin,
} from "@/lib/admin/audit";

const VALID_JOB_KINDS = [
  "reanalyze_kill",
  "reclip_kill",
  "regen_og",
  "regen_audit_targets",
  "backfill_assists_game",
  "reanalyze_backlog",
];

export interface EnqueueJobInput {
  kind: string;
  payload?: Record<string, unknown>;
}

export interface EnqueueJobResult {
  ok: boolean;
  job?: { id: string; kind: string };
  error?: string;
}

async function buildAuditRequest(): Promise<Request> {
  const h = await headers();
  const init: HeadersInit = {};
  const xff = h.get("x-forwarded-for");
  const xRealIp = h.get("x-real-ip");
  const ua = h.get("user-agent");
  if (xff) init["x-forwarded-for"] = xff;
  if (xRealIp) init["x-real-ip"] = xRealIp;
  if (ua) init["user-agent"] = ua;
  return new Request("https://kckills.com/admin/pipeline/trigger", { headers: init });
}

export async function enqueueJob(input: EnqueueJobInput): Promise<EnqueueJobResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };

  const { kind } = input;
  const payload = input.payload ?? {};

  if (!VALID_JOB_KINDS.includes(kind)) {
    return { ok: false, error: `Invalid kind: ${kind}` };
  }

  const sb = await createServerSupabase();
  const { data, error } = await sb
    .from("worker_jobs")
    .insert({
      kind,
      payload,
      status: "pending",
      requested_by_actor: "mehdi",
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  const auditReq = await buildAuditRequest();
  await logAdminAction({
    action: "job.enqueue",
    entityType: "worker_job",
    entityId: (data as { id: string }).id,
    after: { kind, payload },
    actorRole: deriveActorRole(admin),
    request: auditReq,
  });

  revalidatePath("/admin/pipeline/jobs");
  revalidatePath("/admin/pipeline/trigger");
  return {
    ok: true,
    job: { id: (data as { id: string; kind: string }).id, kind: (data as { kind: string }).kind },
  };
}
