import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { getPublishedKills } from "@/lib/supabase/kills";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Analytics — Admin",
  robots: { index: false, follow: false },
};

export default async function AnalyticsPage() {
  const sb = await createServerSupabase();

  const [kills, ratingsRaw, commentsRaw] = await Promise.all([
    getPublishedKills(500),
    sb.from("ratings").select("score,kill_id,created_at"),
    sb.from("comments").select("kill_id,created_at,is_deleted,moderation_status"),
  ]);

  const kcKills = kills.filter((k) => k.tracked_team_involvement === "team_killer");
  const ratings = ratingsRaw.data ?? [];
  const comments = (commentsRaw.data ?? []).filter((c) => !c.is_deleted && c.moderation_status === "approved");

  // Total impressions
  const totalImpressions = kcKills.reduce((s, k) => s + (k.impression_count ?? 0), 0);

  // Top by impressions
  const topImpressions = [...kcKills]
    .sort((a, b) => (b.impression_count ?? 0) - (a.impression_count ?? 0))
    .slice(0, 10);

  // Top by rating (with at least 1 rating)
  const topRated = kcKills
    .filter((k) => (k.rating_count ?? 0) > 0)
    .sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0))
    .slice(0, 10);

  // Top by comments
  const topCommented = [...kcKills]
    .filter((k) => (k.comment_count ?? 0) > 0)
    .sort((a, b) => (b.comment_count ?? 0) - (a.comment_count ?? 0))
    .slice(0, 10);

  // Engagement funnel
  const published = kcKills.length;
  const withImpressions = kcKills.filter((k) => (k.impression_count ?? 0) > 0).length;
  const withRatings = kcKills.filter((k) => (k.rating_count ?? 0) > 0).length;
  const withComments = kcKills.filter((k) => (k.comment_count ?? 0) > 0).length;

  // Daily activity (kills published per day, last 14 days)
  const now = Date.now();
  const dailyMap = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    dailyMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const k of kcKills) {
    const d = (k.created_at ?? "").slice(0, 10);
    if (dailyMap.has(d)) dailyMap.set(d, (dailyMap.get(d) ?? 0) + 1);
  }
  const dailyData = Array.from(dailyMap.entries());
  const maxDaily = Math.max(1, ...dailyData.map(([, n]) => n));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">Analytics</h1>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">KPIs sur les {kcKills.length} clips KC publiés</p>
      </header>

      {/* KPI grid */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Clips publiés" value={published} />
        <KpiCard label="Total impressions" value={totalImpressions.toLocaleString("fr-FR")} accent="cyan" />
        <KpiCard label="Total ratings" value={ratings.length} accent="gold" />
        <KpiCard label="Total comments" value={comments.length} accent="green" />
      </section>

      {/* Engagement funnel */}
      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Funnel d&apos;engagement
        </h2>
        <div className="space-y-2">
          <FunnelStep label="Publiés" count={published} max={published} accent="gold" />
          <FunnelStep label="Vus au moins 1×" count={withImpressions} max={published} accent="cyan" />
          <FunnelStep label="Notés" count={withRatings} max={published} accent="green" />
          <FunnelStep label="Commentés" count={withComments} max={published} accent="orange" />
        </div>
      </section>

      {/* Daily activity */}
      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Clips publiés / jour (14 derniers jours)
        </h2>
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-end gap-1 h-32">
            {dailyData.map(([date, n]) => (
              <div key={date} className="flex-1 flex flex-col items-center justify-end gap-1">
                <span className="text-[9px] text-[var(--text-muted)]">{n > 0 ? n : ""}</span>
                <div
                  className="w-full bg-[var(--gold)]/30 hover:bg-[var(--gold)] transition-colors rounded-t"
                  style={{ height: `${(n / maxDaily) * 100}%`, minHeight: n > 0 ? "4px" : "1px" }}
                  title={`${date}: ${n} clips`}
                />
                <span className="text-[8px] text-[var(--text-muted)] font-mono">{date.slice(8)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Top tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TopList title="Top impressions" items={topImpressions} metric={(k) => k.impression_count ?? 0} suffix="vues" />
        <TopList title="Top ratings" items={topRated} metric={(k) => Number((k.avg_rating ?? 0).toFixed(1))} suffix="/5" />
        <TopList title="Top comments" items={topCommented} metric={(k) => k.comment_count ?? 0} suffix="msgs" />
      </div>
    </div>
  );
}

function KpiCard({ label, value, accent = "default" }: { label: string; value: number | string; accent?: "default" | "gold" | "green" | "cyan" | "orange" }) {
  const colors: Record<string, string> = {
    default: "text-[var(--text-primary)]",
    gold: "text-[var(--gold)]",
    green: "text-[var(--green)]",
    cyan: "text-[var(--cyan)]",
    orange: "text-[var(--orange)]",
  };
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <p className={`font-data text-3xl font-black ${colors[accent]}`}>{value}</p>
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mt-1">{label}</p>
    </div>
  );
}

function FunnelStep({ label, count, max, accent }: { label: string; count: number; max: number; accent: "gold" | "cyan" | "green" | "orange" }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  const colors: Record<string, string> = {
    gold: "bg-[var(--gold)]",
    cyan: "bg-[var(--cyan)]",
    green: "bg-[var(--green)]",
    orange: "bg-[var(--orange)]",
  };
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-0.5">
        <span className="text-[var(--text-muted)]">{label}</span>
        <span className="font-mono">
          <span className="font-bold">{count}</span>
          <span className="text-[var(--text-disabled)] ml-2">{pct}%</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div className={`h-full ${colors[accent]} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface MinimalKill {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  highlight_score: number | null;
  thumbnail_url?: string | null;
  impression_count?: number | null;
  avg_rating?: number | null;
  comment_count?: number | null;
  rating_count?: number | null;
}

function TopList({ title, items, metric, suffix }: { title: string; items: MinimalKill[]; metric: (k: MinimalKill) => number; suffix: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
      <header className="px-3 py-2 border-b border-[var(--border-gold)] bg-[var(--bg-elevated)]">
        <h3 className="font-display text-[10px] uppercase tracking-widest text-[var(--gold)]">{title}</h3>
      </header>
      <ol className="divide-y divide-[var(--border-gold)]/30">
        {items.length === 0 ? (
          <li className="px-3 py-3 text-xs text-[var(--text-muted)] text-center">Pas encore de données</li>
        ) : (
          items.map((k, i) => (
            <li key={k.id} className="px-3 py-2 flex items-center gap-2 text-xs">
              <span className="font-mono text-[var(--text-disabled)] w-4">{i + 1}.</span>
              <Link href={`/kill/${k.id}`} className="flex-1 truncate hover:text-[var(--gold)]">
                {k.killer_champion} → {k.victim_champion}
              </Link>
              <span className="font-mono text-[var(--gold)] flex-shrink-0">
                {metric(k)} <span className="text-[var(--text-muted)] text-[9px]">{suffix}</span>
              </span>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}
