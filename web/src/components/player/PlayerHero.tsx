import Image from "next/image";
import Link from "next/link";
import { championLoadingUrl } from "@/lib/constants";
import { PortraitCubeMorph } from "@/components/PortraitCubeMorph";
import { JerseyNumberWatermark } from "./JerseyNumberWatermark";
import { PlayerStatsHero } from "./PlayerStatsHero";

export interface PlayerHeroProps {
  name: string;
  /** Player photo URL or null when missing. */
  photo?: string | null;
  /** First champion in pool — drives the splash backdrop. */
  signatureChampion: string;
  /** Custom Hextech-bg URL — falls back silently if absent. */
  customBgUrl?: string;
  /** Images fed to the cube-morph (photo first, then champ splashes). */
  morphImages: string[];
  /** Jersey number — by signing order. */
  jerseyNumber: number;
  /** 4-up KDA bar payload. */
  stats: {
    kda: string;
    gamesPlayed: number;
    avgKills: string;
    avgDeaths: string;
    avgAssists: string;
    winRate: number;
  };
  /** Achievement strip lines — "ARMÉE KC", "ROOKIE OF YEAR 2025", etc. */
  achievements?: string[];
  /** First / last match year for the "{first} — {last}" tagline. */
  yearRange?: { first: string; last: string };
  /** Prev / next chevron-cards on left/right edges. */
  prevPlayer?: { slug: string; name: string };
  nextPlayer?: { slug: string; name: string };
}

/**
 * PlayerHero — full-bleed 90vh hero for /player/[slug] :
 *   - Champion loading backdrop (darkened)
 *   - Optional Hextech custom-bg (mix-blend overlay)
 *   - PortraitCubeMorph centred
 *   - Jersey number watermark behind the name
 *   - Massive Cinzel Black name (10rem+ at lg)
 *   - Achievement strip
 *   - 4-up KDA stats
 *   - Prev / Next chevron cards on the edges
 *
 * The component is server-side except for PortraitCubeMorph (already
 * a client component) and the two micro-client children (JerseyWatermark
 * + LegendSeal). Stays static and SEO-friendly.
 */
