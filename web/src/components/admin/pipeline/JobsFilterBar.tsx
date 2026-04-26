"use client";

/**
 * JobsFilterBar — sticky filter strip for /admin/pipeline/jobs.
 *
 * Composes:
 *   - free-text search (entity_id / job id prefix)
 *   - status chips    (pending / claimed / succeeded / failed / cancelled)
 *   - kind chips      (clip.create / clip.analyze / og.generate / ...)
 *   - age toggle      (1h / 24h / 7d / all)
 *
 * Designed to be DRIVEN BY URL state in the parent — the parent owns the
 * state and passes callbacks. This keeps the bar dumb / reusable and lets
 * filters be deep-linkable (e.g. `?kind=clip.create&status=failed`).
 *
 * Mobile: collapses kind chips behind a "Filtres avancés" toggle so the
 * bar stays under one row at 375px.
 */
import { useState } from "react";

export type JobStatusKey =
  | "pending"
  | "claimed"
  | "succeeded"
  | "failed"
  | "cancelled";

export type JobAgeKey = "1h" | "24h" | "7d" | "all";

export const JOB_STATUSES: { value: JobStatusKey; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "claimed", label: "Claimed" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

export const JOB_AGES: { value: JobAgeKey; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7j" },
  { value: "all", label: "Tout" },
];

interface Props {
  /** Free-text search value (entity_id or job-id prefix). */
  search: string;
  onSearchChange: (next: string) => void;
  /** Set of selected statuses (empty = all statuses). */
  selectedStatuses: Set<JobStatusKey>;
  onToggleStatus: (s: JobStatusKey) => void;
  /** Set of selected kinds (empty = all kinds). */
  selectedKinds: Set<string>;
  onToggleKind: (k: string) => void;
  /** Available kinds — derived from current page data, parent provides. */
  availableKinds: string[];
  /** Age window. */
  age: JobAgeKey;
  onAgeChange: (next: JobAgeKey) => void;
  /** Reset all filters (called when "Effacer" is clicked). */
  onReset: () => void;
  /** Total + filtered counts displayed in the right of the bar. */
  totalCount?: number;
  filteredCount?: number;
}

export function JobsFilterBar({
  search,
  onSearchChange,
  selectedStatuses,
  onToggleStatus,
  selectedKinds,
  onToggleKind,
  availableKinds,
  age,
  onAgeChange,
  onReset,
  totalCount,
  filteredCount,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const hasFilters =
    search.length > 0 ||
    selectedStatuses.size > 0 ||
    selectedKinds.size > 0 ||
    age !== "24h";

  return (
    <div className="sticky top-14 z-20 -mx-6 px-6 py-3 border-b border-[var(--border-gold)] bg-[var(--bg-primary)]/95 backdrop-blur-md">
      <div className="flex flex-col gap-2">
        {/* Top row: search + age + reset */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Recherche par entity_id ou job id (prefix)…"
              aria-label="Recherche"
              className="w-full rounded-md border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]/60"
            />
          </div>
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Fenêtre temporelle">
            {JOB_AGES.map((opt) => {
              const active = opt.value === age;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onAgeChange(opt.value)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-bold tracking-widest uppercase ${
                    active
                      ? "border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[var(--gold)]"
                      : "border-[var(--border-gold)] text-[var(--text-muted)] hover:text-[var(--gold)]"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={onReset}
              className="rounded-md border border-[var(--border-gold)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--red)] hover:border-[var(--red)]/40"
              title="Effacer tous les filtres"
            >
              Effacer
            </button>
          )}
          {(typeof totalCount === "number" || typeof filteredCount === "number") && (
            <p className="ml-auto text-[10px] text-[var(--text-muted)] whitespace-nowrap">
              {typeof filteredCount === "number" ? filteredCount : "?"}{" "}
              {typeof totalCount === "number" && (
                <span className="opacity-60">/ {totalCount}</span>
              )}{" "}
              jobs
            </p>
          )}
        </div>

        {/* Status chips — always visible */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[9px] uppercase tracking-widest text-[var(--text-muted)] mr-1 shrink-0">
            Statut
          </span>
          {JOB_STATUSES.map((opt) => {
            const active = selectedStatuses.has(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => onToggleStatus(opt.value)}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                  active
                    ? STATUS_ACTIVE[opt.value]
                    : "border-[var(--border-gold)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Kind chips — collapsible on mobile */}
        {availableKinds.length > 0 && (
          <div className="flex items-start gap-1 flex-wrap">
            <span className="text-[9px] uppercase tracking-widest text-[var(--text-muted)] mr-1 shrink-0 pt-0.5">
              Type
            </span>
            <div className="md:hidden">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="rounded-full border border-[var(--border-gold)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]"
              >
                {advancedOpen ? "Masquer" : "Afficher"} ({availableKinds.length})
                {selectedKinds.size > 0 && (
                  <span className="ml-1 text-[var(--gold)]">· {selectedKinds.size}</span>
                )}
              </button>
            </div>
            <div
              className={`flex flex-wrap gap-1 ${
                advancedOpen ? "block" : "hidden md:flex"
              }`}
            >
              {availableKinds.map((kind) => {
                const active = selectedKinds.has(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onToggleKind(kind)}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-mono ${
                      active
                        ? "border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[var(--gold)]"
                        : "border-[var(--border-gold)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {kind}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_ACTIVE: Record<JobStatusKey, string> = {
  pending: "border-[var(--cyan)]/60 bg-[var(--cyan)]/15 text-[var(--cyan)]",
  claimed: "border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[var(--gold)]",
  succeeded: "border-[var(--green)]/60 bg-[var(--green)]/15 text-[var(--green)]",
  failed: "border-[var(--red)]/60 bg-[var(--red)]/15 text-[var(--red)]",
  cancelled:
    "border-[var(--text-muted)]/60 bg-[var(--text-muted)]/15 text-[var(--text-muted)]",
};
