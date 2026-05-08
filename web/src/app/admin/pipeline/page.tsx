/**
 * /admin/pipeline — Observability dashboard.
 *
 * Server-rendered every 30s from :
 *   - v_pipeline_health   (per-module 1h success rate / throughput)
 *   - pipeline_jobs       (queue depth by status)
 *   - dead_letter_jobs    (DLQ depth)
 *   - pipeline_runs       (recent failures feed)
 *
 * We deliberately keep this an RSC : no client-side state, no
 * realtime subscription. Auto-refresh via `revalidate=30` keeps the
 * page fresh enough for an ops view while costing zero browser JS.
 *
 * Wave 12 EC : breadcrumbs, sparkline of runs/min last hour, click-to-
 * filter per-module rows that link to /admin/pipeline/jobs?kind=...,
 * AdminCard + AdminBadge consumed from EA primitives.
 */
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";

export const dynamic = "force-dynamic";
// 30s revalidation — the page is dynamic, but the layout hint here gives
// a soft TTL for any internal caches Next decides to enable.
export const revalidate = 30;

export const metadata = {
  title: "Pipeline — Admin",
  robots: { index: false, follow: false },
};

interface HealthRow {
  module_name: string;
  runs_1h: number | null;
  succeeded_1h: number | null;
  failed_1h: number | null;
  items_processed_1h: number | null;
  items_failed_1h: number | null;
  avg_duration_ms: number | null;
  last_run_at: string | null;
  last_success_at: string | null;
}

interface FailureRow {
  id: string;
  module_name: string;
  worker_id: string | null;
  started_at: string;
  ended_at: string | null;
  error_summary: string | null;
}

interface DlqRow {
  id: string;
  type: string;
  entity_id: string | null;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  failed_at: string;
}

