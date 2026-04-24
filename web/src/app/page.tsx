import Link from "next/link";
import Image from "next/image";
import { loadRealData, getCurrentRoster, getTeamStats, getMatchesSorted, displayRole } from "@/lib/real-data";
import { championIconUrl, championSplashUrl } from "@/lib/constants";
import { PLAYER_PHOTOS, TEAM_LOGOS, KC_LOGO } from "@/lib/kc-assets";
import { getPublishedKills } from "@/lib/supabase/kills";
import { AudioPlayer } from "@/components/AudioPlayer";
// HomeFilteredContent removed — was a duplicate of /matches page
import { HomeRareCards } from "@/components/HomeRareCards";
import { HomeYouTubeShowcase } from "@/components/HomeYouTubeShowcase";
import { KillOfTheWeek } from "@/components/KillOfTheWeek";
import { HomeRecentClips } from "@/components/HomeRecentClips";
import { HomeTimelineFeed } from "@/components/timeline/HomeTimelineFeed";
import { QuoteCard } from "@/components/QuoteCard";
import { QUOTES } from "@/lib/quotes";
import { HomeQuoteRotator } from "@/components/HomeQuoteRotator";
import { EraComparisonChart } from "@/components/EraComparison";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { MacronEasterEgg } from "@/components/MacronEasterEgg";
import { HeroClipBackground } from "@/components/HeroClipBackground";
import { NextMatchOverlay } from "@/components/NextMatchOverlay";
import { PageViewTracker } from "@/components/analytics/PageViewTracker";
// ScrollVivantSection deleted (2026-04-20) — was a dead grid prototype that
// never made it to production. The /scroll v2 player handles the live feed
// and /clips handles the cards-grid use case it was meant to fill.

/** Iconic clips that play in the hero background, one after the other.
 *
 *  CURATED for maximum impact — only the best outplays and highest-emotion
 *  moments make the cut. Ordered to tell a story: highlights first, then
 *  reactions, then individual plays.
 *
 *  Minimum duration is 22s per clip so short clips (like the 34s Rekkles
 *  pentakill) play through their entirety before rotating.
 *
 *  To add more clips, paste the full YouTube watch URL in the list — the
 *  extractYouTubeId helper handles it. Curation is manual on purpose so
 *  we never show a random clip on the hero.
 *
 *  TODO (user request): admin backoffice to edit this list without a deploy
 */
/**
 * Build the hero clips array: top-scored R2 kills first (no CAPTCHA, instant),
 * then YouTube fallback reels for variety. Called from the server component so
 * we can query Supabase.
 */
async function buildHeroClips() {
  const topKills = await getPublishedKills(5);
  const r2Clips = topKills
    .filter((k) => k.clip_url_horizontal)
    .slice(0, 3)
    .map((k) => ({
      mp4Url: k.clip_url_horizontal!,
      title: k.ai_description ?? `${k.killer_champion} \u2192 ${k.victim_champion}`,
      context: `Game ${k.games?.game_number ?? "?"} \u00b7 ${k.games?.matches?.stage ?? "LEC"}`,
      durationMs: 15000,
    }));

  const youtubeClips = YOUTUBE_HERO_CLIPS;

  // R2 clips rank first — they're instant, no CAPTCHA, CDN-cached.
  // If pipeline hasn't run yet (0 R2 clips), we fall back to YouTube only.
  return [...r2Clips, ...youtubeClips];
}

