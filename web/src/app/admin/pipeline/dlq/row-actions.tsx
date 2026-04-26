"use client";

/**
 * Per-row action buttons on /admin/pipeline/dlq.
 *
 * Two endpoints behind these buttons :
 *   - POST /api/admin/pipeline/dlq/[id]/requeue
 *   - POST /api/admin/pipeline/dlq/[id]/cancel
 *
 * Plus a "Voir entité" link that points to the most useful surface for
 * the entity_type ('kill' → public clip page, otherwise → jobs queue
 * filtered by the entity_id so the operator can see sibling jobs).
 *
 * Optimistic-ish UX : the button enters a "working" state, then on
 * success we refresh() the page to drop the just-resolved row from
 * the list (the server view filters on resolution_status='pending').
 *
 * Action feedback uses a small floating toast at top-right.
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Toast {
  id: number;
  tone: "success" | "error";
  text: string;
}

let toastSeq = 0;

interface Props {
  id: string;
  entityType?: string | null;
  entityId?: string | null;
}

export function DlqRowActions({ id, entityType, entityId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"requeue" | "cancel" | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = (tone: Toast["tone"], text: string) => {
    const tid = ++toastSeq;
    setToasts((prev) => [...prev, { id: tid, tone, text }]);
  };

  useEffect(() => {
    if (toasts.length === 0) return;
    const t = window.setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 4000);
    return () => window.clearTimeout(t);
  }, [toasts]);

  async function act(kind: "requeue" | "cancel") {
    if (busy) return;
    setBusy(kind);
    try {
      const r = await fetch(`/api/admin/pipeline/dlq/${id}/${kind}`, {
        method: "POST",
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        pushToast("error", `${labelFor(kind)} échoué : ${body.error ?? `HTTP ${r.status}`}`);
        setBusy(null);
        return;
      }
      pushToast(
        "success",
        kind === "requeue"
          ? "DLQ row re-enqueued."
          : "DLQ row marked as cancelled.",
      );
      router.refresh();
    } catch (e) {
      pushToast(
        "error",
        `${labelFor(kind)} échoué : ${e instanceof Error ? e.message : "request failed"}`,
      );
      setBusy(null);
    }
  }

  const entityHref =
    entityType === "kill" && entityId
      ? `/kill/${entityId}`
      : entityId
        ? `/admin/pipeline/jobs?search=${encodeURIComponent(entityId)}`
        : null;

  return (
    <>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {entityHref && (
          <Link
            href={entityHref}
            className="rounded-md border border-[var(--border-gold)] text-[10px] text-[var(--text-muted)] hover:text-[var(--gold)] hover:border-[var(--gold)]/60 px-2 py-1 whitespace-nowrap"
            target={entityType === "kill" ? "_blank" : undefined}
            rel={entityType === "kill" ? "noreferrer" : undefined}
          >
            Voir entité
          </Link>
        )}
        <button
          type="button"
          onClick={() => act("requeue")}
          disabled={busy !== null}
          className="rounded-md bg-[var(--gold)] text-black text-[11px] font-bold px-3 py-1 disabled:opacity-50 disabled:cursor-wait hover:bg-[var(--gold-bright)]"
        >
          {busy === "requeue" ? "..." : "Requeue"}
        </button>
        <button
          type="button"
          onClick={() => act("cancel")}
          disabled={busy !== null}
          className="rounded-md border border-[var(--red)]/40 text-[var(--red)] text-[11px] px-3 py-1 disabled:opacity-50 disabled:cursor-wait hover:bg-[var(--red)]/10"
        >
          {busy === "cancel" ? "..." : "Cancel"}
        </button>
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

function labelFor(action: "requeue" | "cancel"): string {
  return action === "requeue" ? "Requeue" : "Cancel";
}