export function PlayerHero({
  name,
  photo,
  signatureChampion,
  customBgUrl,
  morphImages,
  jerseyNumber,
  stats,
  achievements = [],
  yearRange,
  prevPlayer,
  nextPlayer,
}: PlayerHeroProps) {
  return (
    <section className="relative h-[90vh] min-h-[720px] w-full overflow-hidden bg-[var(--bg-primary)]">
      {/* Champion-art backdrop */}
      <Image
        src={championLoadingUrl(signatureChampion)}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover scale-110"
        style={{ filter: "brightness(0.22) saturate(1.15)" }}
      />

      {customBgUrl && (
        <Image
          src={customBgUrl}
          alt=""
          fill
          sizes="100vw"
          className="object-cover scale-105 mix-blend-overlay"
          style={{ filter: "brightness(0.7) saturate(1.05)", opacity: 0.55 }}
        />
      )}

      {/* Cube-portrait morph */}
      <PortraitCubeMorph
        images={morphImages}
        accent="#C8AA6E"
        cols={68}
        aspect={9 / 16}
        holdMs={5800}
        morphMs={2100}
        className="absolute inset-0 mix-blend-screen opacity-95"
      />

      {/* Dark vignettes */}
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)]/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-primary)] via-transparent to-[var(--bg-primary)]/70" />

      {/* Gold accent gradient */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 60% at 20% 50%, rgba(200,170,110,0.15) 0%, transparent 60%)",
        }}
      />

      {/* Scanlines */}
      <div
        className="absolute inset-0 opacity-15 mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.1) 3px, transparent 4px)",
        }}
        aria-hidden
      />

      {/* Jersey watermark behind everything text-related */}
      <JerseyNumberWatermark number={jerseyNumber} accent="#C8AA6E" />

      {/* Breadcrumb */}
      <nav
        className="absolute top-6 left-6 z-30 flex items-center gap-2 text-xs text-white/50"
        aria-label="Fil d'Ariane"
      >
        <Link href="/" className="hover:text-[var(--gold)]">
          Accueil
        </Link>
        <span className="text-[var(--gold)]/30" aria-hidden>
          ◆
        </span>
        <Link href="/players" className="hover:text-[var(--gold)]">
          Joueurs
        </Link>
        <span className="text-[var(--gold)]/30" aria-hidden>
          ◆
        </span>
        <span className="text-[var(--gold)]">{name}</span>
      </nav>

      {/* Prev / Next chevron cards on the edges */}
      {prevPlayer && (
        <Link
          href={`/player/${encodeURIComponent(prevPlayer.slug)}`}
          aria-label={`Joueur precedent : ${prevPlayer.name}`}
          className="absolute left-3 md:left-5 top-1/2 -translate-y-1/2 z-30 hidden md:flex flex-col items-center gap-2 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/70 backdrop-blur-md px-3 py-4 hover:bg-[var(--bg-surface)] hover:border-[var(--gold)]/60 transition-all focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2"
        >
          <svg
            className="h-5 w-5 text-[var(--gold)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
          <span
            className="font-display text-[10px] font-black uppercase tracking-widest text-white/80 [writing-mode:vertical-rl] [transform:rotate(180deg)]"
          >
            {prevPlayer.name}
          </span>
        </Link>
      )}
      {nextPlayer && (
        <Link
          href={`/player/${encodeURIComponent(nextPlayer.slug)}`}
          aria-label={`Joueur suivant : ${nextPlayer.name}`}
          className="absolute right-3 md:right-5 top-1/2 -translate-y-1/2 z-30 hidden md:flex flex-col items-center gap-2 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/70 backdrop-blur-md px-3 py-4 hover:bg-[var(--bg-surface)] hover:border-[var(--gold)]/60 transition-all focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2"
        >
          <svg
            className="h-5 w-5 text-[var(--gold)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
          <span
            className="font-display text-[10px] font-black uppercase tracking-widest text-white/80 [writing-mode:vertical-rl]"
          >
            {nextPlayer.name}
          </span>
        </Link>
      )}

      {/* Player photo — right side */}
      {photo && (
        <div className="absolute bottom-0 right-0 h-[95%] w-[55%] md:w-[45%] lg:w-[40%] z-10 pointer-events-none">
          <Image
            src={photo}
            alt={name}
            fill
            priority
            sizes="(max-width: 768px) 55vw, (max-width: 1024px) 45vw, 40vw"
            className="object-contain object-bottom"
            style={{ filter: "drop-shadow(0 20px 80px rgba(200,170,110,0.25))" }}
          />
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[80%] h-2 rounded-full blur-2xl opacity-60"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--gold), transparent)",
            }}
            aria-hidden
          />
        </div>
      )}

      {/* Content — left */}
      <div className="relative z-20 h-full max-w-7xl mx-auto flex flex-col justify-end px-6 pb-16">
        {/* Team tag */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="rounded-md px-3 py-1 font-data text-[11px] font-bold tracking-[0.2em] uppercase backdrop-blur-sm border border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)]">
            Karmine Corp
          </span>
          <span
            className="rounded-md px-3 py-1 font-data text-[11px] font-bold tracking-[0.2em] uppercase border border-white/20 bg-white/5 text-white/80"
            aria-label="Numero de maillot par ordre de signature"
          >
            #{String(jerseyNumber).padStart(2, "0")}
          </span>
          {yearRange && (
            <span className="font-data text-xs text-white/50 tracking-[0.2em] uppercase">
              {yearRange.first} — {yearRange.last}
            </span>
          )}
        </div>

        {/* Massive name */}
        <h1
          className="font-display font-black leading-[0.85] text-7xl md:text-9xl lg:text-[11rem] text-white break-words max-w-full"
          style={{
            textShadow:
              "0 0 60px rgba(200,170,110,0.25), 0 6px 40px rgba(0,0,0,0.8)",
          }}
        >
          {name.toUpperCase()}
        </h1>

        {/* Achievement strip */}
        {achievements.length > 0 && (
          <ul
            className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2"
            aria-label="Titres et distinctions"
          >
            {achievements.map((a, i) => (
              <li key={i} className="flex items-center gap-2">
                {i > 0 && (
                  <span className="text-[var(--gold)]/40 text-xs" aria-hidden>
                    ◆
                  </span>
                )}
                <span className="font-display text-[10px] md:text-xs font-black uppercase tracking-[0.22em] text-[var(--gold-bright)]">
                  {a}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* KDA bar */}
        <PlayerStatsHero stats={stats} accent="var(--gold)" />
      </div>

      {/* Scroll hint */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 text-white/30"
        aria-hidden
      >
        <span className="text-[10px] uppercase tracking-[0.3em]">Citation</span>
        <svg className="h-4 w-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </div>
    </section>
  );
}
