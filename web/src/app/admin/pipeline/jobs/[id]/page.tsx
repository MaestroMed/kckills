/**
 * /admin/pipeline/jobs/[id] — Single-job detail.
 *
 * Three sections :
 *   1. Header + lifecycle timeline (created → claimed → finished, with
 *      durations between each step).
 *   2. Full payload, result, last_error (formatted as JSON / pre).
 *   3. Linked entity preview when entity_type is recognised (kill,
 *      game, match, channel_video) + "sibling jobs" history (other
 *      pipeline_jobs rows for the same entity_id).
 *
 * Renders gracefully when migration 024 isn't applied (table missing
 * → friendly empty state instead of 500).
 */
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { JobRowActions } from "../job-row-actions";
import { AdminBadge, type AdminBadgeVariant } from "@/components/admin/ui/AdminBadge";

export const dynamic = "force-dynamic";
export const revalidate = 15;

export const metadata = {
  title: "Job detail — Admin",
  robots: { index: false, follow: false },
};

interface PipelineJobDetail {
  id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_by: string | null;
  locked_until: string | null;
  payload: unknown;
  last_error: string | null;
  result: unknown;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  finished_at: string | null;
}

interface SiblingJob {
  id: string;
  type: string;
  status: string;
  attempts: number;
  created_at: string;
  finished_at: string | null;
}

interface KillPreviewRow {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  ai_description: string | null;
  thumbnail_url: string | null;
  clip_url_vertical: string | null;
  status: string | null;
  avg_rating: number | null;
}

interface SupabaseLikeError {
  message?: string;
  code?: string;
}

