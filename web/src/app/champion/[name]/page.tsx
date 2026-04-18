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

  // Pull a sample to verify the champion has any clips at all — bail
  // with 404 if the catalog has nothing on it. Saves rendering an
  // empty hero just to show "no clips found".
  const sample = await getClipsFiltered({ killerChampion: champ }, 1);
  const sampleVictim = await getClipsFiltered({ victimChampion: champ }, 1);
  if (sample.length === 0 && sampleVictim.length === 0) notFound();

  const totalAsKiller = sample.length > 0 ? (await getClipsFiltered({ killerChampion: champ }, 60)).length : 0;
  const totalAsVictim = sampleVictim.length > 0 ? (await getClipsFiltered({ victimChampion: champ }, 60)).length : 0;

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
            ctaHref={`/scroll?axis=killer_player_id&value=`}
            ctaLabel="Tout voir dans le scroll"
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
      </section>
    </div>
  );
}
