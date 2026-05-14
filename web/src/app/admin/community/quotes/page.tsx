/**
 * /admin/community/quotes — Caster quote moderation.
 *
 * Wave 31a — read-only list of the most-upvoted Gemini-extracted caster
 * quotes. Lets the operator scan for false-positive extractions or
 * extracted slurs / misheard words. Direct edit/delete via Supabase
 * dashboard for now ; a dedicated moderation queue is follow-up work.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { AdminPage } from "@/components/admin/ui/AdminPage";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { getTopQuotes, getQuotesStats } from "@/lib/supabase/quotes";

export const metadata: Metadata = {
  title: "Quotes Admin — KCKILLS",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function QuotesAdminPage() {
  const [quotes, stats] = await Promise.all([
    getTopQuotes(40, 1),
    getQuotesStats(),
  ]);

  return (
    <AdminPage
      title="Quotes — Modération"
      subtitle="Quotes extraites par Gemini sur l'audio des clips. Édition via Supabase pour l'instant."
      breadcrumbs={[
        { label: "Admin", href: "/admin" },
        { label: "Community", href: "/admin/community" },
        { label: "Quotes" },
      ]}
      actions={
        <Link
          href="/quotes"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--gold)] hover:bg-[var(--gold)]/20"
        >
          Voir sur le site public →
        </Link>
      }
    >
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiTile
          label="Total quotes"
          value={stats.total_quotes.toLocaleString("fr-FR")}
        />
        <KpiTile
          label="Clips couverts"
          value={stats.total_kills.toLocaleString("fr-FR")}
        />
        <KpiTile
          label="Top caster"
          value={stats.top_caster ?? "—"}
        />
        <KpiTile
          label="Quotes top caster"
          value={stats.top_caster_quotes.toLocaleString("fr-FR")}
        />
      </div>

      <AdminCard title={`Top quotes (${quotes.length})`}>
        {quotes.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] italic text-center py-8">
            Aucune quote extraite pour l&apos;instant.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {quotes.map((q) => (
              <li key={q.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--text-primary)] italic">
                      « {q.quote_text} »
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)] mt-1 flex items-center gap-2 flex-wrap">
                      {q.caster_name && (
                        <span className="uppercase tracking-widest">
                          {q.caster_name}
                        </span>
                      )}
                      {q.is_memetic && (
                        <span className="rounded bg-[var(--gold)]/20 text-[var(--gold)] px-1.5 py-0.5 font-bold uppercase tracking-widest text-[9px]">
                          Memetic
                        </span>
                      )}
                      {q.language && q.language !== "fr" && (
                        <span className="rounded bg-[var(--cyan)]/20 text-[var(--cyan)] px-1 py-0.5 font-bold uppercase tracking-widest text-[9px]">
                          {q.language}
                        </span>
                      )}
                      {q.energy_level !== null && (
                        <span>
                          ⚡{q.energy_level}/5
                        </span>
                      )}
                      <span>↑ {q.upvotes}</span>
                      <span>
                        {q.killer_champion} vs {q.victim_champion}
                      </span>
                    </p>
                  </div>
                  <Link
                    href={`/kill/${q.kill_id}`}
                    className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)] shrink-0 mt-0.5"
                  >
                    Clip →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <p className="mt-4 text-[10px] text-[var(--text-disabled)] text-center">
        Pour modifier ou supprimer une quote, utiliser la table{" "}
        <code className="font-data">kill_quotes</code> dans Supabase. Un
        éditeur dédié arrivera en Wave 31b.
      </p>
    </AdminPage>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="font-data text-2xl font-bold tabular-nums text-[var(--text-primary)] mt-1">
        {value}
      </p>
    </div>
  );
}
