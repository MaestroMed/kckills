import Link from "next/link";
import type { Metadata } from "next";
import { getPublishedKills } from "@/lib/supabase/kills";

export const metadata: Metadata = {
  title: "Admin — KCKILLS",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Get quick stats
  const kills = await getPublishedKills(500);
  const kcKills = kills.filter((k) => k.tracked_team_involvement === "team_killer");
  const visible = kcKills.filter((k) => k.kill_visible !== false);
  const noDesc = kcKills.filter((k) => !k.ai_description || k.ai_description.length < 40);
  const lowScore = kcKills.filter((k) => (k.highlight_score ?? 0) < 5);
  const highScore = kcKills.filter((k) => (k.highlight_score ?? 0) >= 8);

  return (
    <div className="mx-auto max-w-5xl py-8 px-4 space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-[var(--gold)]">Admin Dashboard</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Page non indexée — accès via URL directe uniquement</p>
        </div>
        <Link href="/" className="text-xs text-[var(--text-muted)] hover:text-[var(--gold)]">← Site public</Link>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="KC kills publiés" value={kcKills.length} />
        <StatCard label="Visibles dans /scroll" value={visible.length} accent="green" />
        <StatCard label="Score ≥ 8/10" value={highScore.length} accent="gold" />
        <StatCard label="Score < 5/10" value={lowScore.length} accent="red" />
      </section>

      {/* Quick actions */}
      <section>
        <h2 className="font-display text-sm uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Outils
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ActionCard
            href="/review"
            title="Backoffice Clips"
            desc={`Editer description, tags, fight_type, score des ${kcKills.length} clips. Masquer les mauvais.`}
            icon="✏️"
          />
          <ActionCard
            href="/scroll"
            title="Voir le scroll"
            desc="Tester l'expérience TikTok côté utilisateur (v2 player pool + BGM)."
            icon="🎬"
          />
          <ActionCard
            href="/matches"
            title="Tous les matchs"
            desc="Liste des 36 matchs KC LEC depuis avril 2025."
            icon="🏆"
          />
          <ActionCard
            href="/best"
            title="Meilleurs clips"
            desc="Curation par highlight_score. Fait par l'IA Gemini."
            icon="⭐"
          />
        </div>
      </section>

      {/* Pages cachées */}
      <section>
        <h2 className="font-display text-sm uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Pages cachées de la nav (en attente de polish)
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {[
            { href: "/alumni", label: "Alumni" },
            { href: "/champions", label: "Champions" },
            { href: "/hall-of-fame", label: "Hall of Fame" },
            { href: "/records", label: "Records" },
            { href: "/stats", label: "Stats" },
            { href: "/compare", label: "Comparateur" },
            { href: "/multikills", label: "Multi-kills" },
            { href: "/first-bloods", label: "First Bloods" },
            { href: "/matchups", label: "Matchups" },
            { href: "/community", label: "Community" },
            { href: "/api-docs", label: "API Docs" },
            { href: "/settings", label: "Settings" },
          ].map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="rounded border border-[var(--border-gold)]/30 bg-[var(--bg-surface)]/50 px-3 py-2 text-[var(--text-muted)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40 transition-all"
            >
              {p.label}
            </Link>
          ))}
        </div>
      </section>

      {/* Quality issues to triage */}
      {noDesc.length > 0 && (
        <section className="rounded-xl border border-[var(--orange)]/30 bg-[var(--orange)]/5 p-4">
          <p className="text-xs text-[var(--orange)] font-bold uppercase tracking-widest mb-2">
            ⚠ {noDesc.length} clips sans description correcte
          </p>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Ces clips devraient être re-analysés par le worker. Tu peux aussi les corriger manuellement dans le backoffice.
          </p>
          <Link
            href="/review"
            className="inline-block rounded-lg bg-[var(--orange)] px-3 py-1.5 text-xs font-bold text-black hover:opacity-90"
          >
            Ouvrir le backoffice →
          </Link>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, accent = "default" }: { label: string; value: number; accent?: "default" | "green" | "gold" | "red" }) {
  const colors = {
    default: "text-[var(--text-primary)]",
    green: "text-[var(--green)]",
    gold: "text-[var(--gold)]",
    red: "text-[var(--red)]",
  };
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <p className={`font-data text-3xl font-black ${colors[accent]}`}>{value}</p>
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mt-1">{label}</p>
    </div>
  );
}

function ActionCard({ href, title, desc, icon }: { href: string; title: string; desc: string; icon: string }) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 hover:border-[var(--gold)]/60 hover:-translate-y-0.5 transition-all"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1">
          <h3 className="font-display text-base font-bold text-[var(--gold)] group-hover:text-[var(--gold-bright)]">
            {title}
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{desc}</p>
        </div>
      </div>
    </Link>
  );
}
