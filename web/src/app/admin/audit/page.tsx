/**
 * /admin/audit — audit log of admin actions (PR-loltok EE polish).
 *
 * Combines the per-actor 7-day summary cards (top), filter chips, the
 * flat audit table OR a vertical timeline (toggleable), and pagination.
 *
 * The view toggle is purely client-side : we always fetch the same data,
 * the toggle just swaps the renderer. Default view = "table" because
 * that's what was here before Wave 12 ; "timeline" is the new view.
 *
 * Export CSV is wired via /api/admin/audit/export which inherits the
 * same filters via query string (the link in the header preserves them).
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { AdminPage, AdminButton } from "@/components/admin/ui";
import { AuditView } from "./audit-view";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Audit Log — Admin",
  robots: { index: false, follow: false },
};

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

interface SummaryRow {
  actor_label: string | null;
  actor_role: string | null;
  action: string;
  count_7d: number;
  last_action_at: string | null;
}

const PAGE_SIZE = 50;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const limit = Math.min(Number(sp.limit) || PAGE_SIZE, 200);
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * limit;
  const view = sp.view === "timeline" ? "timeline" : "table";

  const sb = await createServerSupabase();

  // Base list query
  let query = sb
    .from("admin_actions")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (sp.entity_type) query = query.eq("entity_type", sp.entity_type);
  if (sp.action) query = query.eq("action", sp.action);
  if (sp.actor) query = query.eq("actor_label", sp.actor);
  if (sp.q && sp.q.trim()) {
    // OR-search across actor and action — keeps the search bar
    // flexible without committing to a full-text vector.
    const term = sp.q.trim().replace(/%/g, "");
    query = query.or(`actor_label.ilike.%${term}%,action.ilike.%${term}%`);
  }
  if (sp.from) {
    const fromIso = parseDateBoundary(sp.from, "start");
    if (fromIso) query = query.gte("created_at", fromIso);
  }
  if (sp.to) {
    const toIso = parseDateBoundary(sp.to, "end");
    if (toIso) query = query.lte("created_at", toIso);
  }

  // Per-actor summary view (last 7 days)
  const summaryQuery = sb
    .from("v_admin_actions_7d")
    .select("actor_label,actor_role,action,count_7d,last_action_at")
    .order("count_7d", { ascending: false })
    .limit(20);

  // Filter facets — query separately so they aren't constrained by the
  // current filter (gives the user discoverability of OTHER values).
  const facetsQuery = sb
    .from("admin_actions")
    .select("actor_label,action,entity_type,created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  const [{ data: actions, count }, { data: rawSummary }, { data: facetRows }] =
    await Promise.all([query, summaryQuery, facetsQuery]);

  const rows = actions ?? [];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Summary aggregation by actor (group by actor_label)
  const summaryRows = (rawSummary ?? []) as SummaryRow[];
  const byActor = new Map<
    string,
    {
      actor_label: string;
      actor_role: string | null;
      total: number;
      topActions: { action: string; count: number }[];
    }
  >();
  for (const s of summaryRows) {
    const key = s.actor_label ?? "unknown";
    const existing = byActor.get(key);
    if (existing) {
      existing.total += s.count_7d;
      existing.topActions.push({ action: s.action, count: s.count_7d });
    } else {
      byActor.set(key, {
        actor_label: key,
        actor_role: s.actor_role,
        total: s.count_7d,
        topActions: [{ action: s.action, count: s.count_7d }],
      });
    }
  }
  const actorCards = Array.from(byActor.values())
    .sort((a, b) => b.total - a.total)
    .map((c) => ({
      ...c,
      topActions: c.topActions.sort((a, b) => b.count - a.count).slice(0, 3),
    }));

  // Build facet lists
  const facetSource = facetRows ?? [];
  const entityTypes = Array.from(
    new Set(facetSource.map((r) => r.entity_type as string).filter(Boolean)),
  ).sort();
  const allActions = Array.from(
    new Set(facetSource.map((r) => r.action as string).filter(Boolean)),
  ).sort();
  const allActors = Array.from(
    new Set(
      facetSource.map((r) => (r.actor_label as string) ?? "").filter(Boolean),
    ),
  ).sort();

  return (
    <AdminPage
      title="Audit Log"
      breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Audit Log" }]}
      subtitle={`${total} actions au total · page ${page}/${totalPages} · ${rows.length} affichées`}
    >
      {/* Per-actor summary cards (last 7 days) */}
      {actorCards.length > 0 && (
        <section className="mb-6">
          <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
            7-day summary par actor
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {actorCards.map((c) => (
              <div
                key={c.actor_label}
                className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3"
              >
                <div className="flex items-baseline justify-between">
                  <p className="font-bold text-sm text-[var(--gold)]">
                    {c.actor_label}
                    {c.actor_role && c.actor_role !== "unknown" ? (
                      <span className="text-[10px] text-[var(--text-disabled)] font-normal ml-1.5">
                        · {c.actor_role}
                      </span>
                    ) : null}
                  </p>
                  <p className="font-data text-2xl font-black">{c.total}</p>
                </div>
                <p className="text-[9px] uppercase tracking-widest text-[var(--text-muted)] mt-1">
                  actions / 7j
                </p>
                <div className="mt-2 space-y-0.5">
                  {c.topActions.map((a) => (
                    <div
                      key={a.action}
                      className="flex justify-between text-[10px]"
                    >
                      <span className="font-mono text-[var(--text-secondary)] truncate">
                        {a.action}
                      </span>
                      <span className="text-[var(--text-muted)] font-mono">
                        {a.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filters */}
      <section className="space-y-3 mb-6">
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          Filtres
        </h2>

        {/* Search + date range form (GET — preserves other params) */}
        <form action="/admin/audit" method="get" className="flex flex-wrap items-end gap-2">
          {sp.entity_type && (
            <input type="hidden" name="entity_type" value={sp.entity_type} />
          )}
          {sp.action && <input type="hidden" name="action" value={sp.action} />}
          {sp.actor && <input type="hidden" name="actor" value={sp.actor} />}
          {sp.view && <input type="hidden" name="view" value={sp.view} />}
          <label className="flex flex-col gap-0.5 text-[10px] text-[var(--text-muted)]">
            Recherche (actor / action)
            <input
              type="search"
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="ex: kill.publish ou mehdi"
              className="rounded border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1 text-xs min-w-[200px]"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] text-[var(--text-muted)]">
            From
            <input
              type="date"
              name="from"
              defaultValue={sp.from ?? ""}
              className="rounded border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] text-[var(--text-muted)]">
            To
            <input
              type="date"
              name="to"
              defaultValue={sp.to ?? ""}
              className="rounded border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
            />
          </label>
          <AdminButton type="submit" size="sm" variant="secondary">
            Apply
          </AdminButton>
          {(sp.from ||
            sp.to ||
            sp.entity_type ||
            sp.action ||
            sp.actor ||
            sp.q) && (
            <a
              href="/admin/audit"
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--gold)] underline"
            >
              clear all
            </a>
          )}
        </form>

        {/* Entity_type chips */}
        <div className="flex flex-wrap gap-2">
          <a
            href={buildHref(sp, { entity_type: undefined })}
            className={chipClass(!sp.entity_type)}
          >
            Tous types
          </a>
          {entityTypes.map((t) => (
            <a
              key={t}
              href={buildHref(sp, { entity_type: t })}
              className={chipClass(sp.entity_type === t)}
            >
              {t}
            </a>
          ))}
        </div>

        {/* Actor chips */}
        {allActors.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <a
              href={buildHref(sp, { actor: undefined })}
              className={chipClass(!sp.actor, "cyan")}
            >
              Tous actors
            </a>
            {allActors.map((a) => (
              <a
                key={a}
                href={buildHref(sp, { actor: a })}
                className={chipClass(sp.actor === a, "cyan")}
              >
                {a}
              </a>
            ))}
          </div>
        )}

        {/* Action chips */}
        <div className="flex flex-wrap gap-1.5">
          {allActions.map((a) => (
            <a
              key={a}
              href={buildHref(sp, { action: a })}
              className={`rounded px-2 py-0.5 text-[10px] font-mono border ${
                sp.action === a
                  ? "border-[var(--cyan)] text-[var(--cyan)] bg-[var(--cyan)]/10"
                  : "border-[var(--border-gold)]/50 text-[var(--text-disabled)] hover:text-[var(--text-muted)]"
              }`}
            >
              {a}
            </a>
          ))}
        </div>
      </section>

      {/* View toggle + body — handled client-side */}
      <AuditView rows={rows} initialView={view} searchParams={sp} />

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="flex items-center justify-between text-xs mt-6">
          {page > 1 ? (
            <a
              href={buildHref(sp, { page: String(page - 1) })}
              className="rounded border border-[var(--border-gold)] px-3 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            >
              ← Page {page - 1}
            </a>
          ) : (
            <span />
          )}
          <span className="text-[var(--text-muted)]">
            Page {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <a
              href={buildHref(sp, { page: String(page + 1) })}
              className="rounded border border-[var(--border-gold)] px-3 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            >
              Page {page + 1} →
            </a>
          ) : (
            <span />
          )}
        </nav>
      )}
    </AdminPage>
  );
}

