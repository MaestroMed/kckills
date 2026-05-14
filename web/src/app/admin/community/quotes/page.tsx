/**
 * /admin/community/quotes — Caster quote moderation.
 *
 * Wave 31d — full moderation surface : hide/show/edit/delete per row +
 * memetic toggle. Reads the raw kill_quotes table (NOT the public
 * fn_top_quotes RPC, which filters out hidden rows) so the operator
 * sees every quote — visible or not. Includes a "hidden only" filter
 * via ?hidden=1.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { AdminPage } from "@/components/admin/ui/AdminPage";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { getQuotesStats } from "@/lib/supabase/quotes";
import { QuoteRowActions } from "@/components/admin/quotes/QuoteRowActions";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Quotes Admin — KCKILLS",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface AdminQuoteRow {
  id: string;
  kill_id: string;
  quote_text: string;
  caster_name: string | null;
  language: string | null;
  energy_level: number | null;
  is_memetic: boolean;
  is_hidden: boolean;
  upvotes: number;
  reported_count: number;
  extracted_at: string;
  // Joined from kills
  killer_champion?: string | null;
  victim_champion?: string | null;
}

interface PageProps {
  searchParams: Promise<{ filter?: string }>;
}

export default async function QuotesAdminPage({ searchParams }: PageProps) {
  const { filter } = await searchParams;
  const onlyHidden = filter === "hidden";
  const onlyReported = filter === "reported";

  const sb = await createServerSupabase();
  let query = sb
    .from("kill_quotes")
    .select(
      "id,kill_id,quote_text,caster_name,language,energy_level," +
        "is_memetic,is_hidden,upvotes,reported_count,extracted_at," +
        "kills(killer_champion,victim_champion)",
    )
    .order("upvotes", { ascending: false })
    .order("extracted_at", { ascending: false })
    .limit(60);

  if (onlyHidden) query = query.eq("is_hidden", true);
  if (onlyReported) query = query.gt("reported_count", 0);

  const { data: raw } = await query;
  const quotes: AdminQuoteRow[] = (raw ?? []).map((r) => {
    const row = r as unknown as {
      id: string; kill_id: string; quote_text: string;
      caster_name: string | null; language: string | null;
      energy_level: number | null; is_memetic: boolean;
      is_hidden: boolean; upvotes: number; reported_count: number;
      extracted_at: string;
      kills: { killer_champion: string | null; victim_champion: string | null } | null;
    };
    return {
      id: row.id,
      kill_id: row.kill_id,
      quote_text: row.quote_text,
      caster_name: row.caster_name,
      language: row.language,
      energy_level: row.energy_level,
      is_memetic: row.is_memetic,
      is_hidden: row.is_hidden,
      upvotes: row.upvotes,
      reported_count: row.reported_count,
      extracted_at: row.extracted_at,
      killer_champion: row.kills?.killer_champion ?? null,
      victim_champion: row.kills?.victim_champion ?? null,
    };
  });

  const stats = await getQuotesStats();

  return (
    <AdminPage
      title="Quotes — Modération"
      subtitle="Hide / Show / Edit / Delete par quote — actions optimistes avec audit log."
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
      toolbar={
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            href="/admin/community/quotes"
            className={`rounded-full border px-3 py-1.5 font-bold uppercase tracking-widest transition-colors ${
              !onlyHidden && !onlyReported
                ? "border-[var(--gold)] bg-[var(--gold)] text-[var(--bg-primary)]"
                : "border-[var(--border-gold)] text-[var(--text-secondary)] hover:text-[var(--gold)]"
            }`}
          >
            Toutes
          </Link>
          <Link
            href="/admin/community/quotes?filter=hidden"
            className={`rounded-full border px-3 py-1.5 font-bold uppercase tracking-widest transition-colors ${
              onlyHidden
                ? "border-[var(--orange)] bg-[var(--orange)] text-[var(--bg-primary)]"
                : "border-[var(--border-gold)] text-[var(--text-secondary)] hover:text-[var(--orange)]"
            }`}
          >
            Masquées
          </Link>
          <Link
            href="/admin/community/quotes?filter=reported"
            className={`rounded-full border px-3 py-1.5 font-bold uppercase tracking-widest transition-colors ${
              onlyReported
                ? "border-[var(--red)] bg-[var(--red)] text-[var(--bg-primary)]"
                : "border-[var(--border-gold)] text-[var(--text-secondary)] hover:text-[var(--red)]"
            }`}
          >
            Signalées
          </Link>
        </div>
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

      <AdminCard title={`${onlyHidden ? "Quotes masquées" : onlyReported ? "Quotes signalées" : "Quotes"} (${quotes.length})`}>
        {quotes.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] italic text-center py-8">
            {onlyHidden
              ? "Aucune quote masquée."
              : onlyReported
                ? "Aucune quote signalée."
                : "Aucune quote extraite pour l'instant."}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {quotes.map((q) => (
              <li key={q.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <p className="text-[10px] text-[var(--text-muted)] flex items-center gap-2 flex-wrap">
                    {q.caster_name && (
                      <span className="uppercase tracking-widest font-semibold">
                        {q.caster_name}
                      </span>
                    )}
                    {q.language && q.language !== "fr" && (
                      <span className="rounded bg-[var(--cyan)]/20 text-[var(--cyan)] px-1 py-0.5 font-bold uppercase tracking-widest text-[9px]">
                        {q.language}
                      </span>
                    )}
                    {q.energy_level !== null && (
                      <span>⚡{q.energy_level}/5</span>
                    )}
                    <span>↑ {q.upvotes}</span>
                    {q.reported_count > 0 && (
                      <span className="rounded bg-[var(--red)]/20 text-[var(--red)] px-1 py-0.5 font-bold tabular-nums">
                        ⚠ {q.reported_count} reports
                      </span>
                    )}
                    {q.killer_champion && q.victim_champion && (
                      <span className="text-[var(--text-disabled)]">
                        {q.killer_champion} vs {q.victim_champion}
                      </span>
                    )}
                    <span className="text-[var(--text-disabled)]">
                      {new Date(q.extracted_at).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </p>
                  <Link
                    href={`/kill/${q.kill_id}`}
                    className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)] shrink-0"
                  >
                    Clip →
                  </Link>
                </div>
                <QuoteRowActions
                  quoteId={q.id}
                  initialText={q.quote_text}
                  initialHidden={q.is_hidden}
                  initialMemetic={q.is_memetic}
                />
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
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
