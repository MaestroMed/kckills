/**
 * /admin/pipeline/rate — Production rate dashboard.
 *
 * Wave 20.5 (2026-05-08) — web mirror of `worker/scripts/production_rate.py`.
 * The operator can now answer "what's our throughput ?" without SSHing
 * into the worker host.
 *
 * Sections :
 *   1. Publication rate by time window (1h / 6h / 24h / 7d / 30d) with
 *      /hour and /day rates.
 *   2. Detection rate (sentinel intake).
 *   3. Pipeline_jobs throughput last 24h + current queue depth.
 *   4. Catalog status distribution with %-of-total bars.
 *   5. Blocked-bucket diagnosis : no-VOD games + clip_error retries.
 *
 * Pure server component. ~10 PostgREST trips in parallel. Cached for
 * 60 s — the snapshot doesn't change much faster than that and we
 * don't want a fast-clicking operator hammering the DB.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export const metadata = {
  title: "Production Rate — Admin",
  robots: { index: false, follow: false },
};

const STATUSES = [
  "raw",
  "enriched",
  "vod_found",
  "clipping",
  "clipped",
  "analyzed",
  "published",
  "clip_error",
  "manual_review",
] as const;

const PUB_WINDOWS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
];

interface CountResult {
  count: number | null;
}

async function fetchCounts(
  sb: Awaited<ReturnType<typeof createServerSupabase>>,
): Promise<{
  pubByWindow: Record<string, number>;
  detectByWindow: Record<string, number>;
  jobsLast24h: Record<string, number>;
  queueNow: Record<string, number>;
  statusDist: Record<string, number>;
  noVodCompleted: number;
  hasVodCompleted: number;
  vodFoundClipJobs: Record<string, number>;
  clipErrorByRetry: Record<number, number>;
}> {
  const now = Date.now();
  const yday = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  // Parallel fetch — most are head:true count queries, all independent.
  const pubResults = await Promise.all(
    PUB_WINDOWS.map(async ({ label, hours }) => {
      const since = new Date(now - hours * 60 * 60 * 1000).toISOString();
      const r = await sb
        .from("kills")
        .select("id", { count: "exact", head: true })
        .eq("status", "published")
        .gte("updated_at", since);
      return [label, r.count ?? 0] as const;
    }),
  );

  const detectResults = await Promise.all(
    PUB_WINDOWS.map(async ({ label, hours }) => {
      const since = new Date(now - hours * 60 * 60 * 1000).toISOString();
      const r = await sb
        .from("kills")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since);
      return [label, r.count ?? 0] as const;
    }),
  );

  const jobsLast24h = await Promise.all(
    (["succeeded", "failed", "dead_letter"] as const).map(async (s) => {
      const r = await sb
        .from("pipeline_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", s)
        .gte("updated_at", yday);
      return [s, r.count ?? 0] as const;
    }),
  );

  const queueNow = await Promise.all(
    (["pending", "claimed", "failed"] as const).map(async (s) => {
      const r = await sb
        .from("pipeline_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", s);
      return [s, r.count ?? 0] as const;
    }),
  );

  const statusDist = await Promise.all(
    STATUSES.map(async (s) => {
      const r = await sb
        .from("kills")
        .select("id", { count: "exact", head: true })
        .eq("status", s);
      return [s, r.count ?? 0] as const;
    }),
  );

  // Blocked diagnosis
  const noVodCompletedRes: CountResult = await sb
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("state", "completed")
    .is("vod_youtube_id", null);

  const hasVodCompletedRes: CountResult = await sb
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("state", "completed")
    .not("vod_youtube_id", "is", null);

  const clipJobsByStatus = await Promise.all(
    (["pending", "claimed", "failed"] as const).map(async (s) => {
      const r = await sb
        .from("pipeline_jobs")
        .select("id", { count: "exact", head: true })
        .eq("type", "clip.create")
        .eq("status", s);
      return [s, r.count ?? 0] as const;
    }),
  );

  // clip_error retry distribution — sample 1000 (cheap) and bucket
  const clipErrSample = await sb
    .from("kills")
    .select("retry_count")
    .eq("status", "clip_error")
    .limit(1000);
  const clipErrorByRetry: Record<number, number> = {};
  for (const row of clipErrSample.data ?? []) {
    const rc = (row as { retry_count?: number | null }).retry_count ?? 0;
    clipErrorByRetry[rc] = (clipErrorByRetry[rc] ?? 0) + 1;
  }

  return {
    pubByWindow: Object.fromEntries(pubResults),
    detectByWindow: Object.fromEntries(detectResults),
    jobsLast24h: Object.fromEntries(jobsLast24h),
    queueNow: Object.fromEntries(queueNow),
    statusDist: Object.fromEntries(statusDist),
    noVodCompleted: noVodCompletedRes.count ?? 0,
    hasVodCompleted: hasVodCompletedRes.count ?? 0,
    vodFoundClipJobs: Object.fromEntries(clipJobsByStatus),
    clipErrorByRetry,
  };
}

export default async function PipelineRatePage() {
  const sb = await createServerSupabase();
  const data = await fetchCounts(sb);

  const totalCatalog = Object.values(data.statusDist).reduce(
    (s, n) => s + n,
    0,
  );
  const recoverableClipErrors = Object.entries(data.clipErrorByRetry)
    .filter(([rc]) => Number(rc) < 5)
    .reduce((s, [, n]) => s + n, 0);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight text-[var(--gold)]">
            Production Rate
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Snapshot of pipeline throughput. Refreshed every 60 s.
          </p>
        </div>
        <AdminBadge variant="info">
          Mirror of <code className="font-mono">production_rate.py</code>
        </AdminBadge>
      </header>

      {/* ─── Publication rate ─── */}
      <AdminCard title="Publication rate">
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Kills moving to status=&apos;published&apos; (by updated_at)
        </p>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            <tr>
              <th className="text-left py-2">Window</th>
              <th className="text-right py-2">Published</th>
              <th className="text-right py-2">/hour</th>
              <th className="text-right py-2">/day</th>
            </tr>
          </thead>
          <tbody className="font-data">
            {PUB_WINDOWS.map(({ label, hours }) => {
              const n = data.pubByWindow[label] ?? 0;
              const rh = hours > 0 ? n / hours : 0;
              const rd = rh * 24;
              return (
                <tr
                  key={label}
                  className="border-t border-[var(--border-subtle)]"
                >
                  <td className="py-2 text-[var(--text-secondary)]">{label}</td>
                  <td className="py-2 text-right">{n}</td>
                  <td className="py-2 text-right">{rh.toFixed(2)}</td>
                  <td className="py-2 text-right">{rd.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </AdminCard>

      {/* ─── Detection rate ─── */}
      <AdminCard title="Detection rate">
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Sentinel + harvester intake (by created_at)
        </p>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            <tr>
              <th className="text-left py-2">Window</th>
              <th className="text-right py-2">Detected</th>
              <th className="text-right py-2">/hour</th>
            </tr>
          </thead>
          <tbody className="font-data">
            {PUB_WINDOWS.filter((w) => w.label !== "6h").map(
              ({ label, hours }) => {
                const n = data.detectByWindow[label] ?? 0;
                const rh = hours > 0 ? n / hours : 0;
                return (
                  <tr
                    key={label}
                    className="border-t border-[var(--border-subtle)]"
                  >
                    <td className="py-2 text-[var(--text-secondary)]">{label}</td>
                    <td className="py-2 text-right">{n}</td>
                    <td className="py-2 text-right">{rh.toFixed(2)}</td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </AdminCard>

      {/* ─── Jobs throughput ─── */}
      <div className="grid gap-4 md:grid-cols-2">
        <AdminCard title="Jobs throughput (24h)">
          <ul className="space-y-2 font-data">
            <li className="flex justify-between">
              <span className="text-[var(--text-muted)]">succeeded</span>
              <span className="text-[var(--green)] font-bold">
                {data.jobsLast24h["succeeded"] ?? 0}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-[var(--text-muted)]">failed</span>
              <span className="text-[var(--orange)] font-bold">
                {data.jobsLast24h["failed"] ?? 0}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-[var(--text-muted)]">dead_letter</span>
              <span
                className={
                  (data.jobsLast24h["dead_letter"] ?? 0) > 0
                    ? "text-[var(--red)] font-bold"
                    : "text-[var(--text-disabled)]"
                }
              >
                {data.jobsLast24h["dead_letter"] ?? 0}
              </span>
            </li>
          </ul>
        </AdminCard>

        <AdminCard title="Current queue depth">
          <ul className="space-y-2 font-data">
            <li className="flex justify-between">
              <span className="text-[var(--text-muted)]">pending</span>
              <span>{data.queueNow["pending"] ?? 0}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-[var(--text-muted)]">claimed</span>
              <span>{data.queueNow["claimed"] ?? 0}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-[var(--text-muted)]">failed (lifetime)</span>
              <span
                className={
                  (data.queueNow["failed"] ?? 0) > 1000
                    ? "text-[var(--orange)]"
                    : "text-[var(--text-secondary)]"
                }
              >
                {data.queueNow["failed"] ?? 0}
              </span>
            </li>
          </ul>
        </AdminCard>
      </div>

      {/* ─── Status distribution ─── */}
      <AdminCard title="Catalog status distribution">
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Total {totalCatalog} kills
        </p>
        <ul className="space-y-1.5 font-data text-sm">
          {STATUSES.map((s) => {
            const n = data.statusDist[s] ?? 0;
            const pct = totalCatalog > 0 ? (n / totalCatalog) * 100 : 0;
            const isPublished = s === "published";
            const isError = s === "clip_error";
            return (
              <li
                key={s}
                className="grid grid-cols-[100px_60px_50px_1fr] items-center gap-2"
              >
                <span
                  className={
                    isPublished
                      ? "text-[var(--gold)] font-bold"
                      : isError
                        ? "text-[var(--orange)]"
                        : "text-[var(--text-muted)]"
                  }
                >
                  {s}
                </span>
                <span className="text-right tabular-nums">{n}</span>
                <span className="text-right tabular-nums text-[var(--text-disabled)] text-xs">
                  {pct.toFixed(1)}%
                </span>
                <div className="h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                  <div
                    className={
                      "h-full rounded-full " +
                      (isPublished
                        ? "bg-[var(--gold)]"
                        : isError
                          ? "bg-[var(--orange)]"
                          : "bg-[var(--text-disabled)]")
                    }
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </AdminCard>

      {/* ─── Blocked-bucket diagnosis ─── */}
      <AdminCard title="Blocked-bucket diagnosis">
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Why kills sit where they sit
        </p>
        <div className="space-y-4 text-sm">
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
              No-VOD games (the source of most &apos;raw&apos; kills)
            </h3>
            <ul className="space-y-1 font-data">
              <li className="flex justify-between">
                <span className="text-[var(--text-muted)]">
                  state=completed, no VOD
                </span>
                <span
                  className={
                    data.noVodCompleted > 50
                      ? "text-[var(--orange)] font-bold"
                      : ""
                  }
                >
                  {data.noVodCompleted}
                </span>
              </li>
              <li className="flex justify-between">
                <span className="text-[var(--text-muted)]">
                  state=completed, has VOD
                </span>
                <span>{data.hasVodCompleted}</span>
              </li>
            </ul>
            {data.noVodCompleted > 50 && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Mostly gol.gg historical imports without YouTube broadcast
                links. Run <code>vod_hunter</code> against them, or accept
                as data-only.
              </p>
            )}
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
              clip.create job state
            </h3>
            <ul className="space-y-1 font-data">
              {(["pending", "claimed", "failed"] as const).map((s) => {
                const n = data.vodFoundClipJobs[s] ?? 0;
                return (
                  <li key={s} className="flex justify-between">
                    <span className="text-[var(--text-muted)]">{s}</span>
                    <span
                      className={
                        s === "failed" && n > 100
                          ? "text-[var(--orange)] font-bold"
                          : ""
                      }
                    >
                      {n}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
              clip_error retry distribution (sample 1000)
            </h3>
            <ul className="space-y-1 font-data">
              {Object.entries(data.clipErrorByRetry)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([rc, n]) => {
                  const max =
                    Math.max(
                      0,
                      ...Object.values(data.clipErrorByRetry),
                    ) || 1;
                  const pct = (n / max) * 100;
                  return (
                    <li
                      key={rc}
                      className="grid grid-cols-[110px_50px_1fr] items-center gap-2"
                    >
                      <span className="text-[var(--text-muted)]">
                        retry_count={rc}
                      </span>
                      <span className="tabular-nums">{n}</span>
                      <div className="h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--text-disabled)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
            </ul>
            {recoverableClipErrors > 0 && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                {recoverableClipErrors} have retry_count&lt;5 — most are
                already auto-cycled by <code>auto_fix_loop</code> ; manual{" "}
                <code>recover_exhausted_clip_errors.py</code> mostly hits
                duplicates.
              </p>
            )}
          </section>
        </div>
      </AdminCard>
    </div>
  );
}
