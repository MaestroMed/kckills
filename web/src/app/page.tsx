import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { loadRealData, getCurrentRoster, getMatchesSorted } from "@/lib/real-data";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";
import { getStaticT } from "@/lib/i18n/server-lang";
// 🔴 2026-04-28 — heavy desktop-only sections live in a client wrapper
// file (`homepage-desktop-sections.tsx`) because Next.js 15 forbids
// `next/dynamic({ssr:false})` directly inside server components. The
// wrappers handle the dynamic import + the DesktopOnly gate themselves
// so this server page just renders them like any other component.
// Wave 13h (2026-05-07) — hero RIGHT column extracted to its own async
// server component so the LEFT column (title + CTAs + roster pills) can
// stream into the static shell without blocking on the four Supabase
// queries that feed the right cards. The Suspense fallback paints a
// fixed-dimension skeleton in the same column slot → zero CLS.
import { HeroLiveStats, HeroLiveStatsSkeleton } from "@/components/home/HeroLiveStats";
// Wave 13j (2026-05-07) — generic skeleton for below-the-fold async
// sections. Each section becomes its own Suspense boundary so the HTML
// streams progressively rather than blocking the entire homepage on
// the slowest below-fold Supabase query.
import { SectionSkeleton } from "@/components/home/SectionSkeleton";
// Wave 11 — AudioPlayer (legacy BCC vibes FAB) replaced by the global
// WolfFloatingPlayer mounted in Providers.tsx. Same UX (auto-fire on
// first user gesture once opted in) but persistent across pages + with
// the new wolf-shaped UI + dual playlist (homepage / scroll).
// import { AudioPlayer } from "@/components/AudioPlayer";
// HomeFilteredContent removed — was a duplicate of /matches page
import { HomeRecentClips } from "@/components/HomeRecentClips";
// Wave 28 (2026-05-11) — "Ce jour-là dans l'histoire KC". Nostalgia
// banner that surfaces past-year kills played on today's calendar date.
import { HomeTimelineFeed } from "@/components/timeline/HomeTimelineFeed";
// QuoteCard import removed — was unused since the QuoteRotator replaced it.
// HomeQuoteRotator + EraComparisonChart now lazy-loaded via next/dynamic above
import { MacronEasterEgg } from "@/components/MacronEasterEgg";
import { HeroImageCarousel } from "@/components/HeroImageCarousel";
import { HERO_IMAGES } from "@/lib/hero-images";
import { NextMatchOverlay } from "@/components/NextMatchOverlay";
import { HeroWeather } from "@/components/weather/HeroWeather";
import { PageViewTracker } from "@/components/analytics/PageViewTracker";
import { HomeHero } from "@/components/home/HomeHero";
import { activeHomeTheme, toClientTheme } from "@/lib/home-themes";
import { fetchNextKcMatch } from "@/lib/next-match-server";
// Scroll Vivant (HomeGridSection) retiré de l'accueil le 24/09/2026 :
// trop de cases vides tant que la grille n'est pas finie (Mehdi). Le
// composant reste dans components/home/ pour la refonte.

// 2026-08-12 — code mort supprimé : buildHeroClips() + YOUTUBE_HERO_CLIPS.
// La fonction exécutait loadHeroVideos() + getPublishedKills(5) côté
// serveur sans qu’aucun rendu ne consomme son résultat — le hero affiche
// HeroImageCarousel (photos) depuis que la vidéo de fond a été retirée
// pour le poids. Pour ré-épingler un montage événementiel, passer par
// /admin/hero-videos (les composants dédiés lisent ce store), pas par ce
// fichier.

// Bumped 60s → 300s → 1800s (Wave 13d, 2026-04-28). Supabase free tier
// audit found 80k DB requests/24h driven mostly by SSR refetches on
// every cache miss. Homepage data (kill-of-the-week, stats, roster)
// doesn't change by the minute — 30 min ISR cuts DB pressure by 6x
// vs the previous 5 min. Live Banner + NextMatchOverlay still poll
// separately for sub-minute freshness, so the user-perceived
// "liveness" is unchanged.
export const revalidate = 1800;

