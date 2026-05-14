"use client";

/**
 * QuoteRowActions — Wave 31d row-level moderation actions for the
 * admin quotes panel. Renders Edit / Hide-Show / Delete buttons per
 * quote and POSTs to /api/admin/quotes/[id].
 *
 * Optimistic UI : on success we update local state immediately so the
 * row reflects the change without waiting for a server re-fetch. On
 * failure we surface a small inline toast and roll back.
 */

import { useState, useTransition } from "react";

interface Props {
  quoteId: string;
  initialText: string;
  initialHidden: boolean;
  initialMemetic: boolean;
  /** Optional callback the parent can pass to remove the row from the
   *  list on delete (without a full re-render). */
  onDeleted?: (id: string) => void;
}

type Toast = { tone: "ok" | "err"; text: string } | null;

export function QuoteRowActions({
  quoteId,
  initialText,
  initialHidden,
  initialMemetic,
  onDeleted,
}: Props) {
  const [text, setText] = useState(initialText);
  const [hidden, setHidden] = useState(initialHidden);
  const [memetic, setMemetic] = useState(initialMemetic);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialText);
  const [toast, setToast] = useState<Toast>(null);
  const [pending, startTransition] = useTransition();
  const [deleted, setDeleted] = useState(false);

  function flash(tone: Toast extends null ? never : NonNullable<Toast>["tone"], text: string) {
    setToast({ tone, text });
    setTimeout(() => setToast(null), 2500);
  }

  async function doAction(body: Record<string, unknown>): Promise<boolean> {
    try {
      const r = await fetch(`/api/admin/quotes/${quoteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        flash("err", err.error ?? `HTTP ${r.status}`);
        return false;
      }
      return true;
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Network error");
      return false;
    }
  }

  function toggleHide() {
    const next = !hidden;
    startTransition(async () => {
      const ok = await doAction({ action: next ? "hide" : "show" });
      if (ok) {
        setHidden(next);
        flash("ok", next ? "Masquée" : "Visible");
      }
    });
  }

  function toggleMemetic() {
    const next = !memetic;
    startTransition(async () => {
      const ok = await doAction({ action: "set_memetic", value: next });
      if (ok) {
        setMemetic(next);
        flash("ok", next ? "Marquée memetic" : "Memetic retiré");
      }
    });
  }

  function startEdit() {
    setDraft(text);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(text);
  }

  function saveEdit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === text) {
      cancelEdit();
      return;
    }
    startTransition(async () => {
      const ok = await doAction({ action: "edit", text: trimmed });
      if (ok) {
        setText(trimmed);
        setEditing(false);
        flash("ok", "Édité");
      }
    });
  }

  function confirmDelete() {
    const confirmed = window.confirm(
      "Supprimer définitivement cette quote ? Cette action n'est pas réversible.",
    );
    if (!confirmed) return;
    startTransition(async () => {
      const ok = await doAction({ action: "delete" });
      if (ok) {
        setDeleted(true);
        flash("ok", "Supprimée");
        if (onDeleted) {
          // Slight delay so the user sees the "deleted" state briefly
          setTimeout(() => onDeleted(quoteId), 800);
        }
      }
    });
  }

  if (deleted) {
    return (
      <div className="text-xs italic text-[var(--text-disabled)]">
        Quote supprimée.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Text — read or editable */}
      {editing ? (
        <div className="space-y-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full rounded-md border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
            aria-label="Quote text"
          />
          <div className="flex items-center gap-2 text-[10px]">
            <button
              type="button"
              onClick={saveEdit}
              disabled={pending}
              className="rounded border border-[var(--green)]/40 bg-[var(--green)]/10 px-2 py-0.5 font-bold uppercase tracking-widest text-[var(--green)] hover:bg-[var(--green)]/20 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={pending}
              className="rounded border border-[var(--border-gold)] px-2 py-0.5 font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Annuler
            </button>
            <span className="text-[var(--text-muted)] ml-auto">
              {draft.length} / 500
            </span>
          </div>
        </div>
      ) : (
        <p
          className={`text-sm italic ${
            hidden ? "text-[var(--text-disabled)] line-through" : "text-[var(--text-primary)]"
          }`}
        >
          « {text} »
        </p>
      )}

      {/* Action chips */}
      {!editing && (
        <div className="flex items-center gap-1.5 text-[10px]">
          <button
            type="button"
            onClick={startEdit}
            disabled={pending}
            className="rounded border border-[var(--border-gold)] px-2 py-0.5 font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40 disabled:opacity-50"
            aria-label="Éditer le texte"
          >
            Éditer
          </button>
          <button
            type="button"
            onClick={toggleHide}
            disabled={pending}
            className={`rounded border px-2 py-0.5 font-bold uppercase tracking-widest disabled:opacity-50 ${
              hidden
                ? "border-[var(--green)]/40 bg-[var(--green)]/10 text-[var(--green)] hover:bg-[var(--green)]/20"
                : "border-[var(--orange)]/40 bg-[var(--orange)]/10 text-[var(--orange)] hover:bg-[var(--orange)]/20"
            }`}
            aria-label={hidden ? "Rendre visible" : "Masquer"}
          >
            {hidden ? "Démasquer" : "Masquer"}
          </button>
          <button
            type="button"
            onClick={toggleMemetic}
            disabled={pending}
            className={`rounded border px-2 py-0.5 font-bold uppercase tracking-widest disabled:opacity-50 ${
              memetic
                ? "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/20"
                : "border-[var(--border-gold)] text-[var(--text-muted)] hover:text-[var(--gold)]"
            }`}
            aria-label={memetic ? "Retirer memetic" : "Marquer memetic"}
          >
            {memetic ? "Memetic ✓" : "Memetic"}
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={pending}
            className="rounded border border-[var(--red)]/40 bg-[var(--red)]/10 px-2 py-0.5 font-bold uppercase tracking-widest text-[var(--red)] hover:bg-[var(--red)]/20 disabled:opacity-50"
            aria-label="Supprimer"
          >
            Supprimer
          </button>
          {toast && (
            <span
              role="status"
              className={`ml-auto text-[10px] font-semibold ${
                toast.tone === "ok" ? "text-[var(--green)]" : "text-[var(--red)]"
              }`}
            >
              {toast.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
