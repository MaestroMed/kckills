/**
 * /admin/community/compilations — Compilations admin (read-only stub).
 *
 * Wave 31a — recent compilations list with view counts + status. Edit
 * via Supabase dashboard for now. A dedicated render-queue + bulk delete
 * UI is follow-up work.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { AdminPage } from "@/components/admin/ui/AdminPage";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { createAnonSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Compilations Admin — KCKILLS",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface CompilationRowLite {
  short_code: string;
  title: string;
  status: string | null;
  view_count: number | null;
  output_duration_seconds: number | null;
  created_at: string;
}

export default async function CompilationsAdminPage() {
  let recent: CompilationRowLite[] = [];
  try {
    const sb = createAnonSupabase();
    const { data } = await sb
      .from("compilations")
      .select("short_code,title,status,view_count,output_duration_seconds,created_at")
      .order("created_at", { ascending: false })
      .limit(40);
    recent = (data ?? []) as CompilationRowLite[];
  } catch {
    /* RLS / network — render empty */
  }

  const byStatus = {
    done: recent.filter((r) => r.status === "done").length,
    rendering: recent.filter((r) => r.status === "rendering").length,
    pending: recent.filter((r) => r.status === "pending").length,
    failed: recent.filter((r) => r.status === "failed").length,
  };

  return (
    <AdminPage
      title="Compilations"
      subtitle="Compilations vidéo créées par les utilisateurs."
      breadcrumbs={[
        { label: "Admin", href: "/admin" },
        { label: "Community", href: "/admin/community" },
        { label: "Compilations" },
      ]}
      actions={
        <Link
          href="/compilation"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--gold)] hover:bg-[var(--gold)]/20"
        >
          Voir le builder →
        </Link>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Tile label="Terminées" value={String(byStatus.done)} tone="good" />
        <Tile label="En rendu" value={String(byStatus.rendering)} tone="info" />
        <Tile label="En attente" value={String(byStatus.pending)} tone="warn" />
        <Tile label="Échouées" value={String(byStatus.failed)} tone="bad" />
      </div>

      <AdminCard title={`Récentes (${recent.length})`}>
        {recent.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] italic text-center py-8">
            Pas encore de compilation.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {recent.map((c) => (
              <li
                key={c.short_code}
                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--text-primary)] truncate">
                    {c.title}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)] flex items-center gap-2 mt-0.5">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 font-bold uppercase tracking-widest text-[9px] ${
                        c.status === "done"
                          ? "bg-[var(--green)]/20 text-[var(--green)]"
                          : c.status === "failed"
                            ? "bg-[var(--red)]/20 text-[var(--red)]"
                            : "bg-[var(--cyan)]/15 text-[var(--cyan)]"
                      }`}
                    >
                      {c.status ?? "?"}
                    </span>
                    <span>👁 {c.view_count ?? 0}</span>
                    {c.output_duration_seconds !== null && (
                      <span>{Math.round(c.output_duration_seconds)}s</span>
                    )}
                    <span>
                      {new Date(c.created_at).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </p>
                </div>
                <Link
                  href={`/c/${c.short_code}`}
                  className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)] shrink-0"
                >
                  Ouvrir →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <p className="mt-4 text-[10px] text-[var(--text-disabled)] text-center">
        Pour supprimer une compilation, utiliser la table{" "}
        <code className="font-data">compilations</code> dans Supabase.
      </p>
    </AdminPage>
  );
}

function Tile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
}) {
  const TONES = {
    neutral: "border-[var(--border-gold)] text-[var(--text-primary)]",
    good: "border-[var(--green)]/40 text-[var(--green)]",
    warn: "border-[var(--orange)]/40 text-[var(--orange)]",
    bad: "border-[var(--red)]/40 text-[var(--red)]",
    info: "border-[var(--cyan)]/40 text-[var(--cyan)]",
  } as const;
  return (
    <div className={`rounded-xl border ${TONES[tone]} bg-[var(--bg-surface)] p-4`}>
      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="font-data text-2xl font-bold tabular-nums mt-1">{value}</p>
    </div>
  );
}
