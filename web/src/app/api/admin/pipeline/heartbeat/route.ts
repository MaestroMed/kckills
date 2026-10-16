import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { adminDbUnavailable, requireAdmin } from "@/lib/admin/audit";

/** GET /api/admin/pipeline/heartbeat — worker daemon freshness */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: 403 });

  const sb = createServiceSupabase();

  if (!sb) return adminDbUnavailable();
  const { data } = await sb
    .from("health_checks")
    .select("id, last_seen, metrics")
    .eq("id", "worker_heartbeat")
    .maybeSingle();

  return NextResponse.json({
    last_seen: data?.last_seen ?? null,
    metrics: data?.metrics ?? null,
  });
}
