import { createServerSupabase } from "@/lib/supabase/server";

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
            <details key={row.id} className="group">
              <summary className="cursor-pointer px-3 py-2 flex items-center gap-3 text-xs hover:bg-[var(--bg-elevated)]">
                <span className="font-mono text-[var(--gold)] w-32 flex-shrink-0">{row.action}</span>
                <span className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  {row.entity_type}
                </span>
                <span className="font-mono text-[10px] text-[var(--text-disabled)] truncate flex-1">
                  {row.entity_id ? row.entity_id.slice(0, 16) : "—"}
                </span>
                <span className="text-[var(--text-muted)] text-[10px] whitespace-nowrap">
                  {row.actor_label ?? "?"} · {new Date(row.created_at).toLocaleString("fr-FR")}
                </span>
              </summary>
              <div className="px-3 py-3 bg-[var(--bg-primary)] grid grid-cols-2 gap-3 text-[10px] font-mono">
                <div>
                  <p className="text-[var(--text-muted)] uppercase tracking-widest mb-1">Before</p>
                  <pre className="rounded bg-[var(--bg-elevated)] p-2 overflow-x-auto">{JSON.stringify(row.before, null, 2) || "null"}</pre>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] uppercase tracking-widest mb-1">After</p>
                  <pre className="rounded bg-[var(--bg-elevated)] p-2 overflow-x-auto">{JSON.stringify(row.after, null, 2) || "null"}</pre>
                </div>
                {row.notes && <p className="col-span-2 text-[var(--text-muted)]">{row.notes}</p>}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
