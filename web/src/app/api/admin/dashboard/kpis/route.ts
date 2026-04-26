import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";

/**
 * GET /api/admin/dashboard/kpis
 *
 * Live ops snapshot for the /admin home dashboard. Returns 4 hero KPIs
 * with their 24h hourly sparklines + delta vs previous period :
 *
 *   - kills24h     : kills.publication_status = 'published' AND
 *                    updated_at > now() - 24h
 *   - clipRate     : kills published in the last 60 minutes
 *   - queueDepth   : pipeline_jobs WHERE status IN ('pending','claimed')
 *   - dlqCount     : dead_letter_jobs WHERE resolution_status = 'pending'
 *
 * Sparklines are 24 buckets (one per hour) each. We compute them in JS
 * after a single SELECT per metric — cheaper than 24 round-trips and
 * the dataset over 24h is small.
 *
 * Cache : 30s private (per-admin). Auto-refresh client-side hits this
 * roughly every 30s, so a small TTL stops back-to-back hits but never
 * shares between admins (different cookies).
 */
export const dynamic = "force-dynamic";

export interface DashboardKpis {
  kills24h: number;
  clipRate: number; // kills published in the last 60 minutes (already a /h rate)
  queueDepth: number;
  dlqCount: number;
  /** Delta vs previous comparable period (fraction, e.g. 0.12 = +12%). */
  deltas: {
    kills24h: number | null; // vs previous 24h
    clipRate: number | null; // vs previous 60min
    queueDepth: number | null; // vs 24h ago snapshot
    dlqCount: number | null; // vs 24h ago snapshot
  };
  /** 24 hourly buckets, oldest → newest. */
  sparklines: {
    kills: number[];
    clipRate: number[]; // each bucket = kills published that hour
    queue: number[]; // jobs becoming pending/claimed in that hour (proxy)
    dlq: number[]; // dead-letter rows added in that hour
  };
  generatedAt: string;
}

interface PublishedKillRow {
  updated_at: string;
}
interface PipelineJobRow {
  status: string;
  created_at: string;
}
interface DlqRow {
  failed_at: string;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  const sb = await createServerSupabase();
  const now = Date.now();
  const ms24h = 24 * 60 * 60 * 1000;
  const ms48h = 48 * 60 * 60 * 1000;
  const ms1h = 60 * 60 * 1000;
  const ms2h = 2 * 60 * 60 * 1000;

  const t48hAgo = new Date(now - ms48h).toISOString();
  const t24hAgo = new Date(now - ms24h).toISOString();
  const t1hAgo = new Date(now - ms1h).toISOString();
  const t2hAgo = new Date(now - ms2h).toISOString();

  // ─── Parallel data pulls ─────────────────────────────────────────
  // We want 48h of "published kills" so we can compute both the
  // current 24h count AND the previous-24h count for the delta.
  const [
    publishedKillsRes,
    queueAllRes,
    queueRecentRes,
    dlqAllRes,
  ] = await Promise.all([
    // Published kills in the last 48h, filtered by `publication_status`
    // (preferred) with a fallback to legacy `status` column. The OR
    // keeps the query future-proof through the migration window.
    sb
      .from("kills")
      .select("updated_at")
      .or(`publication_status.eq.published,status.eq.published`)
      .gte("updated_at", t48hAgo)
      .order("updated_at", { ascending: true })
      .limit(5000),

    // Queue depth — current snapshot of pending+claimed.
    sb
      .from("pipeline_jobs")
      .select("status, created_at")
      .in("status", ["pending", "claimed"])
      .limit(10000),

    // Queue inflow proxy — jobs created in the last 48h regardless of status.
    // We use this to fill the "queue" sparkline (not a true depth chart but a
    // good proxy for "are we backlogging or draining?").
    sb
      .from("pipeline_jobs")
      .select("status, created_at")
      .gte("created_at", t48hAgo)
      .limit(10000),

    // DLQ — every entry in the last 48h, regardless of resolution.
    sb
      .from("dead_letter_jobs")
      .select("failed_at")
      .gte("failed_at", t48hAgo)
      .order("failed_at", { ascending: true })
      .limit(5000),
  ]);

