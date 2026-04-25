/**
 * /admin/pipeline/dlq — Dead Letter Queue triage.
 *
 * Lists pending dead_letter_jobs with two actions per row :
 *   - Requeue : insert a fresh pipeline_jobs row with the same
 *               (type, entity_type, entity_id, payload) ; mark the DLQ
 *               row as `resolution_status='requeued'`.
 *   - Cancel  : mark the DLQ row as `resolution_status='cancelled'`
 *               without re-queueing — known issue / acceptable loss.
 *
 * Both per-row actions hit POST /api/admin/pipeline/dlq/[id]/{requeue,cancel}.
 *
 * Wave 9 P2 also adds bulk drain buttons that schedule the
 * scripts/dlq_drain.py script via /api/admin/pipeline/dlq/bulk —
 * useful when 800+ rows are pending and per-row clicks aren't realistic.
 */
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { DlqRowActions } from "./row-actions";
import { DlqBulkDrain } from "./bulk-drain";

export const dynamic = "force-dynamic";
export const revalidate = 30;

export const metadata = {
  title: "DLQ — Admin",
  robots: { index: false, follow: false },
};

interface DlqRow {
  id: string;
  original_job_id: string | null;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: unknown;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  failed_at: string;
}

export default async function DlqPage() {
  const sb = await createServerSupabase();

  const { data, error } = await sb
    .from("dead_letter_jobs")
    .select(
      "id, original_job_id, type, entity_type, entity_id, payload, error_code, error_message, attempts, failed_at"
    )
    .eq("resolution_status", "pending")
    .order("failed_at", { ascending: false })
    .limit(200);

  const rows: DlqRow[] = (data ?? []) as DlqRow[];

  // Group counts by error_code for the summary strip
  const byErrorCode = new Map<string, number>();
  for (const r of rows) {
    const k = r.error_code ?? "unknown";
    byErrorCode.set(k, (byErrorCode.get(k) ?? 0) + 1);
  }

  // Total counts by error_code across ALL pending DLQ rows (not just
  // the 200-row preview above) — gives the operator an accurate sense
  // of the backlog before they click "Drain now".
  const { data: allCodes } = await sb
    .from("dead_letter_jobs")
    .select("error_code")
    .eq("resolution_status", "pending");
  const totalByCode = new Map<string, number>();
  for (const r of (allCodes ?? []) as { error_code: string | null }[]) {
    const k = r.error_code ?? "unknown";
    totalByCode.set(k, (totalByCode.get(k) ?? 0) + 1);
  }
  const totalPending = (allCodes ?? []).length;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">
            Dead Letter Queue
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Jobs ayant épuisé leurs retries. Triage manuel ou drain
            automatique.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/pipeline"
            className="rounded-md border border-[var(--border-gold)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--gold)]"
          >
            ← Pipeline overview
          </Link>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-[var(--red)]/40 bg-[var(--red)]/5 p-6 text-sm text-[var(--red)]">
          Failed to load DLQ : {error.message}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--green)]/40 bg-[var(--green)]/5 p-8 text-center">
          <p className="font-display text-lg text-[var(--green)]">
            Inbox zero — la DLQ est vide.
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Tous les jobs ont passé ou sont en cours de retry.
          </p>
        </div>
      ) : (
        <>
          {/* Bulk drain controls — Wave 9 P2 */}
          <DlqBulkDrain totalPending={totalPending} />

          {/* Summary strip — counts per error_code (across ALL pending,
              not just the displayed 200-row preview) with sparkline-style
              relative bars. */}
          <section>
            <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
              Répartition par error_code ({totalPending} total)
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {[...totalByCode.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([code, count]) => {
                  const max = Math.max(
                    ...[...totalByCode.values()],
                    1,
                  );
                  const pct = Math.round((count / max) * 100);
                  return (
                    <div
                      key={code}
                      className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2"
                    >
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest truncate">
                        {code}
                      </p>
                      <div className="flex items-baseline justify-between gap-2 mt-1">
                        <p className="font-mono text-base font-bold text-[var(--orange)]">
                          {count}
                        </p>
                        <div
                          className="flex-1 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden ml-2"
                          aria-hidden
                        >
                          <div
                            className="h-full bg-[var(--orange)]/60"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>

          {/* Pending DLQ list (last 200) */}
          <section>
            <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
              Pending — derniers {rows.length}
            </h2>
            <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30">
              {rows.map((row) => (
                <DlqEntry key={row.id} row={row} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function DlqEntry({ row }: { row: DlqRow }) {
  return (
    <article className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="rounded-full bg-[var(--orange)]/15 text-[var(--orange)] text-[10px] font-bold px-2 py-0.5 uppercase tracking-widest whitespace-nowrap">
            {row.type}
          </span>
          {row.entity_id && (
            <span className="font-mono text-[10px] text-[var(--text-muted)] truncate">
              {row.entity_type ?? "?"}:{row.entity_id.slice(0, 8)}
            </span>
          )}
          <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">
            ×{row.attempts} attempts · {relativeTime(row.failed_at)}
          </span>
        </div>
        <DlqRowActions id={row.id} />
      </div>
      <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-[9px] uppercase text-[var(--text-muted)] tracking-widest">
            error_code
          </p>
          <p className="font-mono text-[var(--red)] mt-0.5">
            {row.error_code ?? "unknown"}
          </p>
        </div>
        <div className="md:col-span-2">
          <p className="text-[9px] uppercase text-[var(--text-muted)] tracking-widest">
            error_message
          </p>
          <p className="font-mono text-[var(--text-secondary)] mt-0.5 line-clamp-3">
            {row.error_message ?? "(no message)"}
          </p>
        </div>
      </div>
    </article>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