function isTableMissing(error: SupabaseLikeError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  return /relation .* does not exist/i.test(error.message ?? "");
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!id) notFound();

  const sb = await createServerSupabase();

  const { data, error } = await sb
    .from("pipeline_jobs")
    .select(
      "id, type, entity_type, entity_id, status, priority, attempts, max_attempts, run_after, locked_by, locked_until, payload, last_error, result, created_at, updated_at, claimed_at, finished_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (isTableMissing(error)) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/pipeline/jobs"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--gold)]"
        >
          ← Job Queue
        </Link>
        <div className="rounded-xl border border-[var(--orange)]/40 bg-[var(--orange)]/5 p-6">
          <p className="font-display text-sm text-[var(--orange)]">
            Table <code className="font-mono">pipeline_jobs</code> introuvable.
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Migration 024 n&apos;a pas encore été appliquée.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/pipeline/jobs"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--gold)]"
        >
          ← Job Queue
        </Link>
        <div className="rounded-xl border border-[var(--red)]/40 bg-[var(--red)]/5 p-6 text-sm text-[var(--red)]">
          Failed to load job : {error.message}
        </div>
      </div>
    );
  }

  if (!data) notFound();
  const job = data as PipelineJobDetail;

  // ─── Sibling jobs (same entity) ────────────────────────────────────
  let siblings: SiblingJob[] = [];
  if (job.entity_id) {
    const sibQuery = sb
      .from("pipeline_jobs")
      .select("id, type, status, attempts, created_at, finished_at")
      .eq("entity_id", job.entity_id);
    const finalQuery = job.entity_type
      ? sibQuery.eq("entity_type", job.entity_type)
      : sibQuery;
    const { data: sibData } = await finalQuery
      .order("created_at", { ascending: false })
      .limit(20);
    siblings = ((sibData ?? []) as SiblingJob[]).filter((s) => s.id !== job.id);
  }

  // ─── Linked entity preview (kill only for now) ─────────────────────
  let killPreview: KillPreviewRow | null = null;
  if (job.entity_type === "kill" && job.entity_id) {
    const { data: kill } = await sb
      .from("kills")
      .select(
        "id, killer_champion, victim_champion, ai_description, thumbnail_url, clip_url_vertical, status, avg_rating"
      )
      .eq("id", job.entity_id)
      .maybeSingle();
    killPreview = (kill as KillPreviewRow | null) ?? null;
  }

  const isCancellable = job.status === "pending" || job.status === "claimed";
  const isRetryable = job.status === "failed";

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <nav
            aria-label="Fil d'Ariane"
            className="text-[10px] text-[var(--text-muted)] mb-1 flex items-center gap-1.5 flex-wrap"
          >
            <Link href="/admin/pipeline" className="hover:text-[var(--gold)]">
              Pipeline
            </Link>
            <span aria-hidden>›</span>
            <Link href="/admin/pipeline/jobs" className="hover:text-[var(--gold)]">
              Jobs
            </Link>
            <span aria-hidden>›</span>
            <span className="text-[var(--text-secondary)] font-mono">
              {job.type} {job.id.slice(0, 8)}
            </span>
          </nav>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <h1 className="font-display text-2xl font-black text-[var(--gold)]">
              {job.type}
            </h1>
            <AdminBadge
              variant={statusBadgeVariant(job.status)}
              size="md"
              pulse={job.status === "claimed"}
            >
              {job.status}
            </AdminBadge>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">
            {job.id}
          </p>
        </div>
        <div className="shrink-0 flex flex-wrap items-center gap-2">
          {killPreview && (
            <Link
              href={`/kill/${killPreview.id}`}
              className="rounded-md border border-[var(--border-gold)] px-3 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--gold)] hover:border-[var(--gold)]/60"
            >
              Voir le clip ↗
            </Link>
          )}
          <JobRowActions
            id={job.id}
            canCancel={isCancellable}
            canRetry={isRetryable}
          />
        </div>
      </header>

      {/* ─── Quick facts grid ─────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Fact label="Status" value={job.status} mono />
        <Fact
          label="Priority"
          value={String(job.priority)}
          mono
        />
        <Fact
          label="Attempts"
          value={`${job.attempts} / ${job.max_attempts}`}
          mono
          tone={
            job.attempts >= job.max_attempts
              ? "bad"
              : job.attempts > 0
                ? "warn"
                : "info"
          }
        />
        <Fact
          label="Run after"
          value={new Date(job.run_after).toLocaleString("fr-FR")}
          mono
        />
        <Fact
          label="Entity"
          value={
            job.entity_type
              ? `${job.entity_type}:${job.entity_id ?? ""}`
              : (job.entity_id ?? "—")
          }
          mono
        />
        <Fact label="Locked by" value={job.locked_by ?? "—"} mono />
        <Fact
          label="Lease until"
          value={
            job.locked_until
              ? new Date(job.locked_until).toLocaleString("fr-FR")
              : "—"
          }
          mono
        />
        <Fact
          label="Updated"
          value={new Date(job.updated_at).toLocaleString("fr-FR")}
          mono
        />
      </section>

      {/* ─── Lifecycle timeline ───────────────────────────────────── */}
      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Lifecycle
        </h2>
        <Timeline
          createdAt={job.created_at}
          claimedAt={job.claimed_at}
          finishedAt={job.finished_at}
          status={job.status}
        />
      </section>

      {/* ─── Payload + result + last_error ────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <JsonBlock label="payload" value={job.payload} />
        <JsonBlock
          label="result"
          value={job.result}
          tone={job.status === "succeeded" ? "good" : "info"}
        />
      </section>

      {job.last_error && (
        <section>
          <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--red)] mb-2">
            Last error
          </h2>
          <pre className="rounded-xl border border-[var(--red)]/40 bg-[var(--red)]/5 p-4 text-[11px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-words overflow-x-auto">
            {job.last_error}
          </pre>
        </section>
      )}

      {/* ─── Linked entity (kill preview) ─────────────────────────── */}
      {killPreview && (
        <section>
          <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
            Linked kill
          </h2>
          <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 flex flex-col md:flex-row gap-4">
            {killPreview.thumbnail_url ? (
              <Image
                src={killPreview.thumbnail_url}
                alt={
                  killPreview.killer_champion && killPreview.victim_champion
                    ? `${killPreview.killer_champion} kills ${killPreview.victim_champion}`
                    : "Kill thumbnail"
                }
                width={128}
                height={224}
                unoptimized
                className="w-32 h-56 object-cover rounded-lg border border-[var(--border-gold)] shrink-0"
              />
            ) : (
              <div className="w-32 h-56 rounded-lg border border-dashed border-[var(--border-gold)] flex items-center justify-center text-[10px] text-[var(--text-muted)] shrink-0">
                no thumb
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-2 text-xs">
              <p className="font-display text-base text-[var(--gold)]">
                {killPreview.killer_champion ?? "?"} →{" "}
                {killPreview.victim_champion ?? "?"}
              </p>
              {killPreview.ai_description && (
                <p className="text-[var(--text-secondary)] italic">
                  &ldquo;{killPreview.ai_description}&rdquo;
                </p>
              )}
              <div className="flex flex-wrap gap-3 text-[10px] text-[var(--text-muted)]">
                <span>kill_status: {killPreview.status ?? "?"}</span>
                <span>
                  rating:{" "}
                  {killPreview.avg_rating !== null
                    ? killPreview.avg_rating.toFixed(1)
                    : "—"}
                </span>
              </div>
              <div className="flex gap-2 pt-1">
                <Link
                  href={`/kill/${killPreview.id}`}
                  className="rounded-md bg-[var(--gold)] px-3 py-1 text-[11px] font-bold text-black hover:bg-[var(--gold-bright)]"
                >
                  View on site
                </Link>
                {killPreview.clip_url_vertical && (
                  <a
                    href={killPreview.clip_url_vertical}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-[var(--border-gold)] px-3 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--gold)]"
                  >
                    Raw clip ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ─── Sibling jobs ─────────────────────────────────────────── */}
      {job.entity_id && (
        <section>
          <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
            Sibling jobs (same entity){" "}
            <span className="text-[var(--text-disabled)]">
              ({siblings.length})
            </span>
          </h2>
          {siblings.length === 0 ? (
            <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-xs text-[var(--text-muted)]">
              Aucun autre job pour cette entité.
            </p>
          ) : (
            <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30">
              {siblings.map((s, i) => (
                <Link
                  key={s.id}
                  href={`/admin/pipeline/jobs/${s.id}`}
                  className={`flex items-center gap-3 px-3 py-2 text-xs hover:bg-[var(--bg-elevated)]/60 ${
                    i % 2 === 1 ? "bg-[var(--bg-elevated)]/40" : ""
                  }`}
                >
                  <span className="font-mono text-[var(--gold)] flex-1 truncate">
                    {s.type}
                  </span>
                  <StatusPill status={s.status} />
                  <span className="font-mono text-[10px] text-[var(--text-muted)] w-20 text-right">
                    ×{s.attempts}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] w-32 text-right">
                    {new Date(s.created_at).toLocaleString("fr-FR")}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function Fact({
  label,
  value,
  mono,
  tone = "info",
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "info" | "good" | "warn" | "bad";
}) {
  const valueColor: Record<string, string> = {
    info: "text-[var(--text-primary)]",
    good: "text-[var(--green)]",
    warn: "text-[var(--orange)]",
    bad: "text-[var(--red)]",
  };
  return (
    <div className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3">
      <p className="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <p
        className={`mt-0.5 text-xs ${mono ? "font-mono" : ""} ${valueColor[tone]} truncate`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, string> = {
    pending: "bg-[var(--cyan)]/15 text-[var(--cyan)] border-[var(--cyan)]/40",
    claimed: "bg-[var(--gold)]/15 text-[var(--gold)] border-[var(--gold)]/40 animate-pulse",
    succeeded: "bg-[var(--green)]/15 text-[var(--green)] border-[var(--green)]/40",
    failed: "bg-[var(--red)]/15 text-[var(--red)] border-[var(--red)]/40",
    cancelled: "bg-[var(--text-muted)]/15 text-[var(--text-muted)] border-[var(--text-muted)]/40",
  };
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest whitespace-nowrap ${
        palette[status] ?? palette.pending
      }`}
    >
      {status}
    </span>
  );
}

function StatusPillLarge({ status }: { status: string }) {
  const palette: Record<string, string> = {
    pending: "bg-[var(--cyan)]/15 text-[var(--cyan)] border-[var(--cyan)]/40",
    claimed: "bg-[var(--gold)]/15 text-[var(--gold)] border-[var(--gold)]/40 animate-pulse",
    succeeded: "bg-[var(--green)]/15 text-[var(--green)] border-[var(--green)]/40",
    failed: "bg-[var(--red)]/15 text-[var(--red)] border-[var(--red)]/40",
    cancelled: "bg-[var(--text-muted)]/15 text-[var(--text-muted)] border-[var(--text-muted)]/40",
  };
  return (
    <span
      className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${
        palette[status] ?? palette.pending
      }`}
    >
      {status}
    </span>
  );
}

function Timeline({
  createdAt,
  claimedAt,
  finishedAt,
  status,
}: {
  createdAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  status: string;
}) {
  const created = new Date(createdAt).getTime();
  const claimed = claimedAt ? new Date(claimedAt).getTime() : null;
  const finished = finishedAt ? new Date(finishedAt).getTime() : null;

  const queueWaitMs = claimed !== null ? claimed - created : null;
  const runMs =
    finished !== null && claimed !== null ? finished - claimed : null;
  const totalMs = finished !== null ? finished - created : null;

  return (
    <ol className="relative border-l-2 border-[var(--border-gold)] ml-2 pl-6 space-y-4">
      <Step
        when={createdAt}
        label="Created"
        sub="Inserted into queue"
        active
      />
      <Step
        when={claimedAt}
        label="Claimed"
        sub={
          queueWaitMs !== null
            ? `Waited ${formatDuration(queueWaitMs)} in queue`
            : status === "cancelled"
              ? "Cancelled before claim"
              : "Not yet claimed"
        }
        active={!!claimedAt}
      />
      <Step
        when={finishedAt}
        label={
          status === "succeeded"
            ? "Succeeded"
            : status === "failed"
              ? "Failed"
              : status === "cancelled"
                ? "Cancelled"
                : "Finished"
        }
        sub={
          runMs !== null
            ? `Ran for ${formatDuration(runMs)}` +
              (totalMs !== null ? ` · total ${formatDuration(totalMs)}` : "")
            : finished !== null
              ? `Total ${formatDuration(totalMs ?? 0)}`
              : "In progress"
        }
        active={!!finishedAt}
        tone={
          status === "failed" ? "bad" : status === "succeeded" ? "good" : "info"
        }
      />
    </ol>
  );
}

function Step({
  when,
  label,
  sub,
  active,
  tone = "info",
}: {
  when: string | null;
  label: string;
  sub: string;
  active: boolean;
  tone?: "info" | "good" | "bad";
}) {
  const dotColor: Record<string, string> = {
    info: "bg-[var(--cyan)]",
    good: "bg-[var(--green)]",
    bad: "bg-[var(--red)]",
  };
  return (
    <li className="relative">
      <span
        className={`absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-[var(--bg-primary)] ${
          active ? dotColor[tone] : "bg-[var(--text-disabled)]"
        }`}
      />
      <div className="text-xs">
        <p
          className={`font-display font-bold ${
            active ? "text-[var(--text-primary)]" : "text-[var(--text-disabled)]"
          }`}
        >
          {label}
        </p>
        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
          {when ? new Date(when).toLocaleString("fr-FR") : "—"} · {sub}
        </p>
      </div>
    </li>
  );
}

function JsonBlock({
  label,
  value,
  tone = "info",
}: {
  label: string;
  value: unknown;
  tone?: "info" | "good";
}) {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === "object" && value !== null && Object.keys(value as object).length === 0);
  const formatted = isEmpty ? "—" : safeStringify(value);
  const borderClass =
    tone === "good"
      ? "border-[var(--green)]/30 bg-[var(--green)]/5"
      : "border-[var(--border-gold)] bg-[var(--bg-surface)]";
  return (
    <div className={`rounded-xl border ${borderClass} p-3`}>
      <p className="text-[9px] uppercase tracking-widest text-[var(--text-muted)] mb-1">
        {label}
      </p>
      <pre className="text-[11px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-words overflow-x-auto max-h-[400px] overflow-y-auto">
        {formatted}
      </pre>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function statusBadgeVariant(status: string): AdminBadgeVariant {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "claimed":
      return "pending";
    case "pending":
      return "info";
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
