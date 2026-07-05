import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getCardKills } from "@/lib/supabase/kills";
import { HomeRareCards } from "@/components/HomeRareCards";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getServerT } from "@/lib/i18n/server-lang";

/**
 * /hall-of-fame — the immortal moments (Vague 5, audit 2026-07-05).
 *
 * Was a redirect("/alumni"). Now an editorial page: the top-rated
 * clips of all time (community score, Wilson-adjusted by rating
 * volume) + the legendary TCG cards showcase reused from the home.
 */
export const revalidate = 3600;
export const metadata: Metadata = {
  title: "Hall of Fame",
  description:
    "Les moments immortels — les clips les mieux notés de l'histoire de la Karmine Corp.",
  alternates: { canonical: "/hall-of-fame" },
};

export default async function HallOfFamePage() {
  const { t } = await getServerT();
  const kills = await getCardKills(300);

  // Wilson-ish: demand a minimum rating volume so a 5★-from-2-votes
  // clip doesn't dethrone a 4.7★-from-150-votes monument.
  const top = kills
    .filter((k) => (k.rating_count ?? 0) >= 3 && k.avg_rating != null)
    .sort(
      (a, b) =>
        (b.avg_rating ?? 0) * Math.log2((b.rating_count ?? 0) + 1) -
        (a.avg_rating ?? 0) * Math.log2((a.rating_count ?? 0) + 1),
    )
    .slice(0, 12);

  return (
    <div className="space-y-12">
      <Breadcrumb items={[{ label: "Hall of Fame" }]} />
      <header>
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
          Karmine Corp
        </p>
        <h1 className="font-display text-4xl md:text-5xl font-black">
          <span className="text-shimmer">{t("p_hof.title")}</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-muted)]">
          {t("p_hof.subtitle")}
        </p>
      </header>

      {top.length > 0 && (
        <section>
          <h2 className="font-display text-2xl font-bold text-[var(--gold)]">
            {t("p_hof.top_rated")}
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {top.map((k, i) => (
              <Link
                key={k.id}
                href={`/kill/${k.id}`}
                className="group relative block overflow-hidden rounded-2xl border border-white/10 transition-all hover:border-[var(--gold)]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
              >
                <div className="relative aspect-[9/12] bg-[var(--bg-elevated)]">
                  {k.thumbnail_url && (
                    <Image
                      src={k.thumbnail_url}
                      alt={`${k.killer_champion ?? "?"} → ${k.victim_champion ?? "?"}`}
                      fill
                      sizes="(max-width: 640px) 50vw, 25vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/30" />
                  <span className="absolute left-3 top-3 font-display text-2xl font-black text-[var(--gold)] drop-shadow">
                    #{i + 1}
                  </span>
                  <div className="absolute inset-x-3 bottom-3">
                    <p className="truncate text-xs font-bold text-white">
                      {k.killer_champion} <span className="text-[var(--gold)]">→</span>{" "}
                      {k.victim_champion}
                    </p>
                    <p className="font-data text-[10px] text-[var(--gold)]">
                      ★ {k.avg_rating?.toFixed(1)} · {k.rating_count}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="font-display text-2xl font-bold text-[var(--gold)]">
          {t("p_hof.legendary")}
        </h2>
        <div className="mt-5">
          <HomeRareCards />
        </div>
      </section>
    </div>
  );
}
