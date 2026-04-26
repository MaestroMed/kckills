"use client";

/**
 * JobsBulkActions — floating action bar for /admin/pipeline/jobs.
 *
 * Slides up from the bottom when N rows are selected. Shows:
 *   - count of selected rows
 *   - Cancel  (only enabled when >0 selected)
 *   - Retry   (only enabled when >0 selected)
 *   - Reprioritize (opens a small inline number input)
 *   - Clear selection (X)
 *
 * Posts to /api/admin/pipeline/jobs/bulk and emits a callback so the
 * parent can refresh its data and clear selection. Toast feedback is
 * fired by the parent (we keep this component dumb).
 *
 * Accessibility: the bar is a `region` with role="region" and
 * aria-live="polite" so screen readers hear the selection count update.
 */
import { useState } from "react";
import { AdminButton } from "@/components/admin/ui/AdminButton";

export interface BulkActionResult {
  ok: number;
  failed: number;
  skipped: number;
}

interface Props {
  selectedIds: string[];
  /** Called with the result counts after a successful POST. */
  onActionComplete: (action: "cancel" | "retry" | "reprioritize", result: BulkActionResult) => void;
  /** Called when an action errors out before reaching the bulk endpoint. */
  onError: (action: "cancel" | "retry" | "reprioritize", message: string) => void;
  /** Clear the selection (called from the X button). */
  onClear: () => void;
}

export function JobsBulkActions({
  selectedIds,
  onActionComplete,
  onError,
  onClear,
}: Props) {
  const [busy, setBusy] = useState<"cancel" | "retry" | "reprioritize" | null>(null);
  const [showPriority, setShowPriority] = useState(false);
  const [priority, setPriority] = useState<number>(70);

  const count = selectedIds.length;
  const visible = count > 0;

  async function run(action: "cancel" | "retry" | "reprioritize") {
    if (busy || count === 0) return;
    setBusy(action);
    try {
      const body: Record<string, unknown> = {
        action,
        job_ids: selectedIds,
      };
      if (action === "reprioritize") {
        body.priority = priority;
      }
      const r = await fetch("/api/admin/pipeline/jobs/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json().catch(() => ({}))) as {
        error?: string;
        counts?: BulkActionResult;
      };
      if (!r.ok) {
        onError(action, data.error ?? `HTTP ${r.status}`);
      } else if (data.counts) {
        onActionComplete(action, data.counts);
        if (action === "reprioritize") setShowPriority(false);
      }
    } catch (e) {
      onError(action, e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(null);
    }
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label={`${count} job${count > 1 ? "s" : ""} sélectionné${count > 1 ? "s" : ""}`}
      className="fixed bottom-4 right-4 left-4 md:left-auto md:right-6 md:bottom-6 z-40 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--gold)]/50 bg-[var(--bg-surface)] shadow-2xl shadow-black/50 px-4 py-3 animate-slide-up"
      style={{
        animation: "slide-up 200ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <style>{`@keyframes slide-up { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>

      <span className="font-mono text-xs text-[var(--gold)] mr-2 shrink-0">
        {count} sélectionné{count > 1 ? "s" : ""}
      </span>

      <AdminButton
        type="button"
        variant="secondary"
        size="sm"
        loading={busy === "cancel"}
        disabled={busy !== null}
        onClick={() => run("cancel")}
        title="Annuler les jobs pending/claimed sélectionnés"
      >
        Annuler
      </AdminButton>

      <AdminButton
        type="button"
        variant="primary"
        size="sm"
        loading={busy === "retry"}
        disabled={busy !== null}
        onClick={() => run("retry")}
        title="Re-enqueue les jobs failed sélectionnés"
      >
        Retry
      </AdminButton>

      {showPriority ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={100}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value) || 0)}
            className="w-16 rounded-md border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-2 py-1 text-xs font-mono text-[var(--text-primary)]"
            aria-label="Nouvelle priorité"
          />
          <AdminButton
            type="button"
            variant="primary"
            size="sm"
            loading={busy === "reprioritize"}
            disabled={busy !== null}
            onClick={() => run("reprioritize")}
          >
            Appliquer
          </AdminButton>
          <button
            type="button"
            onClick={() => setShowPriority(false)}
            className="text-[var(--text-muted)] hover:text-[var(--gold)] px-1"
            aria-label="Annuler la re-priorisation"
          >
            ×
          </button>
        </div>
      ) : (
        <AdminButton
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => setShowPriority(true)}
          title="Modifier la priorité (pending uniquement)"
        >
          Re-prioriser
        </AdminButton>
      )}

      <button
        type="button"
        onClick={onClear}
        disabled={busy !== null}
        aria-label="Vider la sélection"
        className="ml-auto rounded-md border border-[var(--border-gold)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--red)] hover:border-[var(--red)]/40 disabled:opacity-50"
      >
        ×
      </button>
    </div>
  );
}
