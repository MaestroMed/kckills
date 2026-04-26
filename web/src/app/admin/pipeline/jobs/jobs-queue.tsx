"use client";

/**
 * /admin/pipeline/jobs — Job browser with filters, bulk actions, sortable
 * columns, and refresh control.
 *
 * Data source: pipeline_jobs (the modern queue table — same schema used
 * by /admin/pipeline/jobs/[id], cancel/retry endpoints, and the worker's
 * job_runner). The legacy worker_jobs table is still surfaced via the
 * /admin/pipeline/trigger flow ; this page intentionally does NOT mix
 * them so the operator always knows which queue they're acting on.
 *
 * Querying happens through the Supabase browser client (RLS still
 * applies but the admin layout guarantees auth before render).
 *
 * Filter state lives in URL query params so links are shareable :
 *   ?status=failed&kind=clip.create&age=24h&search=abc
 *
 * Bulk select uses uncontrolled <input type="checkbox"> — the parent
 * tracks selectedIds in a Set ; toggling a row mutates the Set and
 * triggers a re-render. The floating <JobsBulkActions/> appears when
 * the Set is non-empty.
 */
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import {
  JobsFilterBar,
  type JobAgeKey,
  type JobStatusKey,
} from "@/components/admin/pipeline/JobsFilterBar";
import {
  JobsBulkActions,
  type BulkActionResult,
} from "@/components/admin/pipeline/JobsBulkActions";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";
import { AdminButton } from "@/components/admin/ui/AdminButton";

interface PipelineJob {
  id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  finished_at: string | null;
}

type SortKey = "created_at" | "age" | "attempts";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;
const REFRESH_INTERVAL_MS = 15_000;

// kinds we expect — used as a fallback list before the first fetch.
const SEED_KINDS = [
  "clip.create",
  "clip.analyze",
  "og.generate",
  "publish.check",
  "worker.backfill",
  "channel.recon",
  "moderation.scan",
];

