import { NextRequest, NextResponse } from "next/server";
import { logAdminAction, requireAdmin } from "@/lib/admin/audit";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Admin QC endpoint — enqueue a clip_qc.verify job for a single kill.
 *
 * POST  /api/admin/clips/[id]/qc
 *   → inserts a row into worker_jobs(kind='clip_qc.verify', payload={kill_id})
 *   → returns { job_id }
 *
 * GET   /api/admin/clips/[id]/qc?job_id=<uuid>
 *   → polls the worker_jobs row, returns { status, result, error }
 *
 * The worker's job_runner module (PR4-B) consumes the job, downloads
 * the clip, runs Gemini timer reading, writes the result. The admin
 * UI polls until status === 'completed' or 'failed' (~10-30s).
 *
 * Auth-gated via requireAdmin() — cookie kc_admin or Discord allowlist.
 */

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }
  const { id } = await params;
  const sb = await createServerSupabase();
  const { data, error } = await sb
    .from("worker_jobs")
    .insert({
      kind: "clip_qc.verify",
      payload: { kill_id: id },
      status: "pending",
    })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await logAdminAction({
    action: "kill.qc_requested",
    entityType: "kill",
    entityId: id,
  });
  return NextResponse.json({ job_id: data.id });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }
  await params; // params not used for GET (job_id is the keying)
  const url = new URL(req.url);
  const jobId = url.searchParams.get("job_id");
  if (!jobId) {
    return NextResponse.json({ error: "job_id required" }, { status: 400 });
  }
  const sb = await createServerSupabase();
  const { data, error } = await sb
    .from("worker_jobs")
    .select("status, result, error")
    .eq("id", jobId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  // result is stored as JSON string in worker_jobs.result — parse it
  // for the UI's convenience.
  let parsed: unknown = null;
  if (data.result && typeof data.result === "string") {
    try {
      parsed = JSON.parse(data.result);
    } catch {
      parsed = data.result;
    }
  } else if (data.result) {
    parsed = data.result;
  }
  return NextResponse.json({
    status: data.status,
    result: parsed,
    error: data.error,
  });
}
