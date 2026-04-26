"use client";

/**
 * Per-row + per-detail-page actions for pipeline_jobs.
 *
 * Renders View / Cancel / Retry buttons. Each button enforces its own
 * eligibility rule (cancellable when pending|claimed, retryable when
 * failed). Wraps the unified AdminButton primitive so styling matches
 * the rest of the admin shell.
 *
 * Action feedback is shown as a small floating toast at the top-right
 * of the viewport — same look as the queue page so the operator sees
 * "Job re-enqueued at priority 70" etc. without an alert() popup.
 *
 * On success we call router.refresh() so the parent (server component)
 * re-renders with the new job state.
 */
import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AdminButton } from "@/components/admin/ui/AdminButton";

type Action = "cancel" | "retry";

interface Toast {
  id: number;
  tone: "success" | "error";
  text: string;
}

let toastSeq = 0;

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
  const [, startTransition] = useTransition();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = (tone: Toast["tone"], text: string) => {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, tone, text }]);
  };

  // Auto-dismiss after 4s.
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = window.setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 4000);
    return () => window.clearTimeout(t);
  }, [toasts]);

  async function act(action: Action) {
    if (busy) return;
    setBusy(action);
    try {
      const r = await fetch(`/api/admin/pipeline/jobs/${id}/${action}`, {
        method: "POST",
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        pushToast(
          "error",
          `${labelFor(action)} échoué : ${body.error ?? `HTTP ${r.status}`}`,
        );
        setBusy(null);
        return;
      }
      pushToast(
        "success",
        action === "cancel"
          ? "Job annulé."
          : "Job remis en file (status pending, attempts=0).",
      );
      startTransition(() => {
        router.refresh();
      });
      setTimeout(() => setBusy(null), 600);
    } catch (e) {
      pushToast(
        "error",
        `${labelFor(action)} échoué : ${e instanceof Error ? e.message : "request failed"}`,
      );
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex items-center gap-1 justify-end">
        <Link
          href={`/admin/pipeline/jobs/${id}`}
          className="rounded-md border border-[var(--border-gold)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--gold)] hover:border-[var(--gold)]/60 whitespace-nowrap"
        >
          Voir
        </Link>
        <AdminButton
          type="button"
          variant="secondary"
          size="sm"
          loading={busy === "cancel"}
          disabled={!canCancel || busy !== null}
          onClick={() => act("cancel")}
          title={
            canCancel
              ? "Annuler ce job"
              : "Seuls les jobs pending/claimed sont annulables"
          }
        >
          Annuler
        </AdminButton>
        <AdminButton
          type="button"
          variant="primary"
          size="sm"
          loading={busy === "retry"}
          disabled={!canRetry || busy !== null}
          onClick={() => act("retry")}
          title={
            canRetry
              ? "Reset à pending et relance"
              : "Seuls les jobs failed sont retryables"
          }
        >
          Retry
        </AdminButton>
      </div>

      <div
        className="fixed top-20 right-4 z-50 space-y-2 pointer-events-none"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-3 py-2 text-xs font-medium shadow-2xl shadow-black/40 max-w-sm ${
              t.tone === "success"
                ? "border-[var(--green)]/60 bg-[var(--green)]/15 text-[var(--green)]"
                : "border-[var(--red)]/60 bg-[var(--red)]/15 text-[var(--red)]"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}

function labelFor(action: Action): string {
  return action === "cancel" ? "Annulation" : "Retry";
}
