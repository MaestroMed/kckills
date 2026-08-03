import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getCardKills } from "@/lib/supabase/kills";
import { championIconUrl } from "@/lib/constants";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getStaticT } from "@/lib/i18n/server-lang";

/**
 * /champions — champion index (Vague 5, audit 2026-07-05).
 *
 * Was a redirect("/clips"). Aggregates published KC-killer clips by
 * killer_champion (cached anon read) into a browsable icon grid that
 * links into the existing /champion/[name] detail pages.
 */
export const revalidate = 3600;
export const metadata: Metadata = {
  title: "Champions",
  description:
    "Tous les champions joués par la Karmine Corp — classés par nombre de clips publiés.",
  alternates: { canonical: "/champions" },
};

export default async function ChampionsPage() {
  const { t } = getStaticT();
  const kills = await getCardKills(500);

  const byChampion = new Map<string, { clips: number; topScore: number }>();
  for (const k of kills) {
    if (!k.killer_champion) continue;
    const cur = byChampion.get(k.killer_champion) ?? { clips: 0, topScore: 0 };
    cur.clips += 1;
    cur.topScore = Math.max(cur.topScore, k.highlight_score ?? 0);
    byChampion.set(k.killer_champion, cur);
  }
  const champions = [...byChampion.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.clips - a.clips);

  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: "Champions" }]} />
      <header>
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
          Karmine Corp
        </p>
        <h1 className="font-display text-4xl md:text-5xl font-black">
          <span className="text-shimmer">{t("p_champions.title")}</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-muted)]">
          {t("p_champions.subtitle")}
        </p>
      </header>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {champions.map((c) => (
          <Link
            key={c.name}
            href={`/champion/${encodeURIComponent(c.name)}`}
            className="group rounded-2xl border border-white/10 bg-[var(--bg-surface)] p-3 text-center transition-all hover:border-[var(--gold)]/50 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <div className="relative mx-auto h-14 w-14 overflow-hidden rounded-xl border border-[var(--gold)]/20">
              <Image
                src={championIconUrl(c.name)}
                alt={c.name}
                fill
                sizes="56px"
                className="object-cover transition-transform duration-300 group-hover:scale-110 motion-reduce:transition-none"
              />
            </div>
            <p className="mt-2 truncate text-xs font-bold text-white">{c.name}</p>
            <p className="font-data text-[10px] text-[var(--text-muted)]">
              {c.clips === 1
                ? t("p_champions.clip")
                : t("p_champions.clips", { n: String(c.clips) })}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