const YOUTUBE_HERO_CLIPS = [
  // --- Individual outplays (the real killers) ---
  {
    videoId: "pMSFp7wku5Y",
    title: "Vladi Viktor 10/1/7 — Game 3 MVP run",
    context: "Le Sacre · Vladi MVP",
    durationMs: 30000,
    start: 15,
  },
  {
    videoId: "j9JlExfa9mY",
    title: "REKKLES PENTAKILL JINX vs GameWard",
    context: "L'Ere Rekkles · LFL 2022",
    durationMs: 34000, // clip is only 36s total, play nearly full
    start: 3,
  },
  {
    videoId: "EfN64vP2n2o",
    title: "Top 10 Caliste Plays — Best of 2025",
    context: "Caliste · Rookie of the Year",
    durationMs: 28000,
    start: 5,
  },
  // --- Emotional moments / backstage ---
  {
    videoId: "AelCWTFNOZQ",
    title: "« WE ARE THE CHAMPIONS ! » — KC VoiceComms",
    context: "Le Sacre · Backstage",
    durationMs: 25000,
    start: 5,
  },
  {
    videoId: "VXdc0Q2HdCg",
    title: "Le discours de Kameto apres la finale",
    context: "Le Sacre · Post-match",
    durationMs: 25000,
    start: 10,
  },
  // --- Comebacks ---
  {
    videoId: "8AJP6HleZh8",
    title: "KC vs CFO — Un match dans la legende",
    context: "First Stand · Seoul 2025",
    durationMs: 25000,
    start: 60,
  },
];

// Bumped from 60s to 300s for scale — the homepage doesn't change by the
// second (kill-of-the-week, stats, roster all stable for minutes). 5-min
// cache reduces Vercel function invokes + Supabase egress by 5x under
// traffic. The Live Banner + NextMatchOverlay still poll separately for
// sub-minute freshness.
export const revalidate = 300;

