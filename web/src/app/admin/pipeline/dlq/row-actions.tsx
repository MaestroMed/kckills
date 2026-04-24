"use client";

/**
 * Per-row action buttons on /admin/pipeline/dlq.
 *
 * Two endpoints behind these buttons :
 *   - POST /api/admin/pipeline/dlq/[id]/requeue
 *   - POST /api/admin/pipeline/dlq/[id]/cancel
 *
 * Optimistic-ish UX : the button enters a "working" state, then on
 * success we refresh() the page to drop the just-resolved row from
 * the list (the server view filters on resolution_status='pending').
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DlqRowActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"requeue" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "requeue" | "cancel") {
    if (busy) return;
    setError(null);
    setBusy(kind);
    try {
      const r = await fetch(`/api/admin/pipeline/dlq/${id}/${kind}`, {
        method: "POST",
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${r.status}`);
        setBusy(null);
        return;
      }
      // Drop the row by re-rendering the server component.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      {error && (
        <span className="text-[10px] text-[var(--red)] mr-1">{error}</span>
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
  );
}
