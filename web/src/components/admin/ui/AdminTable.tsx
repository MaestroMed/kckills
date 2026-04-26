"use client";

import { Fragment, useMemo } from "react";
import type { ReactNode } from "react";
import { AdminEmptyState } from "./AdminEmptyState";
import { AdminSkeleton } from "./AdminSkeleton";

export type SortDirection = "asc" | "desc";

export interface AdminTableColumn<Row> {
  /** Stable id, also used as React key + sort key. */
  id: string;
  /** Header label. */
  header: ReactNode;
  /** Cell renderer. Receives the row + index. */
  cell: (row: Row, rowIndex: number) => ReactNode;
  /** Optional Tailwind width class (e.g. "w-32"). */
  width?: string;
  /** Right-align the cell + header (numeric columns). */
  align?: "left" | "right" | "center";
  /** Sticky-left column (e.g. for the row id / name). */
  sticky?: boolean;
  /** Mark sortable + show the sort affordance in the header. */
  sortable?: boolean;
  /** Hide on mobile. The mobile card view will skip these. */
  hideOnMobile?: boolean;
  /** Mobile card view label override (defaults to `header` if absent). */
  mobileLabel?: ReactNode;
}

export interface AdminTableSort {
  columnId: string;
  direction: SortDirection;
}

interface Props<Row> {
  rows: Row[];
  columns: AdminTableColumn<Row>[];
  /** Stable row key. Default: index — pass a real id to enable React reconciliation. */
  rowKey?: (row: Row, index: number) => string;
  /** Click anywhere on the row → call this. Adds row-hover affordance. */
  onRowClick?: (row: Row, index: number) => void;
  /** Current sort state (controlled). */
  sort?: AdminTableSort | null;
  /** Called when the user clicks a sortable header. */
  onSort?: (next: AdminTableSort) => void;
  /** Show skeleton rows instead of data. */
  loading?: boolean;
  /** Number of skeleton rows to render when loading. Default 5. */
  skeletonRows?: number;
  /** Custom empty state (when !loading && rows.length === 0). Defaults to <AdminEmptyState />. */
  emptyState?: ReactNode;
  /** Make header sticky (for tall lists). Requires the wrapper to be scrollable. */
  stickyHeader?: boolean;
  /** Outer wrapper class (e.g. "max-h-[60vh] overflow-auto"). */
  className?: string;
  /** ARIA label for the <table>. */
  ariaLabel?: string;
}

/**
 * AdminTable — unified table chrome for admin lists.
 *
 *   - Striped hover, bordered rows
 *   - Sortable headers (caller-controlled state via `sort` + `onSort`)
 *   - Optional sticky-left column + sticky header
 *   - Row click handler (selects entire row, with proper aria-button-ish semantics)
 *   - Loading skeleton + empty state delegated to siblings
 *   - Below md: collapses to a card stack so each row is readable on mobile
 *
 *   <AdminTable
 *     rows={jobs}
 *     rowKey={(j) => j.id}
 *     columns={[
 *       { id: "id", header: "ID", cell: (j) => truncateMiddle(j.id), sticky: true },
 *       { id: "status", header: "Status", cell: (j) => <StatusPill status={j.status} /> },
 *       { id: "created", header: "Créé", cell: (j) => relativeTime(j.created_at), sortable: true, align: "right" },
 *     ]}
 *     sort={sort}
 *     onSort={setSort}
 *     onRowClick={(j) => router.push(`/admin/pipeline/jobs/${j.id}`)}
 *   />
 */