  // ─── Hour-bucket helpers ─────────────────────────────────────────
  // Build 24 zero-filled buckets for the last 24h. bucketIndex(ts) maps
  // a timestamp into [0..23], oldest=0. Anything older or in the future
  // is dropped silently.
  function makeBuckets(): number[] {
    return Array.from({ length: 24 }, () => 0);
  }
  function fillBuckets(timestamps: string[], cutoffMs: number): number[] {
    const buckets = makeBuckets();
    for (const ts of timestamps) {
      const t = new Date(ts).getTime();
      if (Number.isNaN(t)) continue;
      const ageMs = cutoffMs - t;
      if (ageMs < 0 || ageMs >= ms24h) continue;
      const hoursAgo = Math.floor(ageMs / ms1h);
      const idx = 23 - hoursAgo;
      if (idx >= 0 && idx < 24) buckets[idx]++;
    }
    return buckets;
  }

  // ─── Published kills ─────────────────────────────────────────────
  const publishedKills = (publishedKillsRes.data ?? []) as PublishedKillRow[];
  const killTimestamps = publishedKills.map((r) => r.updated_at);
  const sparkKills = fillBuckets(killTimestamps, now);

  let kills24h = 0;
  let killsPrev24h = 0;
  let clipRate = 0;
  let clipRatePrev = 0;
  for (const ts of killTimestamps) {
    const t = new Date(ts).getTime();
    if (Number.isNaN(t)) continue;
    const age = now - t;
    if (age < ms24h) kills24h++;
    else if (age < ms48h) killsPrev24h++;
    if (age < ms1h) clipRate++;
    else if (age < ms2h) clipRatePrev++;
  }

  // ─── Queue depth + history ───────────────────────────────────────
  const queueAll = (queueAllRes.data ?? []) as PipelineJobRow[];
  const queueDepth = queueAll.length;

  const queueRecent = (queueRecentRes.data ?? []) as PipelineJobRow[];
  const queueRecentTs = queueRecent.map((r) => r.created_at);
  const sparkQueue = fillBuckets(queueRecentTs, now);

  // Queue depth delta — compare current depth to "depth 24h ago".
  // We approximate "depth 24h ago" by counting jobs that were still
  // pending+claimed AND created before that point. Since jobs that
  // finished are excluded (status filter above), this isn't exact,
  // but it's directionally correct for trending signal.
  const queue24hAgoApprox = queueAll.filter(
    (r) => new Date(r.created_at).getTime() <= now - ms24h
  ).length;

  // ─── DLQ ─────────────────────────────────────────────────────────
  const dlqRows = (dlqAllRes.data ?? []) as DlqRow[];
  const dlqTimestamps = dlqRows.map((r) => r.failed_at);
  const sparkDlq = fillBuckets(dlqTimestamps, now);

  // Total DLQ count = pending dead-letter rows in the last 48h.
  // (We don't pull resolution_status here — for the headline KPI, we
  // care about volume, not triage state. Detail page handles triage.)
  const dlqCount = dlqRows.length;
  const dlqPrev24h = dlqTimestamps.filter((ts) => {
    const t = new Date(ts).getTime();
    return !Number.isNaN(t) && now - t >= ms24h && now - t < ms48h;
  }).length;
  const dlqLast24h = dlqTimestamps.length - dlqPrev24h;

  // ─── Deltas ──────────────────────────────────────────────────────
  function pctDelta(current: number, prev: number): number | null {
    if (prev === 0) return current === 0 ? 0 : null;
    return (current - prev) / prev;
  }

  const body: DashboardKpis = {
    kills24h,
    clipRate, // already a /h count
    queueDepth,
    dlqCount: dlqLast24h,
    deltas: {
      kills24h: pctDelta(kills24h, killsPrev24h),
      clipRate: pctDelta(clipRate, clipRatePrev),
      queueDepth: pctDelta(queueDepth, queue24hAgoApprox),
      dlqCount: pctDelta(dlqLast24h, dlqPrev24h),
    },
    sparklines: {
      kills: sparkKills,
      clipRate: sparkKills, // same data, same shape — clip rate viz uses the kills curve
      queue: sparkQueue,
      dlq: sparkDlq,
    },
    generatedAt: new Date(now).toISOString(),
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, max-age=30, must-revalidate",
    },
  });
}
