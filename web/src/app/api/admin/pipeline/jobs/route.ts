import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";
import { enqueueJob } from "@/app/admin/pipeline/trigger/actions";

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

/** POST /api/admin/pipeline/jobs — Wave 18 thin proxy onto the server
 *  action. Internal admin trigger form calls enqueueJob() directly. */
export async function POST(req: NextRequest) {
  let body: { kind?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.kind) {
    return NextResponse.json({ error: "kind required" }, { status: 400 });
  }
  const result = await enqueueJob({ kind: body.kind, payload: body.payload });
  if (!result.ok) {
    const status = result.error?.includes("Forbidden") ? 403 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, job: result.job });
}
