import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { deriveActorRole, logAdminAction, requireAdmin } from "@/lib/admin/audit";

const VALID_JOB_KINDS = [
  "reanalyze_kill", "reclip_kill", "regen_og",
  "regen_audit_targets", "backfill_assists_game", "reanalyze_backlog",
];

/** GET /api/admin/pipeline/jobs?status=&kind=&limit= */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const kind = sp.get("kind");
  const limit = Math.min(200, parseInt(sp.get("limit") ?? "50", 10));

  const sb = await createServerSupabase();
  let query = sb
    .from("worker_jobs")
    .select("*")
    .order("requested_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (kind) query = query.eq("kind", kind);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [] });
}

/** POST /api/admin/pipeline/jobs — enqueue a job */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: 403 });

  const body = await req.json();
  const kind = body.kind;
  const payload = body.payload ?? {};

  if (!VALID_JOB_KINDS.includes(kind)) {
    return NextResponse.json({ error: `Invalid kind: ${kind}` }, { status: 400 });
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    action: "job.enqueue",
    entityType: "worker_job",
    entityId: data.id,
    after: { kind, payload },
    actorRole: deriveActorRole(admin),
    request: req,
  });

  return NextResponse.json({ ok: true, job: data });
}
