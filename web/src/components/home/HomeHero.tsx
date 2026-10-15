/**
 * Hero de l'accueil, habillé par un thème (lib/home-themes) : photos, météo,
 * affiche de match ou titre KCKILLS, colonne de droite (HeroLiveStats).
 * Utilisé par l'accueil et par l'aperçu de la galerie (/themes/[id]).
 */
import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";
import { getStaticT } from "@/lib/i18n/server-lang";
import { HeroLiveStats, HeroLiveStatsSkeleton } from "@/components/home/HeroLiveStats";
import { MacronEasterEgg } from "@/components/MacronEasterEgg";
import { HeroImageCarousel } from "@/components/HeroImageCarousel";
import { HERO_IMAGES } from "@/lib/hero-images";
import { NextMatchOverlay } from "@/components/NextMatchOverlay";
import { HeroWeather } from "@/components/weather/HeroWeather";
import { MatchDayHero } from "@/components/home/MatchDayHero";
import { HomeOpening } from "@/components/home/HomeOpening";
import type { HomeTheme } from "@/lib/home-themes";
import type { getCurrentRoster, getMatchesSorted } from "@/lib/real-data";

export function HomeHero({
  theme,
  roster,
  allMatches,
  preview = false,
}: {
  theme: HomeTheme;
  roster: ReturnType<typeof getCurrentRoster>;
  allMatches: ReturnType<typeof getMatchesSorted>;
  /** Aperçu de la galerie : l'affiche ne suit pas le calendrier en direct. */
  preview?: boolean;
}) {
  const { t } = getStaticT();
  const spotlight = Boolean(theme.spotlight);
  return (
    <>
      {/* Ouverture (une fois par session ; pas dans les aperçus de la galerie) */}
      {!preview && <HomeOpening theme={theme} />}
      {/* ═══ HERO — 2-col layout with clip rotator (full-bleed via parent) ═══ */}
      <section className="relative min-h-[100vh] md:min-h-[92vh] overflow-hidden">
        {/* Fond du hero : carrousel de photos, plus de vidéo. Un seul clip
            pesait 19,4 Mo en autoPlay, soit 85 % du poids de la page d'accueil
            téléchargés avant même le premier scroll. Les photos passent par
            next/image — deux ordres de grandeur plus légères, et plus nettes
            en plein écran qu'une vidéo compressée étirée. */}
        <HeroImageCarousel images={HERO_IMAGES} />

        {/* Very light overlays — let the video breathe and feel alive.
            Only the bottom fade stays strong to blend into the next section.
            No side vignettes — the cards themselves have dark backdrops. */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-[var(--bg-primary)] pointer-events-none" />
        {/* Voile du thème (ex. ivoire du maillot Worlds) */}
        <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ background: theme.palette.veil }} />
        {spotlight && <div aria-hidden className="matchday-backdrop absolute inset-0 pointer-events-none" />}
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />

        {/* Météo du jour (forme de la KC, lib/mood) : pluie, soleil, nuages,
            éclairs — sur la photo, sous le texte. Montée après l'idle. */}
        <HeroWeather />

        {/* ─── Floating "next rendez-vous" overlay — top-right of hero ─── */}
        {/* L'affiche du jour de match porte déjà le rendez-vous. */}
        {!spotlight && <NextMatchOverlay />}

        {/* ─── Full-width 2-column grid on desktop ───
            Mobile : pt-44 (et non py-24) pour que le logo KC + la rangée
            de tags démarrent SOUS la carte flottante « PROCHAIN RDV »
            (absolue, top 5.5rem + ~70px de haut) au lieu d'être
            recouverts. md:py-0 inchangé → placement desktop intact. */}
        <div className={`relative z-10 min-h-[100vh] md:min-h-[92vh] max-w-[1920px] lg:max-w-7xl mx-auto px-6 md:px-10 lg:px-16 ${spotlight ? "pt-28" : "pt-44"} pb-24 md:py-0 flex flex-col md:grid md:grid-cols-12 md:items-center gap-8`}>

          {/* ─── LEFT : title + tagline + CTAs ─── */}
          <div className="md:col-span-7 lg:col-span-6 flex flex-col items-center md:items-start text-center md:text-left">
            {spotlight ? (
              <MatchDayHero theme={theme} preview={preview} />
            ) : (
              <>
            {/* Tag row */}
            <div style={{ ["--i" as string]: 0 }} className="hero-in inline-flex items-center gap-3 mb-6">
              <MacronEasterEgg />
              <span className="rounded-full border border-[var(--gold)]/30 bg-black/50 backdrop-blur-sm px-4 py-1.5 text-[11px] font-bold tracking-[0.2em] uppercase text-[var(--gold)]">
                {theme.kicker}
              </span>
            </div>

            {/* Title — metallic gold shimmer with breathing glow.
                The .hero-title-glow wrapper uses filter: drop-shadow which
                respects the actual rendered gradient pixels (unlike
                text-shadow which creates black silhouettes on the
                transparent-fill shimmer text). Subtle 4s breathe animates
                scale + glow intensity. */}
            <h1 style={{ ["--i" as string]: 1 }} className="hero-in font-display font-black tracking-tight leading-[0.82] text-6xl md:text-7xl lg:text-[9rem]">
              <span className="hero-title-glow">
                <span className="text-shimmer">KCKILLS</span>
              </span>
            </h1>

            <p
              className="mt-5 max-w-md text-base md:text-lg lg:text-xl text-white/85 font-medium"
              style={{ textShadow: "0 2px 12px rgba(0,0,0,0.9)" }}
            >
              Every kill. Rated. Remembered.
            </p>

            {/* CTAs */}
            <div style={{ ["--i" as string]: 3 }} className="hero-in mt-8 flex items-center gap-3 md:justify-start justify-center flex-wrap">
              <Link
                href="/scroll"
                className="rounded-xl bg-[var(--gold)] px-8 py-4 font-display text-sm font-black uppercase tracking-widest text-[var(--bg-primary)] transition-all hover:bg-[var(--gold-bright)] hover:shadow-2xl hover:shadow-[var(--gold)]/30 hover:scale-[1.03] active:scale-95"
              >
                {t("p_home.cta_scroll_kills")}
              </Link>
              <Link
                href="/matches"
                className="rounded-xl border border-[var(--border-gold)] bg-black/30 backdrop-blur-sm px-8 py-4 font-display text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)] transition-all hover:border-[var(--gold)]/50 hover:text-[var(--gold)]"
              >
                {t("p_home.cta_matches")}
              </Link>
              <Link
                href="/clips"
                className="rounded-xl border border-white/15 bg-black/20 backdrop-blur-sm px-6 py-4 font-display text-sm font-bold uppercase tracking-widest text-white/70 transition-all hover:border-white/40 hover:text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <span className="text-[var(--gold)]">&#9658;</span>
                  {t("p_home.cta_all_clips")}
                </span>
              </Link>
            </div>

              </>
            )}

            {/* Jour de match : les cinq de KC, en grand, avec leur nom */}
            {spotlight && roster.length > 0 && (
              <div style={{ ["--i" as string]: 5 }} className="hero-in matchday-roster mt-10 w-full">
                <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--theme-accent)]/80 mb-3">
                  {t("p_home_matchday.roster")}
                </p>
                <div className="flex justify-center md:justify-start gap-3 md:gap-4">
                  {roster.slice(0, 5).map((p) => {
                    const photo = PLAYER_PHOTOS[p.name];
                    return (
                      <Link key={p.name} href={`/player/${encodeURIComponent(p.name)}`} className="matchday-player group flex flex-col items-center">
                        <span className="matchday-player-photo relative block overflow-hidden">
                          {photo ? <Image src={photo} alt={p.name} width={64} height={64} className="h-full w-full object-cover object-top" /> : null}
                        </span>
                        <span className="mt-1.5 font-display text-[11px] font-black uppercase tracking-[0.1em] text-white/85 group-hover:text-[var(--theme-accent)]">
                          {p.name}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Small roster pill row — shows active LEC 2026 roster */}
            {!spotlight && roster.length > 0 && (
              <div className="mt-10 hidden md:flex items-center gap-3">
                <span className="font-data text-[9px] uppercase tracking-[0.25em] text-white/40">
                  {t("p_home.roster_spring_2026")}
                </span>
                <div className="flex -space-x-2">
                  {roster.slice(0, 5).map((p) => {
                    const photo = PLAYER_PHOTOS[p.name];
                    return photo ? (
                      <Link
                        key={p.name}
                        href={`/player/${encodeURIComponent(p.name)}`}
                        className="relative h-9 w-9 rounded-full border-2 border-[var(--gold)]/40 bg-[var(--bg-surface)] overflow-hidden hover:scale-110 hover:z-10 hover:border-[var(--gold)] transition-all"
                        title={p.name}
                      >
                        <Image
                          src={photo}
                          alt={p.name}
                          width={36}
                          height={36}
                          className="object-cover object-top"
                        />
                      </Link>
                    ) : null;
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ─── RIGHT : vertical stack of info cards ─── */}
          {/* Wave 13h — streamed via Suspense. Skeleton paints in the
              same column box (matched fixed heights → zero CLS) while
              the four Supabase queries resolve in parallel inside
              HeroLiveStats. The static hero LEFT (title + CTAs +
              roster pills) renders to the client without waiting. */}
          <Suspense fallback={<HeroLiveStatsSkeleton />}>
            <HeroLiveStats allMatches={allMatches} />
          </Suspense>
        </div>

        {/* Jour de match : bandeau défilant façon habillage TV */}
        {spotlight && theme.spotlight && (
          <div aria-hidden style={{ ["--i" as string]: 7 }} className="hero-in matchday-ticker absolute inset-x-0 bottom-7 z-10 overflow-hidden">
            <div className="matchday-ticker-track">
              {Array.from({ length: 2 }).map((_, k) => (
                <span key={k} className="matchday-ticker-run">
                  {Array.from({ length: 6 }).map((__, i) => (
                    <span key={i} className="inline-flex items-center gap-6 pr-6">
                      <span>KC</span>
                      <span className="matchday-ticker-vs">vs</span>
                      <span>{theme.spotlight!.opponentCode}</span>
                      <span className="matchday-ticker-dot" />
                      <span>{theme.spotlight!.competition}</span>
                      <span className="matchday-ticker-dot" />
                      <span>{theme.spotlight!.stage}</span>
                      <span className="matchday-ticker-dot" />
                      <span>{theme.spotlight!.format}</span>
                      <span className="matchday-ticker-dot" />
                    </span>
                  ))}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Scroll indicator — tiny, bottom center */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 animate-bounce z-10 hidden md:block">
          <svg className="h-5 w-5 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>

        {/* Riot disclaimer — discrete, bottom of hero */}
        <p
          aria-label="Riot Games disclaimer"
          className="pointer-events-none absolute inset-x-0 bottom-1 z-10 px-4 text-center text-[8px] uppercase tracking-widest text-white/30"
        >
          Not endorsed by Riot Games. League of Legends &copy; Riot Games.
        </p>
      </section>
    </>
  );
}
