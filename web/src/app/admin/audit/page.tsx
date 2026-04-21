import { createServerSupabase } from "@/lib/supabase/server";
import { AuditRow } from "./audit-row";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Audit Log — Admin",
  robots: { index: false, follow: false },
};

interface SearchParams {
  entity_type?: string;
  action?: string;
  limit?: string;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const limit = Math.min(Number(sp.limit) || 100, 500);

  const sb = await createServerSupabase();
  let query = sb
    .from("admin_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (sp.entity_type) query = query.eq("entity_type", sp.entity_type);
  if (sp.action) query = query.eq("action", sp.action);

  const { data: actions } = await query;
  const rows = actions ?? [];

  // Get distinct entity_types + actions for filters
  const entityTypes = Array.from(new Set(rows.map((r) => r.entity_type)));
  const allActions = Array.from(new Set(rows.map((r) => r.action)));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">Audit Log</h1>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          {rows.length} actions affichées · last {limit}
        </p>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <a
          href="/admin/audit"
          className={`rounded-full px-3 py-1 text-xs font-bold border ${
            !sp.entity_type && !sp.action
              ? "bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold)]"
              : "border-[var(--border-gold)] text-[var(--text-muted)]"
          }`}
        >
          Tout
        </a>
        {entityTypes.map((t) => (
          <a
            key={t}
            href={`/admin/audit?entity_type=${t}`}
            className={`rounded-full px-3 py-1 text-xs font-bold border ${
              sp.entity_type === t
                ? "bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold)]"
                : "border-[var(--border-gold)] text-[var(--text-muted)]"
            }`}
          >
            {t}
          </a>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {allActions.map((a) => (
          <a
            key={a}
            href={`/admin/audit?action=${a}`}
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

      {/* Audit table */}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
          Aucune action enregistrée.
        </p>
      ) : (
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30 overflow-hidden">
          {rows.map((row) => (
            <AuditRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
