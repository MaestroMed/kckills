import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";

/**
 * GET /api/admin/dashboard/health
 *
 * Per-module health table for /admin home dashboard.
 * Reads pipeline_runs over the last 24h and computes:
 *   - module       : module_name
 *   - runs         : total invocations
 *   - successRate  : succeeded / runs (0..1)
 *   - p50          : median duration_ms
 *   - p95          : 95th-percentile duration_ms
 *   - lastRun      : most recent started_at
 *   - lastError    : truncated error_summary of the most recent failed run
 *
 * Sorted by health (most failures first).
 *
 * NOTE : we DON'T use v_pipeline_health here because that view aggregates
 * over the LAST HOUR, not 24h, and doesn't expose per-row durations
 * needed for percentile calculation. We compute everything in JS over a
 * single pull — pipeline_runs is small (~5k rows/day per spec).
 *
 * Cache : 60s private (per-admin).
 */
export const dynamic = "force-dynamic";

export interface ModuleHealth {
  module: string;
  runs: number;
  succeeded: number;
  failed: number;
  successRate: number; // 0..1
  p50: number; // ms
  p95: number; // ms
  lastRun: string | null;
  lastError: string | null;
}

interface PipelineRunRow {
  module_name: string;
  status: string;
  duration_ms: number | null;
  started_at: string;
  error_summary: string | null;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  const sb = await createServerSupabase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("pipeline_runs")
    .select("module_name, status, duration_ms, started_at, error_summary")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(20000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const runs = (data ?? []) as PipelineRunRow[];
  const byModule = new Map<string, PipelineRunRow[]>();
  for (const row of runs) {
    const arr = byModule.get(row.module_name) ?? [];
    arr.push(row);
    byModule.set(row.module_name, arr);
  }

  const result: ModuleHealth[] = [];
  for (const [module, rows] of byModule) {
    const succeeded = rows.filter((r) => r.status === "succeeded").length;
    const failed = rows.filter((r) => r.status === "failed" || r.status === "timeout").length;
    const successRate = rows.length > 0 ? succeeded / rows.length : 1;

    const durations = rows
      .map((r) => r.duration_ms)
      .filter((v): v is number => typeof v === "number" && v >= 0)
      .sort((a, b) => a - b);
    const p50 = percentile(durations, 0.5);
    const p95 = percentile(durations, 0.95);

    // rows are DESC by started_at — first one is the most recent.
    const lastRun = rows[0]?.started_at ?? null;
    const lastFailure = rows.find((r) => r.status === "failed" || r.status === "timeout");
    const lastError = lastFailure?.error_summary
      ? lastFailure.error_summary.length > 200
        ? lastFailure.error_summary.slice(0, 200) + "…"
        : lastFailure.error_summary
      : null;

    result.push({
      module,
      runs: rows.length,
      succeeded,
      failed,
      successRate,
      p50,
      p95,
      lastRun,
      lastError,
    });
  }

  // Sort : failures DESC, then success rate ASC, then alphabetical.
  result.sort((a, b) => {
    if (b.failed !== a.failed) return b.failed - a.failed;
    if (a.successRate !== b.successRate) return a.successRate - b.successRate;
    return a.module.localeCompare(b.module);
  });

  return NextResponse.json(
    { items: result, generatedAt: new Date().toISOString() },
    {
      headers: {
        "Cache-Control": "private, max-age=60, must-revalidate",
      },
    }
  );
}

/**
 * Linear-interpolated percentile. data MUST be sorted ASC.
 * Returns 0 for empty arrays.
 */
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const upper = sorted[base + 1] ?? sorted[base];
  return Math.round(sorted[base] + rest * (upper - sorted[base]));
}
