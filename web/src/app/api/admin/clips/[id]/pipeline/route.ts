import { NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";

/**
 * GET /api/admin/clips/[id]/pipeline — historique du kill dans le pipeline :
 * jobs (pipeline_jobs) et échecs définitifs (dead_letter_jobs) qui le ciblent.
 * pipeline_runs n'a pas de lien vers un kill, d'où ces deux sources.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const { id } = await params;

  const [jobs, dlq] = await Promise.all([
    g.sb
      .from("pipeline_jobs")
      .select("id, type, status, attempts, last_error, created_at, claimed_at, finished_at")
      .eq("entity_type", "kill")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    g.sb
      .from("dead_letter_jobs")
      .select("id, type, error_code, error_message, failed_at, resolution_status")
      .eq("entity_type", "kill")
      .eq("entity_id", id)
      .order("failed_at", { ascending: false })
      .limit(20),
  ]);
  if (jobs.error) return NextResponse.json({ error: jobs.error.message }, { status: 500 });

  const items = [
    ...(jobs.data ?? []).map((j) => ({
      id: j.id,
      module_name: j.type,
      status: j.attempts > 1 ? `${j.status} · ${j.attempts} essais` : j.status,
      started_at: j.claimed_at ?? j.created_at,
      ended_at: j.finished_at,
      error_summary: j.last_error,
    })),
    ...(dlq.data ?? []).map((d) => ({
      id: d.id,
      module_name: `${d.type} (DLQ)`,
      status: d.resolution_status === "pending" ? "failed" : d.resolution_status,
      started_at: d.failed_at,
      ended_at: d.failed_at,
      error_summary: [d.error_code, d.error_message].filter(Boolean).join(" — ") || null,
    })),
  ].sort((a, b) => b.started_at.localeCompare(a.started_at));

  return NextResponse.json({ items });
}
