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
 * Both actions hit POST /api/admin/pipeline/dlq/[id]/{requeue,cancel}
 * which writes an admin_actions audit row before mutating state.
 */
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { DlqRowActions } from "./row-actions";

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

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">
            Dead Letter Queue
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Jobs ayant épuisé leurs retries. Triage manuel : requeue ou cancel.
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
          {/* Summary strip — counts per error_code */}
          <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {[...byErrorCode.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([code, count]) => (
                <div
                  key={code}
                  className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2"
                >
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest truncate">
                    {code}
                  </p>
                  <p className="font-mono text-base font-bold text-[var(--orange)]">
                    {count}
                  </p>
                </div>
              ))}
          </section>

          {/* Pending DLQ list */}
          <section>
            <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
              Pending ({rows.length})
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