export function AdminTable<Row>({
  rows,
  columns,
  rowKey,
  onRowClick,
  sort,
  onSort,
  loading = false,
  skeletonRows = 5,
  emptyState,
  stickyHeader = false,
  className = "",
  ariaLabel,
}: Props<Row>) {
  const visibleColumns = useMemo(() => columns, [columns]);

  // ── Loading state ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={className}>
        {/* Desktop loading: skeleton rows in real table layout */}
        <div className="hidden md:block">
          <table className="w-full" aria-label={ariaLabel}>
            <TableHead
              columns={visibleColumns}
              sort={sort}
              onSort={onSort}
              sticky={stickyHeader}
            />
            <tbody>
              {Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-[var(--border-subtle)]">
                  {visibleColumns.map((c) => (
                    <td key={c.id} className="px-3 py-3">
                      <AdminSkeleton variant="text" height="14px" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile loading: card skeletons */}
        <div className="md:hidden">
          <AdminSkeleton variant="row" count={skeletonRows} height="4.5rem" />
        </div>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────
  if (!rows || rows.length === 0) {
    return (
      <div className={className}>
        {emptyState ?? (
          <AdminEmptyState
            title="Aucun élément"
            body="Cette liste est vide pour le moment."
          />
        )}
      </div>
    );
  }

  // ── Data state ─────────────────────────────────────────────────────
  return (
    <div className={className}>
      {/* Desktop: real table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm" aria-label={ariaLabel}>
          <TableHead
            columns={visibleColumns}
            sort={sort}
            onSort={onSort}
            sticky={stickyHeader}
          />
          <tbody>
            {rows.map((row, i) => {
              const key = rowKey ? rowKey(row, i) : String(i);
              const clickable = Boolean(onRowClick);
              return (
                <tr
                  key={key}
                  onClick={clickable ? () => onRowClick?.(row, i) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick?.(row, i);
                          }
                        }
                      : undefined
                  }
                  tabIndex={clickable ? 0 : undefined}
                  role={clickable ? "button" : undefined}
                  className={`border-t border-[var(--border-subtle)] transition-colors ${
                    clickable
                      ? "cursor-pointer hover:bg-[var(--bg-elevated)]/60 focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-[-2px]"
                      : "hover:bg-[var(--bg-elevated)]/30"
                  }`}
                >
                  {visibleColumns.map((c) => (
                    <td
                      key={c.id}
                      className={[
                        "px-3 py-2.5 text-[var(--text-primary)]",
                        c.align === "right"
                          ? "text-right"
                          : c.align === "center"
                            ? "text-center"
                            : "",
                        c.sticky
                          ? "sticky left-0 bg-[var(--bg-surface)] z-10"
                          : "",
                        c.width ?? "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {c.cell(row, i)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: card stack */}
      <div className="md:hidden space-y-2">
        {rows.map((row, i) => {
          const key = rowKey ? rowKey(row, i) : String(i);
          const clickable = Boolean(onRowClick);
          const cardCols = visibleColumns.filter((c) => !c.hideOnMobile);
          return (
            <div
              key={key}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => onRowClick?.(row, i) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick?.(row, i);
                      }
                    }
                  : undefined
              }
              className={`rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3 ${
                clickable
                  ? "cursor-pointer hover:border-[var(--gold)]/40 focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
                  : ""
              }`}
            >
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs">
                {cardCols.map((c) => (
                  <Fragment key={c.id}>
                    <dt className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] font-bold pt-0.5">
                      {c.mobileLabel ?? c.header}
                    </dt>
                    <dd className="text-[var(--text-primary)] min-w-0 break-words">
                      {c.cell(row, i)}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TableHead<Row>({
  columns,
  sort,
  onSort,
  sticky,
}: {
  columns: AdminTableColumn<Row>[];
  sort?: AdminTableSort | null;
  onSort?: (next: AdminTableSort) => void;
  sticky?: boolean;
}) {
  return (
    <thead className={sticky ? "sticky top-0 z-20" : ""}>
      <tr className="bg-[var(--bg-elevated)]">
        {columns.map((c) => {
          const isSorted = sort?.columnId === c.id;
          const arrow = isSorted ? (sort?.direction === "asc" ? "▲" : "▼") : "";
          const ariaSort: "ascending" | "descending" | "none" | undefined = c.sortable
            ? isSorted
              ? sort?.direction === "asc"
                ? "ascending"
                : "descending"
              : "none"
            : undefined;

          const inner = (
            <span
              className={`inline-flex items-center gap-1 ${
                c.align === "right"
                  ? "ml-auto"
                  : c.align === "center"
                    ? "mx-auto"
                    : ""
              }`}
            >
              <span>{c.header}</span>
              {c.sortable ? (
                <span
                  aria-hidden="true"
                  className={`text-[8px] ${
                    isSorted ? "text-[var(--gold)]" : "text-[var(--text-muted)]/60"
                  }`}
                >
                  {arrow || "⇅"}
                </span>
              ) : null}
            </span>
          );

          return (
            <th
              key={c.id}
              scope="col"
              aria-sort={ariaSort}
              className={[
                "px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] border-b border-[var(--border-gold)]",
                c.align === "right"
                  ? "text-right"
                  : c.align === "center"
                    ? "text-center"
                    : "text-left",
                c.sticky ? "sticky left-0 bg-[var(--bg-elevated)] z-30" : "",
                c.width ?? "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {c.sortable && onSort ? (
                <button
                  type="button"
                  onClick={() => {
                    const nextDir: SortDirection =
                      isSorted && sort?.direction === "asc" ? "desc" : "asc";
                    onSort({ columnId: c.id, direction: nextDir });
                  }}
                  className="w-full inline-flex items-center hover:text-[var(--gold)] transition-colors"
                >
                  {inner}
                </button>
              ) : (
                inner
              )}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
