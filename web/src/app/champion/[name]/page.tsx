import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { championLoadingUrl, championSplashUrl, championIconUrl } from "@/lib/constants";
import { ClipReel } from "@/components/ClipReel";
import { PortraitCubeMorph } from "@/components/PortraitCubeMorph";
import { getClipsFiltered } from "@/lib/supabase/clips";

export const revalidate = 600;

interface Props {
  params: Promise<{ name: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  const champ = decodeURIComponent(name);
  const title = `${champ} — Plays Karmine Corp`;
  const description = `Tous les kills LEC du champion ${champ} cote KC : kills donnes, kills subis, multi-kills, top highlights IA.`;
  return {
    title,
    description,
    alternates: { canonical: `/champion/${encodeURIComponent(champ)}` },
    openGraph: {
      title: `${champ} \u2014 KCKILLS`,
      description,
      type: "website",
      images: [championSplashUrl(champ)],
      siteName: "KCKILLS",
      locale: "fr_FR",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [championSplashUrl(champ)],
    },
  };
}

export default async function ChampionPage({ params }: Props) {
  const { name } = await params;
  const champ = decodeURIComponent(name);

  // Pull both sides upfront — we'll reuse for the matchup frequency
  // computation so no extra RPC round trip.
  const [asKiller, asVictim] = await Promise.all([
    getClipsFiltered({ killerChampion: champ }, 60),
    getClipsFiltered({ victimChampion: champ }, 60),
  ]);
  if (asKiller.length === 0 && asVictim.length === 0) notFound();
  const totalAsKiller = asKiller.length;
  const totalAsVictim = asVictim.length;

  // Count opponent champions — who does this champion fight most often?
  // Combines both directions so a champion the player meets frequently
  // surfaces whether it's their kill OR their death.
  const opponentCounts = new Map<string, number>();
  for (const k of asKiller) {
    const opp = k.victimChampion;
    if (opp && opp !== champ) opponentCounts.set(opp, (opponentCounts.get(opp) ?? 0) + 1);
  }
  for (const k of asVictim) {
    const opp = k.killerChampion;
    if (opp && opp !== champ) opponentCounts.set(opp, (opponentCounts.get(opp) ?? 0) + 1);
  }
  const topMatchups = [...opponentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  // ─── JSON-LD: champion-as-VideoCollection. Same CollectionPage shape
  //     used on /matchup/[a]/vs/[b], adapted to a single champion. The
  //     ItemList caps at 12 entries — Google rich-results doesn't reward
  //     dumping the full backlog and big payloads slow first paint.
  const totalClips = totalAsKiller + totalAsVictim;
  const championJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${champ} — Plays Karmine Corp`,
    description: `Tous les kills LEC du champion ${champ} côté KC.`,
    inLanguage: "fr-FR",
    isPartOf: { "@type": "WebSite", name: "KCKILLS", url: "https://kckills.com" },
    image: championSplashUrl(champ),
    about: {
      "@type": "VideoGame",
      name: "League of Legends",
      publisher: "Riot Games",
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: totalClips,
      itemListElement: [...asKiller, ...asVictim]
        .slice(0, 12)
        .map((k, i) => ({
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(championJsonLd) }}
      />
      {/* ─── HERO — cinematic with cube portrait morph ─── */}
      <section className="relative h-[72vh] min-h-[560px] w-full overflow-hidden bg-[var(--bg-primary)]">
        <Image
          src={championLoadingUrl(champ)}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover scale-110"
          style={{ filter: "brightness(0.22) saturate(1.15)" }}
        />
        <PortraitCubeMorph
          images={[championLoadingUrl(champ), championSplashUrl(champ)]}
          accent="#C8AA6E"
          cols={64}
          aspect={9 / 16}
          holdMs={5500}
          morphMs={2000}
          className="absolute inset-0 mix-blend-screen opacity-95"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)]/50 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-primary)]/85 via-transparent to-[var(--bg-primary)]/55" />

        <nav
          className="absolute top-6 left-6 right-6 z-20 flex items-center justify-between text-xs text-white/55"
          aria-label="Fil d'Ariane"
        >
          <Link href="/" className="hover:text-[var(--gold)] transition-colors">
            Accueil
          </Link>
          <span className="font-data uppercase tracking-widest text-white/40">Champion</span>
        </nav>

        <div className="relative z-10 mx-auto max-w-7xl h-full flex flex-col justify-end px-6 pb-12">
          <div className="flex items-end gap-6 mb-6">
            <div className="relative h-24 w-24 md:h-32 md:w-32 rounded-3xl overflow-hidden border-2 border-[var(--gold)]/45 shadow-2xl shadow-[var(--gold)]/30">
              <Image
                src={championIconUrl(champ)}
                alt={champ}
                fill
                sizes="128px"
                className="object-cover"
              />
            </div>
            <div>
              <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
                Plays par champion
              </p>
              <h1
                className="font-display font-black uppercase leading-[0.9] text-5xl md:text-7xl lg:text-8xl text-white"
                style={{
                  textShadow:
                    "0 0 60px rgba(200,170,110,0.5), 0 4px 20px rgba(0,0,0,0.85)",
                  letterSpacing: "-0.02em",
                }}
              >
                {champ}
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {totalAsKiller > 0 && (
              <span className="rounded-xl border border-[var(--gold)]/45 bg-[var(--gold)]/12 backdrop-blur-md px-4 py-2.5 font-display">
                <span className="text-2xl font-black text-[var(--gold)]">{totalAsKiller}</span>
                <span className="ml-2 text-xs uppercase tracking-widest text-[var(--gold)]/80">
                  kills donnes
                </span>
              </span>
            )}
            {totalAsVictim > 0 && (
              <span className="rounded-xl border border-[var(--red)]/45 bg-[var(--red)]/12 backdrop-blur-md px-4 py-2.5 font-display">
                <span className="text-2xl font-black text-[var(--red)]">{totalAsVictim}</span>
                <span className="ml-2 text-xs uppercase tracking-widest text-[var(--red)]/80">
                  kills subis
                </span>
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ─── CLIP REELS ────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-16 space-y-14">
        {totalAsKiller > 0 && (
          <ClipReel
            kicker={`${champ} en KC`}
            title={`Top kills sur ${champ}`}
            subtitle={`Plays cot\u00e9 KC ou ce champion termine l'adversaire. Class\u00e9s par score IA + rating communaut\u00e9.`}
            filter={{
              killerChampion: champ,
              trackedTeamInvolvement: "team_killer",
              minHighlight: 5,
            }}
            limit={9}
            ctaHref={`/clips?q=${encodeURIComponent(champ)}&sort=score`}
            ctaLabel="Tout voir dans /clips"
            emptyState={null}
          />
        )}