export default async function HomePage() {
  const data = loadRealData();
  const roster = getCurrentRoster(data);
  const stats = getTeamStats(data);
  const allMatches = getMatchesSorted(data);
  const isEmpty = data.total_matches === 0;
  const HERO_CLIPS = await buildHeroClips();

  // Live clip count from Supabase (KC team_killer + visible only)
  const allKills = await getPublishedKills(500);
  const clipCount = allKills.filter(
    (k) => k.tracked_team_involvement === "team_killer" && k.kill_visible !== false,
  ).length;

  // Champion splash for the #1 player (most kills)
  const topPlayer = [...roster].sort((a, b) => b.totalKills - a.totalKills)[0];
  const heroChamp = topPlayer?.champions[0] ?? "Jhin";

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
      {/* BCC Vibes ambient player — auto-arms on first visit, fires on
          first user gesture (click/touch/keydown anywhere), floating
          FAB bottom-right with quick-dismiss ×. Hint bubble shows for
          6s on first visit to tell user what's about to happen. */}
      <AudioPlayer />

      {/* Analytics — fire-and-forget page.viewed event on mount. */}
      <PageViewTracker pageId="home" />

      {/* ═══ HERO — 2-col layout with clip rotator (full-bleed via parent) ═══ */}
      <section className="relative min-h-[100vh] md:min-h-[92vh] overflow-hidden">
        <HeroClipBackground clips={HERO_CLIPS} posterSrc="/images/hero-bg.jpg" />

        {/* Very light overlays — let the video breathe and feel alive.
            Only the bottom fade stays strong to blend into the next section.
            No side vignettes — the cards themselves have dark backdrops. */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-[var(--bg-primary)] pointer-events-none" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />

        {/* ─── Floating "next rendez-vous" overlay — top-right of hero ─── */}
        <NextMatchOverlay />

        {/* ─── Full-width 2-column grid on desktop ─── */}
        <div className="relative z-10 min-h-[100vh] md:min-h-[92vh] max-w-[1920px] mx-auto px-6 md:px-10 lg:px-16 py-24 md:py-0 flex flex-col md:grid md:grid-cols-12 md:items-center gap-8">

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
                Scroll les kills
              </Link>
              <Link
                href="/matches"
                className="rounded-xl border border-[var(--border-gold)] bg-black/30 backdrop-blur-sm px-8 py-4 font-display text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)] transition-all hover:border-[var(--gold)]/50 hover:text-[var(--gold)]"
              >
                Matchs
              </Link>
              <Link
                href="/clips"
                className="rounded-xl border border-white/15 bg-black/20 backdrop-blur-sm px-6 py-4 font-display text-sm font-bold uppercase tracking-widest text-white/70 transition-all hover:border-white/40 hover:text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <span className="text-[var(--gold)]">&#9658;</span>
                  Tous les clips
                </span>
              </Link>
            </div>

            {/* Small roster pill row — shows active LEC 2026 roster */}
            {roster.length > 0 && (
              <div className="mt-10 hidden md:flex items-center gap-3">
                <span className="font-data text-[9px] uppercase tracking-[0.25em] text-white/40">
                  Roster Spring 2026
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
          <div className="md:col-span-5 lg:col-span-6 flex flex-col gap-3 md:max-w-sm md:ml-auto">
            {/* Next / last match card */}
            {allMatches.length > 0 && (() => {
              const lastMatch = allMatches[0];
              const oppLogo = TEAM_LOGOS[lastMatch.opponent.code];
              const date = new Date(lastMatch.date);
              return (
                <Link
                  href={`/match/${lastMatch.id}`}
                  className="group rounded-xl bg-black/55 backdrop-blur-md border border-[var(--gold)]/20 px-5 py-4 transition-all hover:border-[var(--gold)]/50 hover:bg-black/70"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--gold)]/60">
                      Dernier match
                    </span>
                    <span className="text-[9px] text-white/40 font-data">
                      {date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Image src={KC_LOGO} alt="KC" width={32} height={32} className="rounded-md flex-shrink-0" />
                      <div className="font-data text-2xl font-black tabular-nums">
                        <span className={lastMatch.kc_won ? "text-[var(--green)]" : "text-white/50"}>
                          {lastMatch.kc_score}
                        </span>
                        <span className="text-white/20 mx-1.5">-</span>
                        <span className={!lastMatch.kc_won ? "text-[var(--red)]" : "text-white/50"}>
                          {lastMatch.opp_score}
                        </span>
                      </div>
                      {oppLogo ? (
                        <Image src={oppLogo} alt={lastMatch.opponent.code} width={32} height={32} className="rounded-md flex-shrink-0" />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-xs font-bold flex-shrink-0">
                          {lastMatch.opponent.code}
                        </div>
                      )}
                    </div>
                    <span
                      className={`ml-3 rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-widest border ${
                        lastMatch.kc_won
                          ? "bg-[var(--green)]/15 border-[var(--green)]/40 text-[var(--green)]"
                          : "bg-[var(--red)]/15 border-[var(--red)]/40 text-[var(--red)]"
                      }`}
                    >
                      {lastMatch.kc_won ? "W" : "L"}
                    </span>
                  </div>
                  <p className="mt-2 text-[10px] text-white/40 uppercase tracking-wider">
                    {lastMatch.stage} &middot; Bo{lastMatch.best_of} &middot; Voir le d&eacute;tail &rarr;
                  </p>
                </Link>
              );
            })()}

            {/* Career stats card */}
            {!isEmpty && (
              <div className="rounded-xl bg-black/55 backdrop-blur-md border border-[var(--gold)]/20 px-5 py-4">
                <p className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--gold)]/60 mb-2">
                  Carri&egrave;re LEC &middot; 2024 &rarr; 2026
                </p>
                <div className="flex items-baseline gap-2 mb-2">
                  <AnimatedNumber
                    value={stats.totalKills}
                    duration={2}
                    className="font-data text-5xl lg:text-6xl font-black text-[var(--gold)] tabular-nums leading-none"
                  />
                  <span className="text-xs text-white/50 uppercase tracking-widest font-semibold">kills</span>
                </div>
                <div className="flex items-center gap-3 text-xs font-data">
                  <span className="flex items-baseline gap-1">
                    <AnimatedNumber value={stats.wins} duration={1.6} className="text-[var(--green)] font-bold text-lg" />
                    <span className="text-[9px] uppercase tracking-wider text-white/40">W</span>
                  </span>
                  <span className="text-white/15">&bull;</span>
                  <span className="flex items-baseline gap-1">
                    <AnimatedNumber value={stats.losses} duration={1.6} className="text-[var(--red)] font-bold text-lg" />
                    <span className="text-[9px] uppercase tracking-wider text-white/40">L</span>
                  </span>
                  <span className="text-white/15">&bull;</span>
                  <span className="flex items-baseline gap-1">
                    <AnimatedNumber value={stats.totalGames} duration={1.6} className="font-bold text-lg text-white" />
                    <span className="text-[9px] uppercase tracking-wider text-white/40">G</span>
                  </span>
                  <span className="text-white/15">&bull;</span>
                  <span className="flex items-baseline gap-1">
                    <AnimatedNumber
                      // Guard against an empty roster (no matches) — division
                      // would yield NaN and render "NaN%". Showing 0% reads
                      // cleaner on the cold-start case.
                      value={
                        stats.wins + stats.losses > 0
                          ? (stats.wins / (stats.wins + stats.losses)) * 100
                          : 0
                      }
                      duration={1.8}
                      format="percent1"
                      className="text-[var(--gold)] font-bold text-lg"
                    />
                    <span className="text-[9px] uppercase tracking-wider text-white/40">WR</span>
                  </span>
                  {clipCount > 0 && (
                    <>
                      <span className="text-white/15">&bull;</span>
                      <span className="flex items-baseline gap-1">
                        <AnimatedNumber value={clipCount} duration={1.8} className="text-[var(--cyan)] font-bold text-lg" />
                        <span className="text-[9px] uppercase tracking-wider text-white/40">CLIPS</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Top scorer of current split */}
            {topPlayer && (
              <Link
                href={`/player/${encodeURIComponent(topPlayer.name)}`}
                className="group rounded-xl bg-black/55 backdrop-blur-md border border-[var(--gold)]/20 px-5 py-4 transition-all hover:border-[var(--gold)]/50 hover:bg-black/70"
              >
                <p className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--gold)]/60 mb-2">
                  Top scorer carri&egrave;re
                </p>
                <div className="flex items-center gap-3">
                  {PLAYER_PHOTOS[topPlayer.name] ? (
                    <Image
                      src={PLAYER_PHOTOS[topPlayer.name]}
                      alt={topPlayer.name}
                      width={44}
                      height={44}
                      className="rounded-full border border-[var(--gold)]/40 object-cover object-top"
                    />
                  ) : (
                    <div className="h-11 w-11 rounded-full bg-[var(--gold)]/20 flex items-center justify-center font-display font-black text-[var(--gold)]">
                      {topPlayer.name[0]}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-lg font-black text-white truncate group-hover:text-[var(--gold)] transition-colors">
                      {topPlayer.name}
                    </p>
                    <p className="text-[10px] text-white/50 font-data uppercase tracking-wider">
                      {displayRole(topPlayer.role)} &middot; {topPlayer.gamesPlayed} games
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-data text-2xl font-black text-[var(--gold)] tabular-nums leading-none">
                      {topPlayer.totalKills}
                    </p>
                    <p className="text-[9px] text-white/40 uppercase tracking-wider mt-1">kills</p>
                  </div>
                </div>
              </Link>
            )}
          </div>
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

      {/* ═══ KILL OF THE WEEK — surface the featured clip first ═════════ */}
      <KillOfTheWeek />

      {/* ═══ KC TIMELINE + DEFAULT FEED ════════════════════════════════
          Per CLAUDE.md §6.2 : the timeline is a horizontal era strip
          that filters the kills feed below it. When NO era is selected
          (default), HomeRecentClips is shown. When the user picks an
          era card, the strip renders that era's clips instead. The
          state lives client-side so the heavy homepage RSC never
          re-renders on selection. */}
      <HomeTimelineFeed>
        <HomeRecentClips />
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
                Hebdomadaire
              </p>
              <p className="font-display text-sm font-bold text-white group-hover:text-[var(--cyan)] transition-colors">
                Cette semaine
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
                Hall of Fame
              </p>
              <p className="font-display text-sm font-bold text-white group-hover:text-[var(--gold)] transition-colors">
                Records Absolus
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
                Highlights
              </p>
              <p className="font-display text-sm font-bold text-white group-hover:text-[var(--orange)] transition-colors">
                Pentakills & Multi
              </p>
            </div>
            <svg className="h-4 w-4 text-[var(--orange)]/40 group-hover:text-[var(--orange)] group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </section>

      {/* ═══ ROSTER — Full width, tall bands ════════════════════════════ */}
      {roster.length > 0 && (
        <section className="relative overflow-hidden py-2">
          <div className="flex flex-col md:flex-row md:h-[70vh] md:min-h-[500px]">
            {roster.map((player, i) => {
              const photo = PLAYER_PHOTOS[player.name];
              const champ = player.champions[0] ?? "Jhin";
              return (
                <Link
                  key={player.name}
                  href={`/player/${encodeURIComponent(player.name)}`}
                  className="roster-band group relative flex-1 h-48 md:h-auto overflow-hidden border-b md:border-b-0 md:border-r border-[var(--border-gold)] last:border-r-0 last:border-b-0 transition-all duration-700 md:hover:flex-[2] md:hover:z-10"
                >
                  {/* Background — player photo or champion splash */}
                  {photo ? (
                    <Image src={photo} alt={player.name} fill sizes="(max-width: 768px) 100vw, 20vw" className="object-cover object-top transition-all duration-700 group-hover:scale-105 group-hover:brightness-110" />
                  ) : (
                    <Image
                      src={championSplashUrl(champ)}
                      alt=""
                      fill
                      sizes="(max-width: 768px) 100vw, 20vw"
                      className="object-cover opacity-40 transition-all duration-700 group-hover:scale-110 group-hover:opacity-60"
                    />
                  )}

                  {/* Gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent transition-all duration-500 group-hover:from-black/95 group-hover:via-black/20" />

                  {/* Greyscale effect — all bands greyscale when any is hovered */}
                  <div className="absolute inset-0 transition-all duration-500" />

                  {/* Content — bottom */}
                  <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 z-10">
                    {/* Champions */}
                    <div className="flex gap-1.5 mb-3 opacity-60 group-hover:opacity-100 transition-opacity">
                      {player.champions.slice(0, 4).map((c) => (
                        <Image key={c} src={championIconUrl(c)} alt={c} width={24} height={24} className="rounded-full border border-black/50" data-tooltip={c} />
                      ))}
                    </div>

                    {/* Name + role */}
                    <p className="font-display text-xl md:text-3xl font-black text-white group-hover:text-[var(--gold)] transition-colors duration-300">
                      {player.name}
                    </p>
                    <p className="text-xs uppercase tracking-[0.2em] text-white/50 mt-1">{displayRole(player.role)}</p>

                    {/* Stats — always visible on mobile (no hover), hidden by default on desktop and revealed on hover */}
                    <div className="mt-3 overflow-hidden max-h-40 md:max-h-0 md:group-hover:max-h-40 transition-all duration-500">
                      <div className="flex gap-4 text-sm font-data">
                        <div>
                          <span className="text-[var(--green)] font-bold">{player.totalKills}</span>
                          <span className="text-white/30 text-xs ml-0.5">K</span>
                        </div>
                        <div>
                          <span className="text-[var(--red)] font-bold">{player.totalDeaths}</span>
                          <span className="text-white/30 text-xs ml-0.5">D</span>
                        </div>
                        <div>
                          <span className="text-white/80 font-bold">{player.totalAssists}</span>
                          <span className="text-white/30 text-xs ml-0.5">A</span>
                        </div>
                      </div>
                      <p className="font-data text-[10px] text-white/30 mt-1">{player.gamesPlayed} games</p>
                    </div>
                  </div>

                  {/* Role badge top-right */}
                  <div className="absolute top-3 right-3 z-10 rounded-md bg-black/60 backdrop-blur-sm px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--gold)] opacity-0 group-hover:opacity-100 transition-opacity">
                    {displayRole(player.role)}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══ ROTATING CITATIONS — slow rotation, particle dissolve ═════ */}
      {/* Replaces the daily QuoteCard. Real verified quotes from KC players,
          casters and staff. Each quote types in (≈40ms/char), holds for
          ~10s, then dissolves into a particle drift before the next one
          appears. prefers-reduced-motion is respected — text shows up
          instantly without animation for users who opted out. */}
      <section
        className="-mx-6 md:-mx-8 lg:-mx-12 my-8"
        style={{
          background:
            "linear-gradient(180deg, transparent, rgba(15,29,54,0.4) 30%, rgba(15,29,54,0.4) 70%, transparent)",
        }}
      >
        <HomeQuoteRotator quotes={QUOTES} />
      </section>

      {/* ═══ CARTES LEGENDAIRES — TCG visual layer en showcase home ═════ */}
      <HomeRareCards />

      {/* ═══ YOUTUBE PARALLAX SHOWCASE (RSS-driven 3D carousel) ═══════════ */}
      <HomeYouTubeShowcase />

      {/* ═══ ERA COMPARISON CHARTS ═══════════════════════════════════════ */}
      {(() => {
        // Group matches by year-split to build era stats
        const eraPeriods = [
          { key: "2024 W", filter: (d: string) => d >= "2024-01-01" && d < "2024-04-01" },
          { key: "2024 Sp", filter: (d: string) => d >= "2024-03-01" && d < "2024-06-01" },
          { key: "2024 Su", filter: (d: string) => d >= "2024-06-01" && d < "2024-10-01" },
          { key: "2025 W", filter: (d: string) => d >= "2025-01-01" && d < "2025-04-01" },
          { key: "2025 Sp", filter: (d: string) => d >= "2025-03-01" && d < "2025-06-01" },
          { key: "2025 Su", filter: (d: string) => d >= "2025-06-01" && d < "2025-10-01" },
          { key: "2026 V", filter: (d: string) => d >= "2026-01-01" && d < "2026-03-01" },
          { key: "2026 Sp", filter: (d: string) => d >= "2026-03-01" && d < "2026-07-01" },
        ];
        const eraData = eraPeriods
          .map((era) => {
            const matches = allMatches.filter((m) => era.filter(m.date));
            if (matches.length === 0) return null;
            const wins = matches.filter((m) => m.kc_won).length;
            const totalGames = matches.reduce((a, m) => a + m.games.length, 0);
            const kcKills = matches.reduce((a, m) => a + m.games.reduce((b, g) => b + g.kc_kills, 0), 0);
            const oppKills = matches.reduce((a, m) => a + m.games.reduce((b, g) => b + g.opp_kills, 0), 0);
            return {
              era: era.key,
              period: era.key,
              matches: matches.length,
              wins,
              losses: matches.length - wins,
              winRate: Math.round((wins / matches.length) * 100),
              avgKcKills: totalGames > 0 ? +(kcKills / totalGames).toFixed(1) : 0,
              avgOppKills: totalGames > 0 ? +(oppKills / totalGames).toFixed(1) : 0,
            };
          })
          .filter(Boolean) as { era: string; period: string; matches: number; wins: number; losses: number; winRate: number; avgKcKills: number; avgOppKills: number }[];

        if (eraData.length < 2) return null;
        return (
          <section>
            <div className="flex items-center gap-3 mb-6">
              <span className="h-px flex-1 bg-[var(--border-gold)]" />
              <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
                Evolution KC par ere
              </span>
              <span className="h-px flex-1 bg-[var(--border-gold)]" />
            </div>
            <EraComparisonChart data={eraData} />
          </section>
        );
      })()}

      {/* HomeFilteredContent removed — duplicate of /matches page */}

      {/* ═══ LAST MATCH — Full section ══════════════════════════════════ */}
      {allMatches.length > 0 && allMatches[0].games.length > 0 && (() => {
        const match = allMatches[0];
        const oppLogo = TEAM_LOGOS[match.opponent.code];
        const bgChamp = match.games[0]?.kc_players?.find(p => p.name.startsWith("KC "))?.champion ?? "Jhin";
        return (
          <section className="relative overflow-hidden py-8">
            <Image
              src={championSplashUrl(bgChamp)}
              alt=""
              fill
              sizes="100vw"
              className="object-cover opacity-[0.04]"
            />
            <div className="relative z-10 px-4 max-w-7xl mx-auto space-y-4">
              <h2 className="font-display text-xl font-bold">
                Dernier <span className="text-gold-gradient">match</span>
              </h2>

              <Link href={`/match/${match.id}`} className="flex items-center gap-4 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/80 backdrop-blur-sm p-5 hover:border-[var(--gold)]/40 transition-colors">
                <Image src={KC_LOGO} alt="KC" width={48} height={48} className="rounded-xl" />
                <span className="text-2xl font-bold text-[var(--text-disabled)]">vs</span>
                {oppLogo ? <Image src={oppLogo} alt={match.opponent.code} width={48} height={48} className="rounded-xl" /> : <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--bg-elevated)] font-bold">{match.opponent.code}</div>}
                <div className="flex-1">
                  <p className="font-display text-lg font-bold">
                    KC vs {match.opponent.code}
                    <span className={`ml-2 ${match.kc_won ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                      {match.kc_won ? "Victoire" : "D\u00e9faite"} {match.kc_score}-{match.opp_score}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">{match.stage}</p>
                </div>
              </Link>

              {match.games.map((game) => (
                <div key={game.id} className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/80 backdrop-blur-sm overflow-hidden">
                  <div className="flex items-center justify-between border-b border-[var(--border-gold)] px-5 py-3 bg-[var(--bg-primary)]/60">
                    <p className="font-display font-semibold">Game {game.number}</p>
                    <p className="font-data text-sm">
                      <span className="text-[var(--green)] font-bold">{game.kc_kills}</span>
                      <span className="text-[var(--text-disabled)]"> - </span>
                      <span className="text-[var(--red)] font-bold">{game.opp_kills}</span>
                    </p>
                  </div>
                  <div className="p-4 grid gap-1.5">
                    {game.kc_players.filter((p) => p.name.startsWith("KC ")).map((p) => {
                      const photo = PLAYER_PHOTOS[p.name.replace("KC ", "")];
                      return (
                        <Link key={p.name} href={`/player/${encodeURIComponent(p.name.replace("KC ", ""))}`}
                          className="flex items-center gap-3 rounded-lg bg-[var(--bg-primary)]/60 p-2.5 transition-all hover:bg-[var(--bg-elevated)] hover:pl-4">
                          {photo ? <Image src={photo} alt={p.name} width={34} height={34} className="rounded-full border border-[var(--gold)]/20 object-cover" /> : <Image src={championIconUrl(p.champion)} alt={p.champion} width={34} height={34} className="rounded-full border border-[var(--gold)]/20" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[var(--gold)]">{p.name.replace("KC ", "")}</p>
                            <p className="text-[10px] text-[var(--text-muted)]">{p.champion} &middot; {displayRole(p.role)}</p>
                          </div>
                          <p className="font-data text-sm font-semibold">
                            <span className="text-[var(--green)]">{p.kills}</span>/<span className="text-[var(--red)]">{p.deaths}</span>/<span className="text-[var(--text-secondary)]">{p.assists}</span>
                          </p>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })()}
    </div>
  );
}
