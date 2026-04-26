import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";

/**
 * GET /api/admin/perf/vitals
 *
 * Aggregated Real-User-Monitoring (RUM) snapshot for the admin perf
 * surface. Reads `user_events` rows with `event_type = 'perf.vital'`
 * over a configurable window (default 24h) and returns per-metric
 * percentiles + Google rating distribution.
 *
 * Query params :
 *   - window : "24h" | "7d"   (default "24h")
 *
 * Why JS percentiles, not PostgreSQL ?
 *   We hit Supabase via PostgREST (no raw-SQL plane on the free tier
 *   without a custom RPC), and the dataset over 24h at this scale is
 *   small (<10k rows expected). A single SELECT + JS sort beats the
 *   roundtrip of a custom RPC AND keeps the migration surface to zero.
 *   If perf.vital volume crosses ~50k/day we should add a SQL RPC with
 *   PERCENTILE_CONT — see comment in migration 041.
 *
 * Cache : 60s private. The vitals dataset moves slowly compared to the
 * pipeline KPIs (a single user produces at most one sample per metric
 * per page load), so a slightly longer TTL than /kpis is fine.
 *
 * Graceful empty state : if zero rows match (data just started flowing
 * after migration 041), we still return a 200 with all-null percentiles
 * so the UI can render its empty state instead of an error toast.
 */
export const dynamic = "force-dynamic";

export type VitalName = "LCP" | "CLS" | "INP" | "FCP" | "TTFB" | "FID";

export interface VitalStats {
  /** 50th percentile. null when the bucket has no samples. */
  p50: number | null;
  p75: number | null;
  p95: number | null;
  /** Sample count for THIS metric. */
  sample_count: number;
  /** Fractions summing to 1 (or 0 if empty). */
  rating_distribution: {
    good: number;
    ni: number;
    poor: number;
  };
}

export interface VitalsResponse {
  lcp: VitalStats;
  cls: VitalStats;
  inp: VitalStats;
  fcp: VitalStats;
  ttfb: VitalStats;
  fid: VitalStats;
  /** Total rows scanned across all metrics. */
  sample_count: number;
  /** Echoed back so the client can label charts. */
  time_window: "24h" | "7d";
  generated_at: string;
}

interface PerfVitalRow {
  metadata: {
    name?: string;
    value?: number;
    rating?: string;
    page_path?: string;
  } | null;
  client_kind: string | null;
  created_at: string;
}

const EMPTY_STATS: VitalStats = {
  p50: null,
  p75: null,
  p95: null,
  sample_count: 0,
  rating_distribution: { good: 0, ni: 0, poor: 0 },
};

/**
 * Compute a percentile (0..100) over a sorted-ascending numeric array.
 * Uses the linear interpolation method matching PostgreSQL's
 * PERCENTILE_CONT — so JS-side and SQL-side give the same answer when
 * we eventually add an RPC.
 */
function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  const frac = rank - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac;
}

function computeStats(values: number[], ratings: string[]): VitalStats {
  if (values.length === 0) return { ...EMPTY_STATS };
  const sorted = [...values].sort((a, b) => a - b);
  const counts = { good: 0, ni: 0, poor: 0 };
  for (const r of ratings) {
    if (r === "good") counts.good++;
    else if (r === "needs-improvement") counts.ni++;
    else if (r === "poor") counts.poor++;
  }
  const total = ratings.length;
  return {
    p50: round(percentile(sorted, 50)),
    p75: round(percentile(sorted, 75)),
    p95: round(percentile(sorted, 95)),
    sample_count: values.length,
    rating_distribution: total === 0
      ? { good: 0, ni: 0, poor: 0 }
      : {
          good: round(counts.good / total, 4) ?? 0,
          ni: round(counts.ni / total, 4) ?? 0,
          poor: round(counts.poor / total, 4) ?? 0,
        },
  };
}

function round(v: number | null, decimals = 2): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const m = Math.pow(10, decimals);
  return Math.round(v * m) / m;
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  const url = new URL(req.url);
  const windowParam = url.searchParams.get("window");
  const timeWindow: "24h" | "7d" = windowParam === "7d" ? "7d" : "24h";
  const ms = timeWindow === "7d" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - ms).toISOString();

  const sb = await createServerSupabase();
  const { data, error } = await sb
    .from("user_events")
    .select("metadata, client_kind, created_at")
    .eq("event_type", "perf.vital")
    .gte("created_at", since)
    .limit(50000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as PerfVitalRow[];

  // Bucket per-metric. We only keep the value + rating arrays — the rest
  // of the row (page_path, client_kind) is owned by the by-page route.
  const buckets: Record<VitalName, { values: number[]; ratings: string[] }> = {
    LCP: { values: [], ratings: [] },
    CLS: { values: [], ratings: [] },
    INP: { values: [], ratings: [] },
    FCP: { values: [], ratings: [] },
    TTFB: { values: [], ratings: [] },
    FID: { values: [], ratings: [] },
  };

  for (const row of rows) {
    const md = row.metadata;
    if (!md || typeof md !== "object") continue;
    const name = md.name;
    const value = md.value;
    const rating = md.rating;
    if (typeof name !== "string") continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (!(name in buckets)) continue;
    const key = name as VitalName;
    buckets[key].values.push(value);
    if (typeof rating === "string") buckets[key].ratings.push(rating);
  }

  const body: VitalsResponse = {
    lcp: computeStats(buckets.LCP.values, buckets.LCP.ratings),
    cls: computeStats(buckets.CLS.values, buckets.CLS.ratings),
    inp: computeStats(buckets.INP.values, buckets.INP.ratings),
    fcp: computeStats(buckets.FCP.values, buckets.FCP.ratings),
    ttfb: computeStats(buckets.TTFB.values, buckets.TTFB.ratings),
    fid: computeStats(buckets.FID.values, buckets.FID.ratings),
    sample_count: rows.length,
    time_window: timeWindow,
    generated_at: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, max-age=60, must-revalidate",
    },
  });
}