        {totalAsKiller > 0 && (
          <ClipReel
            kicker="Carry mode"
            title={`Multi-kills + clutch sur ${champ}`}
            subtitle="First Bloods, doubles+ et plays au score IA \u2265 7.5."
            filter={{
              killerChampion: champ,
              trackedTeamInvolvement: "team_killer",
              minHighlight: 7.5,
            }}
            limit={6}
            emptyState={null}
          />
        )}

        {totalAsVictim > 0 && (
          <ClipReel
            kicker="L'envers du d\u00e9cor"
            title={`Quand ${champ} se fait piquer`}
            subtitle="Kills cote adversaire. Utile pour comprendre les counter-picks et les death patterns."
            filter={{
              victimChampion: champ,
              trackedTeamInvolvement: "team_victim",
            }}
            limit={6}
            emptyState={null}
          />
        )}

        {/* ─── MATCHUPS — quels champions ce champion croise le plus ─── */}
        {topMatchups.length > 0 && (
          <section className="space-y-5">
            <header>
              <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
                Matchups frequents
              </p>
              <h2 className="font-display text-2xl md:text-3xl font-black text-[var(--text-primary)]">
                {champ} face a...
              </h2>
              <p className="mt-1 text-sm text-[var(--text-muted)] max-w-2xl">
                Les champions que {champ} croise le plus souvent dans le catalogue. Click pour
                voir tous les clips de ce match-up.
              </p>
            </header>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {topMatchups.map(([opp, count]) => (
                <Link
                  key={opp}
                  href={`/matchup/${encodeURIComponent(champ)}/vs/${encodeURIComponent(opp)}`}
                  className="group flex items-center gap-3 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3 transition-all hover:border-[var(--gold)]/55 hover:-translate-y-0.5"
                >
                  <div className="relative h-14 w-14 rounded-xl overflow-hidden border border-[var(--gold)]/30 flex-shrink-0">
                    <Image
                      src={championIconUrl(champ)}
                      alt={champ}
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  </div>
                  <span className="text-[var(--gold)]/55 text-2xl font-display">vs</span>
                  <div className="relative h-14 w-14 rounded-xl overflow-hidden border border-[var(--red)]/40 flex-shrink-0">
                    <Image
                      src={championIconUrl(opp)}
                      alt={opp}
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-bold text-white truncate group-hover:text-[var(--gold)] transition-colors">
                      {opp}
                    </p>
                    <p className="font-data text-[10px] uppercase tracking-widest text-white/50">
                      {count} confrontation{count > 1 ? "s" : ""}
                    </p>
                  </div>
                  <svg
                    className="h-4 w-4 text-white/35 group-hover:text-[var(--gold)] transition-colors flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}