export default async function PipelineDashboardPage() {
  const sb = await createServerSupabase();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [healthRes, jobsByStatusRes, dlqDepthRes, recentFailsRes, dlqRecentRes, runsLastHourRes] =
    await Promise.all([
      sb.from("v_pipeline_health").select("*"),
      // pipeline_jobs counts per status — three small queries are simpler
      // than a SQL group-by view and PostgREST returns the count in the
      // Content-Range header for free when we use head:true / count:exact.
      Promise.all(
        ["pending", "claimed", "succeeded", "failed", "cancelled"].map((s) =>
          sb
            .from("pipeline_jobs")
            .select("id", { count: "exact", head: true })
            .eq("status", s)
            .then((r) => ({ status: s, count: r.count ?? 0 }))
        )
      ),
      sb
        .from("dead_letter_jobs")
        .select("id", { count: "exact", head: true })
        .eq("resolution_status", "pending"),
      sb
        .from("pipeline_runs")
        .select("id, module_name, worker_id, started_at, ended_at, error_summary")
        .eq("status", "failed")
        .gte("started_at", oneDayAgo)
        .order("started_at", { ascending: false })
        .limit(20),
      sb
        .from("dead_letter_jobs")
        .select("id, type, entity_id, error_code, error_message, attempts, failed_at")
        .eq("resolution_status", "pending")
        .order("failed_at", { ascending: false })
        .limit(5),
      // Sparkline source: pipeline_runs.started_at within the last hour
      // bucketed per minute (60 buckets). We pull just `started_at` and
      // bucketize in JS — keeps the SQL trivial and the egress tiny.
      sb
        .from("pipeline_runs")
        .select("started_at")
        .gte("started_at", oneHourAgo)
        .order("started_at", { ascending: true })
        .limit(2000),
    ]);

  const health: HealthRow[] = (healthRes.data ?? []) as HealthRow[];
  const jobsByStatus: Record<string, number> = Object.fromEntries(
    jobsByStatusRes.map((r) => [r.status, r.count])
  );
  const dlqDepth = dlqDepthRes.count ?? 0;
  const recentFails: FailureRow[] = (recentFailsRes.data ?? []) as FailureRow[];
  const dlqRecent: DlqRow[] = (dlqRecentRes.data ?? []) as DlqRow[];
  const runsLastHour = (runsLastHourRes.data ?? []) as { started_at: string }[];

  // ─── KPI aggregates ──────────────────────────────────────────────
  const totalRuns1h = health.reduce((s, r) => s + (r.runs_1h ?? 0), 0);
  const totalSucceeded1h = health.reduce((s, r) => s + (r.succeeded_1h ?? 0), 0);
  const totalItems1h = health.reduce((s, r) => s + (r.items_processed_1h ?? 0), 0);
  const successRate1h = totalRuns1h > 0
    ? Math.round((totalSucceeded1h / totalRuns1h) * 100)
    : 100;

  // Sort modules : most failures first, then alphabetical.
  const sortedHealth = [...health].sort((a, b) => {
    const failsA = a.failed_1h ?? 0;
    const failsB = b.failed_1h ?? 0;
    if (failsA !== failsB) return failsB - failsA;
    return a.module_name.localeCompare(b.module_name);
  });

  // Map failures by module for last-error lookup
  const lastErrorByModule = new Map<string, FailureRow>();
  for (const f of recentFails) {
    if (!lastErrorByModule.has(f.module_name)) {
      // first occurrence in DESC order = the most recent
      const fAge = new Date(f.started_at).getTime();
      if (fAge >= new Date(oneHourAgo).getTime()) {
        lastErrorByModule.set(f.module_name, f);
      }
    }
  }

  // Sparkline buckets: 60 minutes ending now.
  const buckets = new Array<number>(60).fill(0);
  const cutoffMs = Date.now() - 60 * 60 * 1000;
  for (const r of runsLastHour) {
    const t = new Date(r.started_at).getTime();
    const idx = Math.floor((t - cutoffMs) / 60_000);
    if (idx >= 0 && idx < 60) buckets[idx]++;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <nav aria-label="Fil d'Ariane" className="text-[10px] text-[var(--text-muted)] mb-1 flex items-center gap-1.5">
            <Link href="/admin" className="hover:text-[var(--gold)]">Backoffice</Link>
            <span aria-hidden>›</span>
            <span className="text-[var(--text-secondary)]">Pipeline</span>
          </nav>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">
            Pipeline Health
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Auto-refresh toutes les 30s. Dernière maj :{" "}
            {new Date().toLocaleTimeString("fr-FR")}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/admin/pipeline/rate"
            className="rounded-md border border-[var(--cyan)]/60 bg-[var(--cyan)]/10 px-3 py-1.5 text-xs font-bold text-[var(--cyan)] hover:bg-[var(--cyan)]/20"
          >
            Production Rate
          </Link>
          <Link
            href="/admin/pipeline/run"
            className="rounded-md border border-[var(--gold)]/60 bg-[var(--gold)]/10 px-3 py-1.5 text-xs font-bold text-[var(--gold)] hover:bg-[var(--gold)]/20"
          >
            Backfills
          </Link>
          <Link
            href="/admin/pipeline/jobs"
            className="rounded-md border border-[var(--border-gold)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--gold)]"
          >
            Job Queue ({jobsByStatus.pending ?? 0})
          </Link>
          <Link
            href="/admin/pipeline/dlq"
            className={`rounded-md px-3 py-1.5 text-xs font-bold ${
              dlqDepth > 0
                ? "bg-[var(--red)] text-white"
                : "border border-[var(--border-gold)] text-[var(--text-muted)] hover:text-[var(--gold)]"
            }`}
          >
            Dead Letter ({dlqDepth})
          </Link>
        </div>
      </header>

      {/* ─── KPI cards ────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Runs (1h)"
          value={totalRuns1h.toLocaleString("fr-FR")}
          sub={`${health.length} module${health.length > 1 ? "s" : ""} actifs`}
        />
        <KpiCard
          label="Succès"
          value={`${successRate1h}%`}
          tone={
            successRate1h >= 95
              ? "good"
              : successRate1h >= 80
                ? "warn"
                : "bad"
          }
          sub={`${totalSucceeded1h}/${totalRuns1h}`}
        />
        <KpiCard
          label="Items / h"
          value={totalItems1h.toLocaleString("fr-FR")}
          sub="agrégé toutes modules"
        />
        <KpiCard
          label="DLQ"
          value={dlqDepth.toLocaleString("fr-FR")}
          tone={dlqDepth === 0 ? "good" : dlqDepth < 10 ? "warn" : "bad"}
          sub="failures pending"
        />
      </section>

      {/* ─── Sparkline (runs/min last 1h) ────────────────────────── */}
      <AdminCard
        title={`Runs / minute — dernière heure (total ${runsLastHour.length})`}
      >
        <Sparkline data={buckets} />
      </AdminCard>

      {/* ─── Job queue snapshot ─────────────────────────────────── */}
      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Job Queue (pipeline_jobs)
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <JobStatusCard label="Pending" value={jobsByStatus.pending ?? 0} tone="info" />
          <JobStatusCard label="Claimed" value={jobsByStatus.claimed ?? 0} tone="info" />
          <JobStatusCard label="Succeeded" value={jobsByStatus.succeeded ?? 0} tone="good" />
          <JobStatusCard label="Failed" value={jobsByStatus.failed ?? 0} tone="bad" />
          <JobStatusCard label="Cancelled" value={jobsByStatus.cancelled ?? 0} tone="muted" />
        </div>
      </section>

      {/* ─── Per-module grid ────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Per-module (last hour) — clique pour filtrer la queue
        </h2>
        {sortedHealth.length === 0 ? (
          <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
            Aucun run loggé dans la dernière heure. Le worker tourne-t-il ?
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sortedHealth.map((row) => (
              <ModuleCard
                key={row.module_name}
                row={row}
                lastError={lastErrorByModule.get(row.module_name) ?? null}
              />
            ))}
          </div>
        )}
      </section>

      {/* ─── DLQ tail ────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            Dead Letter — derniers échecs
          </h2>
          <Link
            href="/admin/pipeline/dlq"
            className="text-[10px] text-[var(--gold)] hover:underline"
          >
            View all →
          </Link>
        </div>
        {dlqRecent.length === 0 ? (
          <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
            Aucune défaillance en attente de triage.
          </p>
        ) : (
          <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30">
            {dlqRecent.map((d) => (
              <div
                key={d.id}
                className="px-3 py-2 grid grid-cols-12 gap-2 text-xs items-center"
              >
                <span className="col-span-2 font-mono text-[var(--gold)] truncate">
                  {d.type}
                </span>
                <span className="col-span-2 font-mono text-[10px] text-[var(--text-muted)] truncate">
                  {d.entity_id?.slice(0, 8) ?? "—"}
                </span>
                <span className="col-span-2 text-[var(--orange)] truncate">
                  {d.error_code ?? "unknown"}
                </span>
                <span className="col-span-4 text-[var(--text-muted)] truncate">
                  {d.error_message?.slice(0, 80) ?? ""}
                </span>
                <span className="col-span-1 text-right text-[var(--text-muted)]">
                  ×{d.attempts}
                </span>
                <span className="col-span-1 text-right text-[10px] text-[var(--text-muted)] whitespace-nowrap">
                  {relativeTime(d.failed_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  sub,
  tone = "info",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warn" | "bad" | "info";
}) {
  const accents: Record<string, string> = {
    good: "border-[var(--green)]/40 bg-[var(--green)]/5 text-[var(--green)]",
    warn: "border-[var(--orange)]/40 bg-[var(--orange)]/5 text-[var(--orange)]",
    bad: "border-[var(--red)]/40 bg-[var(--red)]/5 text-[var(--red)]",
    info: "border-[var(--border-gold)] bg-[var(--bg-surface)] text-[var(--gold)]",
  };
  return (
    <div className={`rounded-xl border p-4 ${accents[tone]}`}>
      <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <p className="font-display text-2xl font-black mt-1">{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-1">{sub}</p>}
    </div>
  );
}

function JobStatusCard({
  label,
  value,
  tone = "info",
}: {
  label: string;
  value: number;
  tone?: "good" | "bad" | "info" | "muted";
}) {
  const colors: Record<string, string> = {
    good: "text-[var(--green)]",
    bad: "text-[var(--red)]",
    info: "text-[var(--cyan)]",
    muted: "text-[var(--text-muted)]",
  };
  return (
    <div className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3">
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">
        {label}
      </p>
      <p className={`font-mono text-lg font-bold mt-0.5 ${colors[tone]}`}>
        {value.toLocaleString("fr-FR")}
      </p>
    </div>
  );
}

function ModuleCard({
  row,
  lastError,
}: {
  row: HealthRow;
  lastError: FailureRow | null;
}) {
  const runs = row.runs_1h ?? 0;
  const succeeded = row.succeeded_1h ?? 0;
  const failed = row.failed_1h ?? 0;
  const successRate = runs > 0 ? Math.round((succeeded / runs) * 100) : 100;
  const items = row.items_processed_1h ?? 0;
  const itemsFailed = row.items_failed_1h ?? 0;
  const avgMs = row.avg_duration_ms ?? 0;

  const tone =
    failed > 0
      ? "bad"
      : runs === 0
        ? "muted"
        : successRate < 80
          ? "warn"
          : "good";

  const borderColor: Record<string, string> = {
    good: "border-[var(--green)]/30",
    bad: "border-[var(--red)]/40",
    warn: "border-[var(--orange)]/40",
    muted: "border-[var(--border-gold)]",
  };
  const dotColor: Record<string, string> = {
    good: "bg-[var(--green)]",
    bad: "bg-[var(--red)] animate-pulse",
    warn: "bg-[var(--orange)]",
    muted: "bg-[var(--text-muted)]",
  };

  return (
    <Link
      href={`/admin/pipeline/jobs?kind=${encodeURIComponent(row.module_name)}`}
      className={`block rounded-xl border ${borderColor[tone]} bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)]/60 transition-colors`}
    >
      <header className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor[tone]}`} />
          <h3 className="font-mono text-sm font-bold text-[var(--text-primary)] truncate">
            {row.module_name}
          </h3>
          {failed > 0 && (
            <AdminBadge variant="danger" size="sm">{failed} fail</AdminBadge>
          )}
        </div>
        <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">
          {row.last_run_at ? relativeTime(row.last_run_at) : "—"}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-2 text-xs mt-3">
        <div>
          <p className="text-[9px] uppercase text-[var(--text-muted)] tracking-widest">
            Success
          </p>
          <p
            className={`font-mono text-base font-bold ${
              successRate >= 95
                ? "text-[var(--green)]"
                : successRate >= 80
                  ? "text-[var(--orange)]"
                  : "text-[var(--red)]"
            }`}
          >
            {successRate}%
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            {succeeded}/{runs}
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase text-[var(--text-muted)] tracking-widest">
            Throughput
          </p>
          <p className="font-mono text-base font-bold text-[var(--gold)]">
            {items.toLocaleString("fr-FR")}
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            items/h
            {itemsFailed > 0 ? ` · ${itemsFailed} ko` : ""}
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase text-[var(--text-muted)] tracking-widest">
            Avg duration
          </p>
          <p className="font-mono text-base font-bold text-[var(--cyan)]">
            {formatDuration(avgMs)}
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">per run</p>
        </div>
      </div>

      {lastError && (
        <div className="mt-3 rounded-md border border-[var(--red)]/30 bg-[var(--red)]/5 p-2">
          <p className="text-[9px] uppercase text-[var(--red)] tracking-widest">
            Last error · {relativeTime(lastError.started_at)}
          </p>
          <p className="text-[11px] text-[var(--text-secondary)] font-mono mt-0.5 line-clamp-2">
            {lastError.error_summary ?? "(no message)"}
          </p>
        </div>
      )}
    </Link>
  );
}

/**
 * Tiny inline sparkline — pure CSS / SVG, no chart lib. Bars are
 * normalised against the max bucket height so even quiet hours read.
 */
function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end h-16 gap-[1px]">
      {data.map((v, i) => {
        const pct = Math.round((v / max) * 100);
        return (
          <div
            key={i}
            className="flex-1 bg-[var(--cyan)]/60 rounded-t"
            style={{ height: `${Math.max(pct, v > 0 ? 4 : 1)}%` }}
            title={`${v} run${v > 1 ? "s" : ""} il y a ${60 - i}min`}
          />
        );
      })}
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
