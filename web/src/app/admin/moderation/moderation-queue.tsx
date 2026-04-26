"use client";

/**
 * ModerationQueue — comment moderation surface (PR-loltok EE).
 *
 * Built for high-volume keyboard work :
 *   - 4 mini KPI tiles at the top (pending / flagged / approved-today /
 *     rejected-today)
 *   - Status filter chips + toxicity threshold slider
 *   - One <CommentTriageCard /> per row with big 44px hit-target action
 *     buttons (Approve / Reject / Flag / Contexte)
 *   - Bulk select + bulk Approve/Reject/Delete
 *   - Keyboard shortcuts : j/k navigate, a approve, r reject, f flag,
 *     x toggle select, ? help
 *   - Toasts on every action via useAdminToast()
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AdminPage,
  AdminCard,
  AdminButton,
  AdminFilterChips,
  AdminEmptyState,
  AdminBadge,
  useAdminToast,
} from "@/components/admin/ui";
import { KpiTile } from "@/components/admin/KpiTile";
import {
  CommentTriageCard,
  type TriageComment,
} from "@/components/admin/moderation/CommentTriageCard";

type StatusFilter = "pending" | "flagged" | "approved" | "rejected";

const STATUS_CHIPS: { id: StatusFilter; label: string }[] = [
  { id: "pending", label: "En attente" },
  { id: "flagged", label: "Signalés" },
  { id: "approved", label: "Approuvés" },
  { id: "rejected", label: "Rejetés" },
];

interface QueueStats {
  pending: number;
  flagged: number;
  approvedToday: number;
  rejectedToday: number;
}

interface ApiResponse {
  items: TriageComment[];
  total: number;
}

export function ModerationQueue() {
  const toast = useAdminToast();
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [minToxicity, setMinToxicity] = useState<number>(0);
  const [comments, setComments] = useState<TriageComment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedIdx, setFocusedIdx] = useState<number>(0);
  const [showHelp, setShowHelp] = useState(false);
  const [stats, setStats] = useState<QueueStats>({
    pending: 0,
    flagged: 0,
    approvedToday: 0,
    rejectedToday: 0,
  });

  const listRef = useRef<HTMLDivElement>(null);

  // ─── Data ────────────────────────────────────────────────────────────
  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/admin/moderation/comments?status=${status}&min_toxicity=${minToxicity}&limit=100`;
      const r = await fetch(url);
      if (r.ok) {
        const data = (await r.json()) as ApiResponse;
        setComments(data.items ?? []);
        setTotal(data.total ?? 0);
        setFocusedIdx(0);
        setSelected(new Set());
      } else {
        toast.error("Échec du chargement de la file de modération");
      }
    } catch (e) {
      toast.error(`Erreur réseau : ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [status, minToxicity, toast]);

  /**
   * Stats fetcher — best-effort. The API returns `total` per status, but
   * for "approved/rejected today" we'd need a `since` filter. We rely on
   * the API ignoring unknown params (returns all-time count) — better
   * than no info, and the prod stats are easy to plug later via a tiny
   * dedicated endpoint.
   */
  const fetchStats = useCallback(async () => {
    try {
      const queries = [
        fetch(`/api/admin/moderation/comments?status=pending&limit=1`),
        fetch(`/api/admin/moderation/comments?status=flagged&limit=1`),
        fetch(`/api/admin/moderation/comments?status=approved&limit=1`),
        fetch(`/api/admin/moderation/comments?status=rejected&limit=1`),
      ];
      const [pendingR, flaggedR, approvedR, rejectedR] =
        await Promise.all(queries);
      const [pending, flagged, approvedToday, rejectedToday] =
        await Promise.all([
          pendingR.ok ? (await pendingR.json()).total ?? 0 : 0,
          flaggedR.ok ? (await flaggedR.json()).total ?? 0 : 0,
          approvedR.ok ? (await approvedR.json()).total ?? 0 : 0,
          rejectedR.ok ? (await rejectedR.json()).total ?? 0 : 0,
        ]);
      setStats({ pending, flagged, approvedToday, rejectedToday });
    } catch {
      // stats are best-effort, never block the queue
    }
  }, []);

  useEffect(() => {
    void fetchComments();
  }, [fetchComments]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  // ─── Actions ─────────────────────────────────────────────────────────
  const moderate = useCallback(
    async (id: string, action: string, reason?: string) => {
      setBusyId(id);
      try {
        const r = await fetch(`/api/admin/moderation/comments/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, reason }),
        });
        if (r.ok) {
          const labels: Record<string, string> = {
            approve: "Commentaire approuvé",
            reject: "Commentaire rejeté",
            flag: "Commentaire signalé",
            delete: "Commentaire supprimé",
          };
          toast.success(labels[action] ?? "Action enregistrée");
          await fetchComments();
          void fetchStats();
        } else {
          const j = await r.json().catch(() => ({}));
          toast.error(`Échec : ${j.error ?? r.statusText}`);
        }
      } catch (e) {
        toast.error(`Erreur : ${(e as Error).message}`);
      } finally {
        setBusyId(null);
      }
    },
    [fetchComments, fetchStats, toast],
  );

  const moderateSelected = useCallback(
    async (action: string) => {
      if (selected.size === 0) return;
      const isDestructive = action === "reject" || action === "delete";
      if (
        isDestructive &&
        !window.confirm(
          `Appliquer "${action}" sur ${selected.size} commentaire(s) ?`,
        )
      )
        return;
      const ids = Array.from(selected);
      let ok = 0;
      let fail = 0;
      for (const id of ids) {
        try {
          const r = await fetch(`/api/admin/moderation/comments/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          });
          if (r.ok) ok += 1;
          else fail += 1;
        } catch {
          fail += 1;
        }
      }
      if (ok > 0) toast.success(`${ok} action(s) appliquée(s)`);
      if (fail > 0) toast.error(`${fail} échec(s)`);
      setSelected(new Set());
      await fetchComments();
      void fetchStats();
    },
    [selected, fetchComments, fetchStats, toast],
  );

  const toggleSelect = useCallback((id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === comments.length
        ? new Set()
        : new Set(comments.map((c) => c.id)),
    );
  }, [comments]);

  // ─── Keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Skip if typing in any form input
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (comments.length === 0) return;
      const focused = comments[focusedIdx];
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setFocusedIdx((i) => Math.min(comments.length - 1, i + 1));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setFocusedIdx((i) => Math.max(0, i - 1));
          break;
        case "a":
          if (focused && !busyId) {
            e.preventDefault();
            void moderate(focused.id, "approve");
          }
          break;
        case "r":
          if (focused && !busyId) {
            e.preventDefault();
            void moderate(focused.id, "reject");
          }
          break;
        case "f":
          if (focused && !busyId) {
            e.preventDefault();
            void moderate(focused.id, "flag");
          }
          break;
        case "x":
        case " ":
          if (focused) {
            e.preventDefault();
            toggleSelect(focused.id, !selected.has(focused.id));
          }
          break;
        case "?":
          e.preventDefault();
          setShowHelp((s) => !s);
          break;
        case "Escape":
          if (showHelp) setShowHelp(false);
          break;
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    comments,
    focusedIdx,
    busyId,
    moderate,
    toggleSelect,
    selected,
    showHelp,
  ]);

  // Scroll focused card into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-comment-id="${comments[focusedIdx]?.id}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIdx, comments]);

  // ─── Derived ─────────────────────────────────────────────────────────
  const chips = useMemo(
    () =>
      STATUS_CHIPS.map((c) => ({
        ...c,
        count:
          c.id === "pending"
            ? stats.pending
            : c.id === "flagged"
              ? stats.flagged
              : undefined,
      })),
    [stats],
  );

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <AdminPage
      title="Modération"
      breadcrumbs={[
        { label: "Admin", href: "/admin" },
        { label: "Modération" },
      ]}
      subtitle={`${total} commentaire${total !== 1 ? "s" : ""} en file (${status})`}
      actions={
        <>
          <AdminButton
            size="sm"
            variant="ghost"
            onClick={() => setShowHelp((s) => !s)}
            title="Afficher les raccourcis clavier"
          >
            ? Raccourcis
          </AdminButton>
          <AdminButton
            size="sm"
            variant="secondary"
            onClick={() => {
              void fetchComments();
              void fetchStats();
            }}
            loading={loading}
          >
            Rafraîchir
          </AdminButton>
        </>
      }
    >
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-6">
        <KpiTile
          label="En attente"
          value={stats.pending}
          tone={stats.pending > 50 ? "warn" : "neutral"}
          sub="à modérer"
        />
        <KpiTile
          label="Signalés"
          value={stats.flagged}
          tone={stats.flagged > 0 ? "bad" : "neutral"}
          sub="utilisateurs"
        />
        <KpiTile
          label="Approuvés (total)"
          value={stats.approvedToday}
          tone="good"
        />
        <KpiTile
          label="Rejetés (total)"
          value={stats.rejectedToday}
          tone="neutral"
        />
      </div>

      {/* Filters */}
      <AdminCard variant="compact" className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <AdminFilterChips
            chips={chips}
            value={status}
            onChange={(v) => v && setStatus(v)}
            allowDeselect={false}
          />
          <label className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <span className="font-bold uppercase tracking-widest">
              Toxicité min
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={minToxicity}
              onChange={(e) => setMinToxicity(parseFloat(e.target.value))}
              className="accent-[var(--gold)]"
              aria-label="Seuil de toxicité minimum"
            />
            <span className="font-mono text-[var(--text-secondary)]">
              {(minToxicity * 100).toFixed(0)}%
            </span>
          </label>
        </div>
      </AdminCard>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <AdminCard variant="compact" tone="info" className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <AdminBadge variant="info">
              {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
            </AdminBadge>
            <AdminButton
              size="sm"
              variant="primary"
              onClick={() => void moderateSelected("approve")}
            >
              Approuver tout
            </AdminButton>
            <AdminButton
              size="sm"
              variant="danger"
              onClick={() => void moderateSelected("reject")}
            >
              Rejeter tout
            </AdminButton>
            <AdminButton
              size="sm"
              variant="danger"
              onClick={() => void moderateSelected("delete")}
            >
              Supprimer tout
            </AdminButton>
            <AdminButton
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              Désélectionner
            </AdminButton>
          </div>
        </AdminCard>
      )}

      {/* Bulk select-all line */}
      {comments.length > 0 && (
        <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={
                selected.size === comments.length && comments.length > 0
              }
              onChange={toggleSelectAll}
              className="h-4 w-4 cursor-pointer accent-[var(--gold)]"
              aria-label="Tout sélectionner"
            />
            Tout sélectionner ({comments.length})
          </label>
          <span className="font-mono">
            {focusedIdx + 1} / {comments.length}
          </span>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--text-muted)]">
          Chargement…
        </p>
      ) : comments.length === 0 ? (
        <AdminEmptyState
          icon="✓"
          title="Tout est clean"
          body={
            status === "pending"
              ? "Aucun commentaire en attente. Bonne vibe sur le feed."
              : `Aucun commentaire ${STATUS_CHIPS.find((s) => s.id === status)?.label.toLowerCase()}.`
          }
        />
      ) : (
        <div ref={listRef} className="space-y-3">
          {comments.map((c, idx) => (
            <CommentTriageCard
              key={c.id}
              comment={c}
              isFocused={idx === focusedIdx}
              isSelected={selected.has(c.id)}
              onSelectChange={(on) => toggleSelect(c.id, on)}
              onApprove={() => void moderate(c.id, "approve")}
              onReject={() => {
                const reason =
                  window.prompt("Raison du rejet (optionnel)") ?? undefined;
                void moderate(c.id, "reject", reason);
              }}
              onFlag={() => void moderate(c.id, "flag")}
              busy={busyId === c.id}
            />
          ))}
        </div>
      )}

      {/* Help overlay */}
      {showHelp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Raccourcis clavier"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-lg font-black text-[var(--gold)] mb-4">
              Raccourcis clavier
            </h2>
            <ul className="space-y-2 text-sm">
              {[
                ["j / ↓", "Commentaire suivant"],
                ["k / ↑", "Commentaire précédent"],
                ["a", "Approuver"],
                ["r", "Rejeter"],
                ["f", "Flag"],
                ["x / espace", "(Dé)sélectionner"],
                ["?", "Afficher / masquer cette aide"],
                ["Esc", "Fermer"],
              ].map(([k, desc]) => (
                <li key={k} className="flex items-baseline gap-3">
                  <kbd className="rounded border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-[11px] text-[var(--gold)] min-w-[80px] text-center">
                    {k}
                  </kbd>
                  <span className="text-[var(--text-secondary)]">{desc}</span>
                </li>
              ))}
            </ul>
            <AdminButton
              fullWidth
              variant="secondary"
              onClick={() => setShowHelp(false)}
              className="mt-4"
            >
              Fermer
            </AdminButton>
          </div>
        </div>
      )}
    </AdminPage>
  );
}