/**
 * Build an /admin/audit href with the current search params merged with
 * an `update` patch. Used by every chip/link so toggling one filter
 * preserves the others. `undefined` in the patch removes that param.
 */
function buildHref(sp: SearchParams, update: Partial<SearchParams>): string {
  const merged: Record<string, string | undefined> = { ...sp, ...update };
  // Reset to page 1 whenever filters change
  if (Object.keys(update).some((k) => k !== "page")) {
    merged.page = undefined;
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== "") qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `/admin/audit?${s}` : "/admin/audit";
}

function chipClass(active: boolean, color: "gold" | "cyan" = "gold"): string {
  if (active) {
    return color === "gold"
      ? "rounded-full px-3 py-1 text-xs font-bold border bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold)]"
      : "rounded-full px-3 py-1 text-xs font-bold border bg-[var(--cyan)]/20 border-[var(--cyan)] text-[var(--cyan)]";
  }
  return "rounded-full px-3 py-1 text-xs font-bold border border-[var(--border-gold)] text-[var(--text-muted)] hover:text-[var(--text-primary)]";
}

/**
 * Convert a `YYYY-MM-DD` date string into an ISO timestamp at the start
 * (00:00:00) or end (23:59:59.999) of that day. Returns null when the
 * input is malformed so we can ignore invalid filters silently.
 */
function parseDateBoundary(
  input: string,
  boundary: "start" | "end",
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  if (boundary === "end") {
    d.setUTCHours(23, 59, 59, 999);
  } else {
    d.setUTCHours(0, 0, 0, 0);
  }
  return d.toISOString();
}
