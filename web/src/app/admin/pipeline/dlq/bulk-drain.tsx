"use client";

/**
 * Bulk DLQ drain controls — Wave 9 P2.
 *
 * Two buttons :
 *   "Aperçu drain" → POST with dry_run=true. The worker walks the DLQ
 *                    and reports what it WOULD do (requeue / cancel
 *                    counts per error_code) without writing.
 *   "Drain réel"   → POST with dry_run=false. Worker schedules the
 *                    real recovery as a worker.backfill job.
 *
 * Both go through /api/admin/pipeline/dlq/bulk which enqueues a
 * worker.backfill job ; the worker's admin_job_runner picks it up and
 * shells out to scripts/dlq_drain.py. Result lands in
 * pipeline_jobs.result so the operator can read stdout/stderr from
 * /admin/pipeline/jobs/[id].
 *
 * Filter inputs (since_days, error_code) live inline so the operator
 * can scope the drain without leaving the page. They mirror the script
 * CLI flags.
 */
import { useState } from "react";

interface DlqBulkDrainProps {
  totalPending: number;
}

export function DlqBulkDrain({ totalPending }: DlqBulkDrainProps) {
  const [sinceDays, setSinceDays] = useState<number>(7);
  const [errorCode, setErrorCode] = useState<string>("");
  const [limit, setLimit] = useState<number>(200);

  const [busy, setBusy] = useState<"preview" | "real" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function trigger(dryRun: boolean) {
    if (busy) return;
    setError(null);
    setResult(null);
    setBusy(dryRun ? "preview" : "real");
    try {
      const r = await fetch("/api/admin/pipeline/dlq/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "requeue",
          dry_run: dryRun,
          filter: {
            since_days: sinceDays,
            error_code: errorCode.trim() || undefined,
          },
          limit: limit > 0 ? limit : undefined,
        }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        error?: string;
        job?: { id?: string };
      };
      if (!r.ok) {
        setError(body.error ?? `HTTP ${r.status}`);
        setBusy(null);
        return;
      }
      const jobId = body.job?.id;
      setResult(
        dryRun
          ? `Aperçu lancé (job ${jobId?.slice(0, 8) ?? "?"}). Le résultat apparaîtra dans /admin/pipeline/jobs.`
          : `Drain lancé (job ${jobId?.slice(0, 8) ?? "?"}). Suivez le run depuis /admin/pipeline/jobs.`,
      );
      setBusy(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--gold)]/30 bg-[var(--bg-surface)] p-4 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="font-display text-sm font-bold text-[var(--gold)]">
          Drain en masse
        </h2>
        <p className="text-[10px] text-[var(--text-muted)]">
          {totalPending} ligne{totalPending > 1 ? "s" : ""} en attente
        </p>
      </div>

      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        Lance <span className="font-mono">scripts/dlq_drain.py</span> côté worker.
        Chaque ligne est analysée selon son <span className="font-mono">error_code</span> :
        recoverable → re-enqueue (priorité 30), ou cancel avec un motif.
        Idempotent — relancer ne double-enqueue pas.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            since_days
          </span>
          <input
            type="number"
            min={0}
            value={sinceDays}
            onChange={(e) => setSinceDays(Number(e.target.value) || 0)}
            disabled={busy !== null}
            className="rounded-md bg-[var(--bg-elevated)] border border-[var(--border-gold)]/40 px-2 py-1 font-mono text-[var(--text-primary)] disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            error_code (optionnel)
          </span>
          <input
            type="text"
            value={errorCode}
            onChange={(e) => setErrorCode(e.target.value)}
            placeholder="clip_failed, no_vod, ..."
            disabled={busy !== null}
            className="rounded-md bg-[var(--bg-elevated)] border border-[var(--border-gold)]/40 px-2 py-1 font-mono text-[var(--text-primary)] disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            limit (max lignes)
          </span>
          <input
            type="number"
            min={0}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 0)}
            disabled={busy !== null}
            className="rounded-md bg-[var(--bg-elevated)] border border-[var(--border-gold)]/40 px-2 py-1 font-mono text-[var(--text-primary)] disabled:opacity-50"
          />
        </label>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => trigger(true)}
          disabled={busy !== null}
          className="rounded-md border border-[var(--gold)]/40 text-[var(--gold)] text-xs font-bold px-3 py-1.5 disabled:opacity-50 disabled:cursor-wait hover:bg-[var(--gold)]/10"
        >
          {busy === "preview" ? "Aperçu en cours..." : "Aperçu drain (dry-run)"}
        </button>
        <button
          type="button"
          onClick={() => trigger(false)}
          disabled={busy !== null}
          className="rounded-md bg-[var(--gold)] text-black text-xs font-bold px-3 py-1.5 disabled:opacity-50 disabled:cursor-wait hover:bg-[var(--gold-bright)]"
        >
          {busy === "real" ? "Drain en cours..." : "Drain réel"}
        </button>
        {error && (
          <span className="text-[11px] text-[var(--red)]">{error}</span>
        )}
        {result && (
          <span className="text-[11px] text-[var(--green)]">{result}</span>
        )}
      </div>
    </section>
  );
}
