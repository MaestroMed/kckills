import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { championIconUrl } from "@/lib/constants";
import { PageHero } from "@/components/ui/PageHero";
import { getPublishedKills } from "@/lib/supabase/kills";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Champions",
  description:
    "Tous les champions joues par la Karmine Corp en LEC. Browse par champion pour voir tous les kills donnes et subis.",
  alternates: { canonical: "/champions" },
  openGraph: {
    title: "Champions \u2014 KCKILLS",
    description: "Tous les champions joues par KC en LEC.",
    type: "website",
  },
};

interface ChampionStat {
  name: string;
  killCount: number;
  victimCount: number;
  topHighlight: number;
}

export default async function ChampionsIndexPage() {
  const all = await getPublishedKills(500);

  // Aggregate per champion across BOTH sides — fans want to land on
  // the page even if the champion only appears as a victim in the
  // catalogue (e.g. opposing team played it once).
  const stats = new Map<string, ChampionStat>();
  for (const k of all) {
    if (k.killer_champion) {
      const e = stats.get(k.killer_champion) ?? {
        name: k.killer_champion,
        killCount: 0,
        victimCount: 0,
        topHighlight: 0,
      };
      e.killCount += 1;
      if ((k.highlight_score ?? 0) > e.topHighlight) {
        e.topHighlight = k.highlight_score ?? 0;
      }
      stats.set(k.killer_champion, e);
    }
    if (k.victim_champion) {
      const e = stats.get(k.victim_champion) ?? {
        name: k.victim_champion,
        killCount: 0,
        victimCount: 0,
        topHighlight: 0,
      };
      e.victimCount += 1;
      stats.set(k.victim_champion, e);
    }
  }

  // Sort by kill_count + victim_count desc — most-seen first.
  const ordered = [...stats.values()].sort(
    (a, b) => b.killCount + b.victimCount - (a.killCount + a.victimCount),
  );

  return (
    <div className="-mt-6">
      <PageHero
        crumbs={[
          { label: "Accueil", href: "/" },
          { label: "Champions" },
        ]}
        badge={`${ordered.length} champions`}
        title="CHAMPIONS"
        subtitle="Tous les champions vus dans les clips KC. Click pour voir les plays donnes et subis sur chaque champion."
        backgroundSrc="/images/hero-bg.jpg"
      />

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12">
        <div className="grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {ordered.map((c) => (
            <Link
              key={c.name}
              href={`/champion/${encodeURIComponent(c.name)}`}
              className="group relative aspect-square overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all hover:border-[var(--gold)]/55 hover:scale-105 hover:shadow-2xl hover:shadow-[var(--gold)]/15"
            >
              <Image
                src={championIconUrl(c.name)}
                alt={c.name}
                fill
                sizes="(max-width: 768px) 33vw, 12vw"
                className="object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent" />

              {/* Top-right: highlight score badge */}
              {c.topHighlight >= 8 && (
                <span className="absolute top-1.5 right-1.5 z-10 rounded-md bg-[var(--gold)]/25 backdrop-blur-sm border border-[var(--gold)]/55 px-1.5 py-0.5 font-data text-[9px] font-bold text-[var(--gold)]">
                  {c.topHighlight.toFixed(1)}
                </span>
              )}

              {/* Bottom: name + counts */}
              <div className="absolute inset-x-1.5 bottom-1.5 z-10">
                <p className="font-display text-xs font-black text-white truncate group-hover:text-[var(--gold)] transition-colors">
                  {c.name}
                </p>
                <p className="font-data text-[9px] text-white/60 leading-tight">
                  {c.killCount > 0 && (
                    <span className="text-[var(--green)]">{c.killCount}K</span>
                  )}
                  {c.killCount > 0 && c.victimCount > 0 && <span className="text-white/30 mx-0.5">·</span>}
                  {c.victimCount > 0 && (
                    <span className="text-[var(--red)]">{c.victimCount}D</span>
                  )}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
