"use client";

/**
 * AuditView — client wrapper for the audit log body (PR-loltok EE).
 *
 * Holds the view toggle (table / timeline) so the parent server page
 * can stay a server component and we don't have to refetch on toggle.
 * The view choice is persisted in the URL (?view=timeline) so admins
 * can bookmark their preferred mode.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuditRow } from "./audit-row";
import { AuditTimeline } from "@/components/admin/audit/AuditTimeline";
import { AdminButton } from "@/components/admin/ui";

interface Row {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_label: string | null;
  actor_role: string | null;
  before: unknown;
  after: unknown;
  notes: string | null;
  ip_hash: string | null;
  request_id: string | null;
  user_agent_class: string | null;
  created_at: string;
}

interface SearchParams {
  entity_type?: string;
  action?: string;
  actor?: string;
  q?: string;
  view?: string;
  from?: string;
  to?: string;
  page?: string;
  limit?: string;
}

interface Props {
  rows: Row[];
  initialView: "table" | "timeline";
  searchParams: SearchParams;
}

export function AuditView({ rows, initialView, searchParams }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [view, setView] = useState<"table" | "timeline">(initialView);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const switchView = (next: "table" | "timeline") => {
    setView(next);
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (next === "timeline") params.set("view", "timeline");
    else params.delete("view");
    // Reset page so the user lands at the start of the new view
    params.delete("page");
    router.replace(
      `/admin/audit${params.toString() ? `?${params.toString()}` : ""}`,
      {
        scroll: false,
      },
    );
  };

  // Avoid unused-var warning while keeping the prop available for
  // future enhancements (per-view filter ranges, etc.).
  void searchParams;

  /**
   * Client-side CSV export of the currently visible rows. Browsers
   * accept the resulting Blob URL via a synthesized <a download>. We
   * keep this client-side rather than wiring a /api/admin/audit/export
   * endpoint because the dataset is already in memory and admins
   * usually want what they see, not the un-paginated full table.
   */
  const exportCsv = useCallback(() => {
    if (rows.length === 0) return;
    const header = [
      "created_at",
      "action",
      "entity_type",
      "entity_id",
      "actor_label",
      "actor_role",
      "request_id",
      "ip_hash",
      "user_agent_class",
      "notes",
    ];
    const escape = (v: unknown): string => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.created_at,
          r.action,
          r.entity_type,
          r.entity_id ?? "",
          r.actor_label ?? "",
          r.actor_role ?? "",
          r.request_id ?? "",
          r.ip_hash ?? "",
          r.user_agent_class ?? "",
          r.notes ?? "",
        ]
          .map(escape)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [rows]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          {view === "table" ? "Actions (table)" : "Actions (timeline)"}
        </h2>
        <div className="flex items-center gap-2">
          <AdminButton
            size="sm"
            variant="secondary"
            onClick={exportCsv}
            disabled={rows.length === 0}
            title="Télécharger les actions visibles au format CSV"
          >
            <span aria-hidden="true">⬇</span> Export CSV
          </AdminButton>
          <div
            role="tablist"
            aria-label="Mode d'affichage"
            className="inline-flex rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] p-0.5 text-[11px]"
          >
            <button
              role="tab"
              aria-selected={view === "table"}
              type="button"
              onClick={() => switchView("table")}
              className={`px-3 py-1 rounded-md font-bold uppercase tracking-widest transition-colors ${
                view === "table"
                  ? "bg-[var(--gold)]/20 text-[var(--gold)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              Table
            </button>
            <button
              role="tab"
              aria-selected={view === "timeline"}
              type="button"
              onClick={() => switchView("timeline")}
              className={`px-3 py-1 rounded-md font-bold uppercase tracking-widest transition-colors ${
                view === "timeline"
                  ? "bg-[var(--gold)]/20 text-[var(--gold)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              Timeline
            </button>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
          Aucune action enregistrée pour ces filtres.
        </p>
      ) : view === "table" ? (
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30 overflow-hidden">
          {rows.map((row) => (
            <AuditRow key={row.id} row={row} />
          ))}
        </div>
      ) : (
        <AuditTimeline actions={rows} />
      )}
    </section>
  );
}
