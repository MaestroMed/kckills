import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";

/**
 * GET /api/admin/perf/vitals-by-page
 *
 * Per-page breakdown of Web Vitals samples. Returns the top N most-
 * sampled pages with their LCP / CLS / INP p75. Used by the /admin/perf
 * detail view + the "worst offenders" table.
 *
 * Query params :
 *   - window  : "24h" | "7d"   (default "24h")
 *   - limit   : 1..50          (default 10)
 *   - sort    : "samples" | "lcp" | "cls" | "inp"   (default "samples")
 *
 * Cache : 5 minutes private. The per-page split changes much more
 * slowly than the global aggregate (most pages need many samples to
 * shift their p75) and the aggregation cost is the highest in this
 * module, so a longer TTL is worth it.
 */
export const dynamic = "force-dynamic";

export interface VitalsByPageRow {
  page_path: string;
  /** Total samples for this page, all metrics combined. */
  sample_count: number;
  lcp_p75: number | null;
  cls_p75: number | null;
  inp_p75: number | null;
  /** Per-page rating buckets — share of samples that are "poor". */
  poor_rate_lcp: number | null;
  poor_rate_cls: number | null;
  poor_rate_inp: number | null;
  /** Mobile vs desktop split, fractions over THIS page's samples. */
  mobile_share: number;
}

export interface VitalsByPageResponse {
  pages: VitalsByPageRow[];
  total_pages: number;
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
}

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

function round(v: number | null, decimals = 2): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const m = Math.pow(10, decimals);
  return Math.round(v * m) / m;
}

interface PageBucket {
  lcp: number[];
  cls: number[];
  inp: number[];
  lcpRatings: string[];
  clsRatings: string[];
  inpRatings: string[];
  total: number;
  mobile: number;
}

function emptyBucket(): PageBucket {
  return {
    lcp: [],
    cls: [],
    inp: [],
    lcpRatings: [],
    clsRatings: [],
    inpRatings: [],
    total: 0,
    mobile: 0,
  };
}

function poorRate(ratings: string[]): number | null {
  if (ratings.length === 0) return null;
  const poor = ratings.filter((r) => r === "poor").length;
  return round(poor / ratings.length, 4);
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  const url = new URL(req.url);
  const windowParam = url.searchParams.get("window");
  const timeWindow: "24h" | "7d" = windowParam === "7d" ? "7d" : "24h";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "10", 10);
  const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 10));
  const sortParam = url.searchParams.get("sort");
  const sort: "samples" | "lcp" | "cls" | "inp" =
    sortParam === "lcp" || sortParam === "cls" || sortParam === "inp"
      ? sortParam
      : "samples";

  const ms = timeWindow === "7d" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - ms).toISOString();

  const sb = await createServerSupabase();
  const { data, error } = await sb
    .from("user_events")
    .select("metadata, client_kind")
    .eq("event_type", "perf.vital")
    .gte("created_at", since)
    .limit(50000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as PerfVitalRow[];

  // Bucket per page_path. We only track LCP / CLS / INP (the three
  // metrics Google uses for the Core Web Vitals pass/fail) — FCP and
  // TTFB are already shown in the global aggregate.
  const byPage = new Map<string, PageBucket>();

  for (const row of rows) {
    const md = row.metadata;
    if (!md || typeof md !== "object") continue;
    const name = md.name;
    const value = md.value;
    const rating = md.rating;
    const pagePath = md.page_path;
    if (typeof name !== "string") continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (typeof pagePath !== "string" || pagePath.length === 0) continue;

    const bucket = byPage.get(pagePath) ?? emptyBucket();
    bucket.total += 1;
    // client_kind is "mobile" | "desktop" | "tablet" | "pwa" — we
    // count "mobile" + "pwa" as mobile-ish for this surface (PWA is
    // overwhelmingly installed on phones in our metrics).
    if (row.client_kind === "mobile" || row.client_kind === "pwa") {
      bucket.mobile += 1;
    }

    if (name === "LCP") {
      bucket.lcp.push(value);
      if (typeof rating === "string") bucket.lcpRatings.push(rating);
    } else if (name === "CLS") {
      bucket.cls.push(value);
      if (typeof rating === "string") bucket.clsRatings.push(rating);
    } else if (name === "INP") {
      bucket.inp.push(value);
      if (typeof rating === "string") bucket.inpRatings.push(rating);
    }

    byPage.set(pagePath, bucket);
  }

  const pages: VitalsByPageRow[] = [];
  for (const [pagePath, b] of byPage) {
    const lcpSorted = [...b.lcp].sort((a, b2) => a - b2);
    const clsSorted = [...b.cls].sort((a, b2) => a - b2);
    const inpSorted = [...b.inp].sort((a, b2) => a - b2);
    pages.push({
      page_path: pagePath,
      sample_count: b.total,
      lcp_p75: round(percentile(lcpSorted, 75)),
      cls_p75: round(percentile(clsSorted, 75), 4),
      inp_p75: round(percentile(inpSorted, 75)),
      poor_rate_lcp: poorRate(b.lcpRatings),
      poor_rate_cls: poorRate(b.clsRatings),
      poor_rate_inp: poorRate(b.inpRatings),
      mobile_share: b.total === 0 ? 0 : (round(b.mobile / b.total, 4) ?? 0),
    });
  }

  // Sort. For the metric-sort modes we put nulls last (= "no signal yet"
  // pages don't pollute the top of a "worst LCP" view).
  pages.sort((a, b) => {
    if (sort === "samples") return b.sample_count - a.sample_count;
    const key = sort === "lcp" ? "lcp_p75" : sort === "cls" ? "cls_p75" : "inp_p75";
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return b.sample_count - a.sample_count;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av; // descending — worst at the top
  });

  const body: VitalsByPageResponse = {
    pages: pages.slice(0, limit),
    total_pages: pages.length,
    time_window: timeWindow,
    generated_at: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, max-age=300, must-revalidate",
    },
  });
}
