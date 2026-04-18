import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { championIconUrl, championLoadingUrl, championSplashUrl } from "@/lib/constants";
import { ClipReel } from "@/components/ClipReel";
import { PortraitCubeMorph } from "@/components/PortraitCubeMorph";
import { getClipsFiltered } from "@/lib/supabase/clips";

export const revalidate = 600;

interface Props {
  params: Promise<{ champA: string; champB: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { champA, champB } = await params;
  const a = decodeURIComponent(champA);
  const b = decodeURIComponent(champB);
  const title = `${a} vs ${b} — Match-up KC`;
  const description = `Tous les clips de la confrontation ${a} contre ${b} c\u00f4t\u00e9 Karmine Corp : qui domine, qui se fait piquer.`;
  const canonicalPath = `/matchup/${encodeURIComponent(a)}/vs/${encodeURIComponent(b)}`;
  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: `${a} vs ${b} \u2014 KCKILLS`,
      description,
      type: "website",
      images: [championSplashUrl(a), championSplashUrl(b)],
      siteName: "KCKILLS",
      locale: "fr_FR",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [championSplashUrl(a)],
    },
  };
}

export default async function MatchupPage({ params }: Props) {
  const { champA, champB } = await params;
  const a = decodeURIComponent(champA);
  const b = decodeURIComponent(champB);

  // Pull both directions of the matchup in parallel.
  const [aKillsB, bKillsA] = await Promise.all([
    getClipsFiltered(
      { killerChampion: a, victimChampion: b, trackedTeamInvolvement: "team_killer" },
      30,
    ),
    getClipsFiltered(
      { killerChampion: b, victimChampion: a, trackedTeamInvolvement: "team_victim" },
      30,
    ),
  ]);

  // Also pull the inverse on KC side (when KC plays b and meets a).
  const [bForKc, aAgainstKc] = await Promise.all([
    getClipsFiltered(
      { killerChampion: b, victimChampion: a, trackedTeamInvolvement: "team_killer" },
      30,
    ),
    getClipsFiltered(
      { killerChampion: a, victimChampion: b, trackedTeamInvolvement: "team_victim" },
      30,
    ),
  ]);

  const totalAOverB = aKillsB.length;
  const totalBOverA = bKillsA.length;
  const totalKcWith_b_pick = bForKc.length;
  const totalKcDeath_a_pick = aAgainstKc.length;

  // 404 if the catalog has nothing on this matchup at all.
  if (totalAOverB + totalBOverA + totalKcWith_b_pick + totalKcDeath_a_pick === 0) {
    notFound();
  }

  // ─── JSON-LD: tells Google this is a video collection about a specific
  //     LoL champion match-up. Two CollectionPage facets per matchup, one
  //     summarizing each side. Helps the rich-results crawler associate
  //     videos with the correct entity instead of treating each /kill/ as
  //     an island.
  const allClips = [...aKillsB, ...bKillsA, ...bForKc, ...aAgainstKc];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${a} vs ${b} — Match-up KC`,
    description: `Tous les clips de la confrontation ${a} contre ${b} côté Karmine Corp.`,
    inLanguage: "fr-FR",
    isPartOf: { "@type": "WebSite", name: "KCKILLS", url: "https://kckills.com" },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: allClips.length,
      itemListElement: allClips.slice(0, 12).map((k, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `https://kckills.com/kill/${k.id}`,
      })),
    },
  };

  return (
    <div
      className="-mt-6"
      style={{
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* ─── HERO — split-screen + cube morph ─── */}
      <section className="relative h-[70vh] min-h-[540px] w-full overflow-hidden bg-[var(--bg-primary)]">
        <Image
          src={championLoadingUrl(a)}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover scale-110"
          style={{ filter: "brightness(0.22) saturate(1.15)" }}
        />
        <PortraitCubeMorph
          images={[championLoadingUrl(a), championLoadingUrl(b), championSplashUrl(a), championSplashUrl(b)]}
          accent="#C8AA6E"
          cols={66}
          aspect={9 / 16}
          holdMs={4500}
          morphMs={2000}
          className="absolute inset-0 mix-blend-screen opacity-95"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)]/55 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-primary)]/85 via-transparent to-[var(--bg-primary)]/55" />

        <nav
          className="absolute top-6 left-6 right-6 z-20 flex items-center justify-between text-xs text-white/55"
          aria-label="Fil d'Ariane"
        >
          <Link href="/" className="hover:text-[var(--gold)] transition-colors">
            Accueil
          </Link>
          <span className="font-data uppercase tracking-widest text-white/40">Match-up</span>
        </nav>

        <div className="relative z-10 mx-auto max-w-7xl h-full flex flex-col justify-end px-6 pb-12">
          <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-4">
            Match-up champion
          </p>

          {/* Two-portrait header */}
          <div className="flex items-end gap-4 md:gap-8 mb-8">
            <ChampionPanel name={a} side="left" />
            <span className="font-display text-3xl md:text-5xl font-black text-white/40 mb-2">vs</span>
            <ChampionPanel name={b} side="right" />
          </div>

          {/* Score line */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-xl border border-[var(--gold)]/45 bg-[var(--gold)]/12 backdrop-blur-md px-4 py-2.5">
              <span className="text-2xl font-display font-black text-[var(--gold)]">
                {totalAOverB + totalBOverA + totalKcWith_b_pick + totalKcDeath_a_pick}
              </span>
              <span className="ml-2 text-xs uppercase tracking-widest text-[var(--gold)]/80">
                clips au total
              </span>
            </span>
          </div>
        </div>
      </section>

      {/* ─── REELS ────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-16 space-y-14">
        {totalAOverB > 0 && (
          <ClipReel
            kicker={`${a} domine ${b}`}
            title={`${a} (KC) → ${b}`}
            subtitle={`Quand KC pick ${a} face \u00e0 ${b}, voici les kills donn\u00e9s.`}
            filter={{
              killerChampion: a,
              victimChampion: b,
              trackedTeamInvolvement: "team_killer",
            }}
            limit={9}
            emptyState={null}
          />
        )}

        {totalKcDeath_a_pick > 0 && (
          <ClipReel
            kicker={`${a} se fait piquer par ${b}`}
            title={`${b} → ${a} (KC)`}
            subtitle={`Quand KC pick ${a} et se fait punir par ${b}.`}
            filter={{
              killerChampion: b,
              victimChampion: a,
              trackedTeamInvolvement: "team_victim",
            }}
            limit={6}
            emptyState={null}
          />
        )}

        {totalKcWith_b_pick > 0 && (
          <ClipReel
            kicker={`${b} (KC) domine ${a}`}
            title={`${b} → ${a}`}
            subtitle={`Quand KC pick ${b} et finit ${a}.`}
            filter={{
              killerChampion: b,
              victimChampion: a,
              trackedTeamInvolvement: "team_killer",
            }}
            limit={9}
            emptyState={null}
          />
        )}

        {totalBOverA > 0 && (
          <ClipReel
            kicker={`${b} se fait piquer`}
            title={`${a} → ${b} (KC se fait punir)`}
            subtitle={`KC pick ${b} et se fait piquer par ${a}.`}
            filter={{
              killerChampion: a,
              victimChampion: b,
              trackedTeamInvolvement: "team_victim",
            }}
            limit={6}
            emptyState={null}
          />
        )}
      </section>
    </div>
  );
}

function ChampionPanel({ name, side }: { name: string; side: "left" | "right" }) {
  return (
    <Link
      href={`/champion/${encodeURIComponent(name)}`}
      className="group flex flex-col items-center gap-2"
    >
      <div className="relative h-20 w-20 md:h-28 md:w-28 rounded-2xl overflow-hidden border-2 border-[var(--gold)]/45 shadow-2xl shadow-[var(--gold)]/30 transition-transform group-hover:scale-105">
        <Image
          src={championIconUrl(name)}
          alt={name}
          fill
          sizes="112px"
          className="object-cover"
        />
      </div>
      <span
        className="font-display text-xl md:text-3xl font-black text-white drop-shadow-lg"
        style={{ textShadow: "0 0 24px rgba(200,170,110,0.4), 0 4px 14px rgba(0,0,0,0.85)" }}
      >
        {name}
      </span>
    </Link>
  );
}