export default async function HomePage() {
  const { t } = getStaticT();
  const data = loadRealData();
  const roster = getCurrentRoster(data);
  const allMatches = getMatchesSorted(data);
  // Thème du jour (lib/home-themes) : prochain match officiel s'il est dans sa
  // fenêtre, sinon thèmes datés, sinon maison (ISR 30 min). KCKILLS_HOME_THEME
  // force un thème (aperçu local).
  const next = await fetchNextKcMatch().catch(() => null);
  const theme = activeHomeTheme(new Date(), process.env.KCKILLS_HOME_THEME, next);


  // Les requêtes de la colonne droite du hero (clip de la semaine, dernier
  // match, nombre de clips) vivent dans <HeroLiveStats>, sous <Suspense> :
  // le titre et les CTA partent tout de suite, le squelette a les mêmes
  // dimensions que les cartes (zéro CLS).

  return (
    <div
      className="-mt-6"
      data-home-theme={theme.id}
      data-home-theme-json={JSON.stringify(toClientTheme(theme))}
      style={{
        ["--theme-primary" as string]: theme.palette.primary,
        ["--theme-accent" as string]: theme.palette.accent,
        ["--theme-glow" as string]: theme.palette.glow,
        // Full-bleed: break out of the parent <main max-w-7xl> container
        // so the hero, roster bands, timeline and clips grid can span the
        // entire viewport width instead of being caged at 1280px.
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      {/* Wave 11 — legacy AudioPlayer FAB replaced by the global
          WolfFloatingPlayer mounted in Providers.tsx. Same auto-fire-on-
          first-gesture UX, but persistent across navigations + animated
          wolf head + dual playlist (homepage ambient / scroll hype). */}

      {/* Analytics — fire-and-forget page.viewed event on mount. */}
      <PageViewTracker pageId="home" />

      <HomeHero theme={theme} roster={roster} allMatches={allMatches} />

      {/* ═══ KC TIMELINE + DEFAULT FEED ════════════════════════════════
          Per CLAUDE.md §6.2 : the timeline is a horizontal era strip
          that filters the kills feed below it. When NO era is selected
          (default), HomeRecentClips is shown. When the user picks an
          era card, the strip renders that era's clips instead. The
          state lives client-side so the heavy homepage RSC never
          re-renders on selection. */}
      <HomeTimelineFeed>
        <Suspense fallback={<SectionSkeleton size="xl" label={t("p_home.loading_recent_clips")} />}>
          <HomeRecentClips />
        </Suspense>
      </HomeTimelineFeed>

      {/* ═══ DISCOVERY STRIP — 3 curated entry points to go deeper ═════ */}
      <section className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        <div className="grid gap-3 md:grid-cols-3">
          <Link
            href="/week"
            className="group flex items-center gap-3 rounded-xl border border-[var(--cyan)]/30 bg-gradient-to-br from-[var(--cyan)]/10 via-[var(--bg-surface)] to-[var(--bg-surface)] p-4 hover:border-[var(--cyan)]/60 transition-all hover:-translate-y-0.5"
          >
            <span className="text-2xl">▽</span>
            <div className="flex-1 min-w-0">
              <p className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--cyan)]/70">
                {t("p_home.disco_weekly_kicker")}
              </p>
              <p className="font-display text-sm font-bold text-white group-hover:text-[var(--cyan)] transition-colors">
                {t("p_home.disco_this_week")}
              </p>
            </div>
            <svg className="h-4 w-4 text-[var(--cyan)]/40 group-hover:text-[var(--cyan)] group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          <Link
            href="/records"
            className="group flex items-center gap-3 rounded-xl border border-[var(--gold)]/30 bg-gradient-to-br from-[var(--gold)]/10 via-[var(--bg-surface)] to-[var(--bg-surface)] p-4 hover:border-[var(--gold)]/60 transition-all hover:-translate-y-0.5"
          >
            <span className="text-2xl">★</span>
            <div className="flex-1 min-w-0">
              <p className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--gold)]/70">
                {t("p_home.disco_hall_of_fame")}
              </p>
              <p className="font-display text-sm font-bold text-white group-hover:text-[var(--gold)] transition-colors">
                {t("p_home.disco_records")}
              </p>
            </div>
            <svg className="h-4 w-4 text-[var(--gold)]/40 group-hover:text-[var(--gold)] group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          <Link
            href="/clips?multi=1&sort=score"
            className="group flex items-center gap-3 rounded-xl border border-[var(--orange)]/30 bg-gradient-to-br from-[var(--orange)]/10 via-[var(--bg-surface)] to-[var(--bg-surface)] p-4 hover:border-[var(--orange)]/60 transition-all hover:-translate-y-0.5"
          >
            <span className="text-2xl">⚡</span>
            <div className="flex-1 min-w-0">
              <p className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--orange)]/70">
                {t("p_home.disco_highlights")}
              </p>
              <p className="font-display text-sm font-bold text-white group-hover:text-[var(--orange)] transition-colors">
                {t("p_home.disco_pentas_multi")}
              </p>
            </div>
            <svg className="h-4 w-4 text-[var(--orange)]/40 group-hover:text-[var(--orange)] group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </section>

      {/* 2026-09-24 : le bloc « Dernier match » lu dans kc_matches.json
          (figé sur KC-VIT, Week 1) est retiré ; le hero affiche le vrai
          dernier match depuis la base. */}
    </div>
  );
}
