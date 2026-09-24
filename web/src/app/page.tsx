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
import { PageViewTracker } from "@/components/analytics/PageViewTracker";
// Scroll Vivant grid — resurrected 2026-07-05 (Vague 3 of the
// award-winning plan) as the homepage marquee feature. Deleted
// 2026-04-20 as a "dead prototype" because its data dimensions were
// never populated; migrations 084 (deterministic time buckets) + 087
// (aligned WHERE) fixed the starvation. Desktop = full 2D engine,
// mobile = lightweight snap row, <4 cells = renders nothing.
import { HomeGridSection } from "@/components/home/HomeGridSection";

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


  // Les requêtes de la colonne droite du hero (clip de la semaine, dernier
  // match, nombre de clips) vivent dans <HeroLiveStats>, sous <Suspense> :
  // le titre et les CTA partent tout de suite, le squelette a les mêmes
  // dimensions que les cartes (zéro CLS).

  return (
    <div
      className="-mt-6"
      style={{
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
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />

        {/* ─── Floating "next rendez-vous" overlay — top-right of hero ─── */}
        <NextMatchOverlay />

        {/* ─── Full-width 2-column grid on desktop ───
            Mobile : pt-44 (et non py-24) pour que le logo KC + la rangée
            de tags démarrent SOUS la carte flottante « PROCHAIN RDV »
            (absolue, top 5.5rem + ~70px de haut) au lieu d'être
            recouverts. md:py-0 inchangé → placement desktop intact. */}
        <div className="relative z-10 min-h-[100vh] md:min-h-[92vh] max-w-[1920px] lg:max-w-7xl mx-auto px-6 md:px-10 lg:px-16 pt-44 pb-24 md:py-0 flex flex-col md:grid md:grid-cols-12 md:items-center gap-8">

          {/* ─── LEFT : title + tagline + CTAs ─── */}
          <div className="md:col-span-7 lg:col-span-6 flex flex-col items-center md:items-start text-center md:text-left">
            {/* Tag row */}
            <div className="inline-flex items-center gap-3 mb-6">
              <MacronEasterEgg />
              <span className="rounded-full border border-[var(--gold)]/30 bg-black/50 backdrop-blur-sm px-4 py-1.5 text-[11px] font-bold tracking-[0.2em] uppercase text-[var(--gold)]">
                Karmine Corp &middot; LEC
              </span>
            </div>

            {/* Title — metallic gold shimmer with breathing glow.
                The .hero-title-glow wrapper uses filter: drop-shadow which
                respects the actual rendered gradient pixels (unlike
                text-shadow which creates black silhouettes on the
                transparent-fill shimmer text). Subtle 4s breathe animates
                scale + glow intensity. */}
            <h1 className="font-display font-black tracking-tight leading-[0.82] text-6xl md:text-7xl lg:text-[9rem]">
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
            <div className="mt-8 flex items-center gap-3 md:justify-start justify-center flex-wrap">
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

            {/* Small roster pill row — shows active LEC 2026 roster */}
            {roster.length > 0 && (
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

      {/* ═══ SCROLL VIVANT — la grille des kills ════════════════════════
          2026-09-24 (accueil « clips d'abord ») : passe APRÈS la frise et
          les clips récents. Le « Kill of the week » a quitté cette place :
          le clip de la semaine ouvre désormais le hero (HeroClip). */}
      <Suspense fallback={<SectionSkeleton size="lg" label={t("p_grid.heading")} />}>
        <HomeGridSection />
      </Suspense>

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
