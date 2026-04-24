"use client";

/**
 * Per-row actions on /admin/pipeline/jobs.
 *
 * Three buttons :
 *   - View    → navigate to /admin/pipeline/jobs/[id]
 *   - Cancel  → POST /api/admin/pipeline/jobs/[id]/cancel
 *               (only enabled when status in {pending, claimed})
 *   - Retry   → POST /api/admin/pipeline/jobs/[id]/retry
 *               (only enabled when status === 'failed')
 *
 * UX :
 *   - Optimistic disable + spinner during request
 *   - alert() on failure (no toast lib in the project yet)
 *   - router.refresh() on success — the server component re-renders
 *     and the row reflects the new state (or disappears, depending on
 *     active filters)
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Action = "cancel" | "retry";

export function JobRowActions({
  id,
  canCancel,
  canRetry,
}: {
  id: string;
  canCancel: boolean;
  canRetry: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [isPending, startTransition] = useTransition();

  async function act(action: Action) {
    if (busy) return;
    setBusy(action);
    try {
      const r = await fetch(`/api/admin/pipeline/jobs/${id}/${action}`, {
        method: "POST",
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        alert(`${action} failed: ${body.error ?? `HTTP ${r.status}`}`);
        setBusy(null);
        return;
      }
      // Trigger a server re-render so the row reflects the new status.
      // Use startTransition so React holds the spinner until the new
      // server payload is in.
      startTransition(() => {
        router.refresh();
      });
      // Clear busy on the next tick — the server-rendered row will
      // reset the local state by remounting under React keys.
      setTimeout(() => setBusy(null), 600);
    } catch (e) {
      alert(`${action} failed: ${e instanceof Error ? e.message : "request failed"}`);
      setBusy(null);
    }
  }

  const disabled = busy !== null || isPending;

  return (
    <div className="flex items-center gap-1 justify-end">
      <Link
        href={`/admin/pipeline/jobs/${id}`}
        className="rounded-md border border-[var(--border-gold)] px-2 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--gold)] hover:border-[var(--gold)]/60 whitespace-nowrap"
      >
        View
      </Link>
      <button
        type="button"
        onClick={() => act("cancel")}
        disabled={!canCancel || disabled}
        className="rounded-md border border-[var(--red)]/40 text-[var(--red)] text-[10px] px-2 py-1 disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-[var(--red)]/10 whitespace-nowrap"
        title={canCancel ? "Cancel this job" : "Only pending/claimed jobs can be cancelled"}
      >
        {busy === "cancel" ? "..." : "Cancel"}
      </button>
      <button
        type="button"
        onClick={() => act("retry")}
        disabled={!canRetry || disabled}
        className="rounded-md bg-[var(--gold)]/15 border border-[var(--gold)]/40 text-[var(--gold)] text-[10px] px-2 py-1 disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-[var(--gold)]/25 whitespace-nowrap"
        title={canRetry ? "Reset to pending and re-run" : "Only failed jobs can be retried"}
      >
        {busy === "retry" ? "..." : "Retry"}
      </button>
    </div>
  );
}
