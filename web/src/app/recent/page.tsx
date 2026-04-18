import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { PageHero } from "@/components/ui/PageHero";
import { getPublishedKills, type PublishedKillRow } from "@/lib/supabase/kills";

export const revalidate = 120; // 2 min — fresh feed

export const metadata: Metadata = {
  title: "Derniers clips KC",
  description:
    "Les kills publi\u00e9s les plus r\u00e9cents par le pipeline. Vue chronologique : ce qui vient de tomber, fra\u00eechement encod\u00e9 et tagg\u00e9.",
  alternates: { canonical: "/recent" },
  openGraph: {
    title: "Derniers clips KC \u2014 KCKILLS",
    description: "Vue chronologique des derniers kills publi\u00e9s.",
    type: "website",
  },
};

/**
 * /recent — chronological "what just dropped" feed.
 *
 * Distinct from /scroll (weighted shuffle for entertainment) and
 * /best (composite-score curation). This page answers "what's new?"
 * — fans who follow the site daily land here to see what they
 * haven't seen yet. Grouped by day so the cadence of the pipeline
 * is visible.
 */
export default async function RecentPage() {
  const all = await getPublishedKills(120);
  const eligible = all.filter(
    (k) => !!k.thumbnail_url && k.kill_visible !== false,
  );

  // Sort by created_at desc — Supabase already does this in
  // getPublishedKills as a secondary sort, but be defensive.
  const byDate = [...eligible].sort(
    (a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );

  // Group by day (YYYY-MM-DD).
  const buckets = new Map<string, PublishedKillRow[]>();
  for (const k of byDate) {
    const day = (k.created_at ?? "").slice(0, 10);
    if (!day) continue;
    if (!buckets.has(day)) buckets.set(day, []);
    buckets.get(day)!.push(k);
  }
  const sortedDays = [...buckets.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="-mt-6">
      <PageHero
        crumbs={[
          { label: "Accueil", href: "/" },
          { label: "Derniers clips" },
        ]}
        badge={`${eligible.length} clips r\u00e9cents`}
        title="DERNIERS CLIPS"
        subtitle="Vue chronologique : ce que le worker a publi\u00e9 ces derniers jours. Mise a jour toutes les 2 minutes."
        backgroundSrc="/images/hero-bg.jpg"
      />

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 space-y-12">
        {sortedDays.map(([day, items]) => (
          <DaySection key={day} day={day} items={items} />
        ))}
        {sortedDays.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--border-gold)] bg-[var(--bg-surface)]/40 p-12 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              Aucun clip pour l&apos;instant. Le worker travaille en background, reviens dans quelques minutes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function DaySection({ day, items }: { day: string; items: PublishedKillRow[] }) {
  const date = new Date(day + "T00:00:00Z");
  const friendly = isToday(date)
    ? "Aujourd'hui"
    : isYesterday(date)
      ? "Hier"
      : date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="font-display text-xl md:text-2xl font-black text-[var(--text-primary)] capitalize">
          {friendly}
        </h2>
        <span className="font-data text-xs uppercase tracking-widest text-[var(--text-muted)]">
          {items.length} clip{items.length > 1 ? "s" : ""}
        </span>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {items.map((k) => (
          <RecentClipCard key={k.id} kill={k} />
        ))}
      </div>
    </section>
  );
}

function RecentClipCard({ kill }: { kill: PublishedKillRow }) {
  const isKcKill = kill.tracked_team_involvement === "team_killer";
  const time = kill.created_at ? new Date(kill.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <Link
      href={`/kill/${kill.id}`}
      className="group relative block overflow-hidden rounded-xl border border-[var(--border-gold)] bg-black transition-all hover:-translate-y-0.5 hover:border-[var(--gold)]/50 hover:shadow-2xl hover:shadow-[var(--gold)]/15"
      style={{ aspectRatio: "16/10" }}
    >
      {kill.thumbnail_url ? (
        <Image
          src={kill.thumbnail_url}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 25vw"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent" />

      {/* Top-left: time + KC badge */}
      <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between gap-2">
        <span className="rounded-md bg-black/60 backdrop-blur-sm px-2 py-0.5 font-data text-[9px] text-white/70 uppercase tracking-wider">
          {time}
        </span>
        <div className="flex items-center gap-1">
          {kill.multi_kill && (
            <span className="rounded bg-[var(--gold)]/20 border border-[var(--gold)]/45 px-1.5 py-0.5 font-data text-[8px] font-black text-[var(--gold)] uppercase tracking-[0.18em]">
              {kill.multi_kill}
            </span>
          )}
          <span
            className={
              "rounded px-1.5 py-0.5 font-data text-[8px] font-black uppercase tracking-[0.18em] " +
              (isKcKill
                ? "bg-[var(--gold)]/15 border border-[var(--gold)]/40 text-[var(--gold)]"
                : "bg-[var(--red)]/15 border border-[var(--red)]/40 text-[var(--red)]")
            }
          >
            {isKcKill ? "KC" : "death"}
          </span>
        </div>
      </div>

      {/* Bottom: matchup */}
      <div className="absolute inset-x-2 bottom-2 z-10">
        <p className="font-display text-sm font-black text-white leading-tight">
          <span className={isKcKill ? "text-[var(--gold)]" : "text-white"}>
            {kill.killer_champion ?? "?"}
          </span>
          <span className="text-white/55 mx-1.5">→</span>
          <span className={!isKcKill ? "text-[var(--gold)]" : "text-white/85"}>
            {kill.victim_champion ?? "?"}
          </span>
        </p>
        {kill.ai_description && (
          <p className="mt-1 text-[11px] text-white/65 italic line-clamp-2">
            {kill.ai_description}
          </p>
        )}
      </div>
    </Link>
  );
}

function isToday(d: Date): boolean {
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function isYesterday(d: Date): boolean {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return d.toDateString() === y.toDateString();
}