function parseAgeFilter(age: JobAgeKey): string | null {
  if (age === "all") return null;
  const ms = age === "1h" ? 3_600_000 : age === "24h" ? 86_400_000 : 7 * 86_400_000;
  return new Date(Date.now() - ms).toISOString();
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}j`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function statusVariant(
  status: string,
): "success" | "warn" | "danger" | "info" | "pending" | "neutral" {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "claimed":
      return "pending";
    case "pending":
      return "info";
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

interface ToastMessage {
  id: number;
  tone: "success" | "error" | "info";
  text: string;
}

let toastIdSeq = 0;

export function JobsQueue() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sb = useMemo(() => createBrowserSupabase(), []);

  // ─── filter state — backed by URL ────────────────────────────────
  const [search, setSearch] = useState<string>(
    () => searchParams.get("search") ?? "",
  );
  const [age, setAge] = useState<JobAgeKey>(
    () => (searchParams.get("age") as JobAgeKey | null) ?? "24h",
  );
  const [selectedStatuses, setSelectedStatuses] = useState<Set<JobStatusKey>>(() => {
    const raw = searchParams.get("status");
    if (!raw) return new Set();
    return new Set(raw.split(",").filter(Boolean) as JobStatusKey[]);
  });
  const [selectedKinds, setSelectedKinds] = useState<Set<string>>(() => {
    const raw = searchParams.get("kind");
    if (!raw) return new Set();
    return new Set(raw.split(",").filter(Boolean));
  });

  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ─── data state ──────────────────────────────────────────────────
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pageOffset, setPageOffset] = useState(0);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  // ─── selection ───────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ─── toasts ──────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const pushToast = useCallback((tone: ToastMessage["tone"], text: string) => {
    const id = ++toastIdSeq;
    setToasts((prev) => [...prev, { id, tone, text }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      4500,
    );
  }, []);

  // Persist filter state to URL on change.
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (age !== "24h") params.set("age", age);
    if (selectedStatuses.size > 0)
      params.set("status", [...selectedStatuses].join(","));
    if (selectedKinds.size > 0) params.set("kind", [...selectedKinds].join(","));
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }, [search, age, selectedStatuses, selectedKinds, router]);

  // ─── data fetcher ────────────────────────────────────────────────
  const fetchJobs = useCallback(
    async (
      opts: { append?: boolean; offset?: number; silent?: boolean } = {},
    ) => {
      const { append = false, offset = 0, silent = false } = opts;
      if (!silent) setLoading(true);
      setError(null);
      try {
        let query = sb
          .from("pipeline_jobs")
          .select(
            "id, type, entity_type, entity_id, status, priority, attempts, max_attempts, last_error, created_at, finished_at",
            { count: "exact" },
          );
        if (selectedStatuses.size > 0) {
          query = query.in("status", [...selectedStatuses]);
        }
        if (selectedKinds.size > 0) {
          query = query.in("type", [...selectedKinds]);
        }
        const ageCutoff = parseAgeFilter(age);
        if (ageCutoff) {
          query = query.gte("created_at", ageCutoff);
        }
        if (search.trim().length > 0) {
          const s = search.trim();
          // PostgREST `or` syntax — accept full or prefix match on
          // job id or entity_id.
          query = query.or(`id.ilike.${s}%,entity_id.ilike.${s}%`);
        }

        // sort
        const ascending = sortDir === "asc";
        const sortColumn = sortKey === "age" ? "created_at" : sortKey;
        // age is created_at viewed as "older = bigger" — flip the
        // direction so the operator's mental model holds.
        const realAscending = sortKey === "age" ? !ascending : ascending;
        query = query.order(sortColumn, { ascending: realAscending });

        query = query.range(offset, offset + PAGE_SIZE - 1);

        const { data, error: qErr, count } = await query;
        if (qErr) {
          if (
            qErr.code === "42P01" ||
            /relation .* does not exist/i.test(qErr.message)
          ) {
            setError(
              "Table pipeline_jobs introuvable — migration 024 non appliquée.",
            );
            setJobs([]);
            setTotalCount(0);
            setHasMore(false);
            return;
          }
          setError(qErr.message);
          if (!append) setJobs([]);
          return;
        }
        const rows = (data ?? []) as PipelineJob[];
        setTotalCount(count ?? null);
        setHasMore(rows.length === PAGE_SIZE);
        setJobs((prev) => (append ? [...prev, ...rows] : rows));
        setLastRefreshedAt(new Date());
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [sb, selectedStatuses, selectedKinds, age, search, sortKey, sortDir],
  );

  // Reset offset on filter / sort change.
  useEffect(() => {
    setPageOffset(0);
    void fetchJobs({ offset: 0 });
  }, [fetchJobs]);

  // Auto-refresh (silent — no spinner flash on a fresh tab).
  const refreshTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!autoRefresh) {
      if (refreshTimer.current) {
        window.clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
      return;
    }
    refreshTimer.current = window.setInterval(() => {
      void fetchJobs({ offset: 0, silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => {
      if (refreshTimer.current) window.clearInterval(refreshTimer.current);
    };
  }, [autoRefresh, fetchJobs]);

  // ─── derived ─────────────────────────────────────────────────────
  const availableKinds = useMemo(() => {
    const set = new Set<string>(SEED_KINDS);
    for (const j of jobs) set.add(j.type);
    return [...set].sort();
  }, [jobs]);

  const allOnPageSelected =
    jobs.length > 0 && jobs.every((j) => selectedIds.has(j.id));
  const someOnPageSelected =
    !allOnPageSelected && jobs.some((j) => selectedIds.has(j.id));

  // ─── handlers ────────────────────────────────────────────────────
  function toggleStatus(s: JobStatusKey) {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }
  function toggleKind(k: string) {
    setSelectedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }
  function resetFilters() {
    setSearch("");
    setAge("24h");
    setSelectedStatuses(new Set());
    setSelectedKinds(new Set());
  }
  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const j of jobs) next.delete(j.id);
      } else {
        for (const j of jobs) next.add(j.id);
      }
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }
  function changeSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }
  function loadMore() {
    const nextOffset = pageOffset + PAGE_SIZE;
    setPageOffset(nextOffset);
    void fetchJobs({ append: true, offset: nextOffset });
  }
  function handleBulkComplete(
    action: "cancel" | "retry" | "reprioritize",
    res: BulkActionResult,
  ) {
    const verb =
      action === "cancel"
        ? "annulés"
        : action === "retry"
          ? "relancés"
          : "re-priorisés";
    pushToast(
      res.failed > 0 ? "info" : "success",
      `${res.ok} jobs ${verb}` +
        (res.failed > 0 ? ` · ${res.failed} échecs` : "") +
        (res.skipped > 0 ? ` · ${res.skipped} ignorés` : ""),
    );
    clearSelection();
    void fetchJobs({ offset: 0, silent: true });
  }
  function handleBulkError(
    action: "cancel" | "retry" | "reprioritize",
    message: string,
  ) {
    const verb =
      action === "cancel"
        ? "annulation"
        : action === "retry"
          ? "retry"
          : "re-priorisation";
    pushToast("error", `Erreur ${verb} : ${message}`);
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <nav
            aria-label="Fil d'Ariane"
            className="text-[10px] text-[var(--text-muted)] mb-1 flex items-center gap-1.5"
          >
            <Link href="/admin/pipeline" className="hover:text-[var(--gold)]">
              Pipeline
            </Link>
            <span aria-hidden>›</span>
            <span className="text-[var(--text-secondary)]">Jobs</span>
          </nav>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">
            Job Queue
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {lastRefreshedAt
              ? `Dernière maj : ${lastRefreshedAt.toLocaleTimeString("fr-FR")}`
              : "—"}
            {" · "}
            <button
              type="button"
              onClick={() => setAutoRefresh((v) => !v)}
              className="underline hover:text-[var(--gold)]"
            >
              auto-refresh {autoRefresh ? "ON (15s)" : "OFF"}
            </button>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AdminButton
            type="button"
            variant="secondary"
            size="sm"
            loading={loading}
            onClick={() => void fetchJobs({ offset: 0 })}
          >
            Refresh
          </AdminButton>
          <Link
            href="/admin/pipeline/run"
            className="rounded-md bg-[var(--gold)] px-3 py-1.5 text-xs font-bold text-black hover:bg-[var(--gold-bright)]"
          >
            Lancer un script
          </Link>
        </div>
      </header>

      <JobsFilterBar
        search={search}
        onSearchChange={setSearch}
        selectedStatuses={selectedStatuses}
        onToggleStatus={toggleStatus}
        selectedKinds={selectedKinds}
        onToggleKind={toggleKind}
        availableKinds={availableKinds}
        age={age}
        onAgeChange={setAge}
        onReset={resetFilters}
        totalCount={totalCount ?? undefined}
        filteredCount={jobs.length}
      />

      {error && (
        <div className="rounded-xl border border-[var(--red)]/40 bg-[var(--red)]/5 p-4 text-sm text-[var(--red)]">
          {error}
        </div>
      )}

      {!error && loading && jobs.length === 0 ? (
        <SkeletonRows />
      ) : !error && jobs.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="font-display text-base text-[var(--text-secondary)]">
            Aucun job ne correspond aux filtres.
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Élargis la fenêtre temporelle ou réinitialise les filtres.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden md:block rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-elevated)] border-b border-[var(--border-gold)] text-left">
                <tr>
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someOnPageSelected;
                      }}
                      onChange={toggleAllOnPage}
                      aria-label="Sélectionner toute la page"
                      className="h-4 w-4 rounded border-[var(--border-gold)] bg-[var(--bg-primary)]"
                    />
                  </th>
                  <th className="px-3 py-2 w-24">Id</th>
                  <th className="px-3 py-2 w-44">Kind</th>
                  <th className="px-3 py-2 w-28">Status</th>
                  <th className="px-3 py-2 w-32">Entity</th>
                  <SortableTh
                    label="Attempts"
                    activeKey={sortKey}
                    sortDir={sortDir}
                    columnKey="attempts"
                    onSort={changeSort}
                    className="w-20"
                  />
                  <SortableTh
                    label="Age"
                    activeKey={sortKey}
                    sortDir={sortDir}
                    columnKey="age"
                    onSort={changeSort}
                    className="w-16"
                  />
                  <th className="px-3 py-2">Last error / payload</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className={`border-b border-[var(--border-gold)]/20 hover:bg-[var(--bg-elevated)]/40 ${
                      selectedIds.has(job.id) ? "bg-[var(--gold)]/5" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(job.id)}
                        onChange={() => toggleSelection(job.id)}
                        aria-label={`Sélectionner job ${shortId(job.id)}`}
                        className="h-4 w-4 rounded border-[var(--border-gold)] bg-[var(--bg-primary)]"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px]">
                      <Link
                        href={`/admin/pipeline/jobs/${job.id}`}
                        className="text-[var(--gold)] hover:underline"
                      >
                        {shortId(job.id)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-[var(--text-primary)]">
                      {job.type}
                    </td>
                    <td className="px-3 py-2">
                      <AdminBadge
                        variant={statusVariant(job.status)}
                        pulse={job.status === "claimed"}
                      >
                        {job.status}
                      </AdminBadge>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-[var(--text-muted)]">
                      {job.entity_id ? (
                        <span title={`${job.entity_type ?? "?"}:${job.entity_id}`}>
                          {job.entity_type ?? "?"}:{shortId(job.entity_id)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 font-mono ${
                        job.attempts >= job.max_attempts
                          ? "text-[var(--red)]"
                          : job.attempts > 0
                            ? "text-[var(--orange)]"
                            : "text-[var(--text-muted)]"
                      }`}
                    >
                      {job.attempts}/{job.max_attempts}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-[var(--text-muted)]">
                      {relativeTime(job.created_at)}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {job.last_error ? (
                        <span className="text-[var(--red)] line-clamp-1 font-mono text-[10px]">
                          {job.last_error.slice(0, 120)}
                        </span>
                      ) : (
                        <span className="opacity-50">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: card stack */}
          <div className="md:hidden space-y-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                className={`rounded-lg border bg-[var(--bg-surface)] p-3 ${
                  selectedIds.has(job.id)
                    ? "border-[var(--gold)]/60"
                    : "border-[var(--border-gold)]"
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(job.id)}
                    onChange={() => toggleSelection(job.id)}
                    aria-label={`Sélectionner job ${shortId(job.id)}`}
                    className="h-4 w-4 rounded border-[var(--border-gold)] bg-[var(--bg-primary)]"
                  />
                  <Link
                    href={`/admin/pipeline/jobs/${job.id}`}
                    className="font-mono text-[10px] text-[var(--gold)]"
                  >
                    {shortId(job.id)}
                  </Link>
                  <AdminBadge
                    variant={statusVariant(job.status)}
                    pulse={job.status === "claimed"}
                  >
                    {job.status}
                  </AdminBadge>
                  <span className="ml-auto text-[10px] text-[var(--text-muted)] font-mono">
                    {relativeTime(job.created_at)}
                  </span>
                </div>
                <p className="font-mono text-xs text-[var(--text-primary)]">
                  {job.type}
                </p>
                {job.entity_id && (
                  <p className="font-mono text-[10px] text-[var(--text-muted)] mt-0.5">
                    {job.entity_type ?? "?"}:{shortId(job.entity_id)}
                  </p>
                )}
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  attempts {job.attempts}/{job.max_attempts}
                </p>
                {job.last_error && (
                  <p className="font-mono text-[10px] text-[var(--red)] line-clamp-2 mt-1">
                    {job.last_error.slice(0, 200)}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <AdminButton
                type="button"
                variant="secondary"
                size="sm"
                loading={loading}
                onClick={loadMore}
              >
                Charger {PAGE_SIZE} de plus
              </AdminButton>
            </div>
          )}
        </>
      )}

      {/* Bulk actions */}
      <JobsBulkActions
        selectedIds={[...selectedIds]}
        onActionComplete={handleBulkComplete}
        onError={handleBulkError}
        onClear={clearSelection}
      />

      {/* Toast stack */}
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
                : t.tone === "error"
                  ? "border-[var(--red)]/60 bg-[var(--red)]/15 text-[var(--red)]"
                  : "border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[var(--gold)]"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function SortableTh({
  label,
  columnKey,
  activeKey,
  sortDir,
  onSort,
  className = "",
}: {
  label: string;
  columnKey: SortKey;
  activeKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = activeKey === columnKey;
  return (
    <th className={`px-3 py-2 ${className}`}>
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={`flex items-center gap-1 ${
          active
            ? "text-[var(--gold)]"
            : "text-[var(--text-secondary)] hover:text-[var(--gold)]"
        }`}
      >
        {label}
        <span className="text-[8px] opacity-70">
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function SkeletonRows() {
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30 overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="px-3 py-3 flex items-center gap-3 animate-pulse"
        >
          <div className="h-4 w-4 rounded bg-[var(--bg-elevated)]" />
          <div className="h-3 w-16 rounded bg-[var(--bg-elevated)]" />
          <div className="h-3 w-32 rounded bg-[var(--bg-elevated)]" />
          <div className="h-3 w-20 rounded bg-[var(--bg-elevated)]" />
          <div className="h-3 flex-1 rounded bg-[var(--bg-elevated)]" />
        </div>
      ))}
    </div>
  );
}
