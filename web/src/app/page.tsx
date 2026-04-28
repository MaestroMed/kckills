import Link from "next/link";
import Image from "next/image";
import { loadRealData, getCurrentRoster, getTeamStats, getMatchesSorted, displayRole } from "@/lib/real-data";
import { championIconUrl, championSplashUrl } from "@/lib/constants";
import { PLAYER_PHOTOS, TEAM_LOGOS, KC_LOGO } from "@/lib/kc-assets";
import { getPublishedKills } from "@/lib/supabase/kills";
import {
  getHeroLastMatch,
  getHeroCareerStats,
  getHeroTopScorer,
} from "@/lib/supabase/hero-stats";
import { loadHeroVideos } from "@/lib/hero-videos/storage";
import { type RosterPlayerStat } from "@/components/HomeTopScorerCarousel";
import { getEraRosters } from "@/lib/era-rosters";
import { DesktopOnly } from "@/components/DesktopOnly";
// 🔴 2026-04-28 — heavy desktop-only sections live in a client wrapper
// file (`homepage-desktop-sections.tsx`) because Next.js 15 forbids
// `next/dynamic({ssr:false})` directly inside server components. The
// wrappers handle the dynamic import + the DesktopOnly gate themselves
// so this server page just renders them like any other component.
import {
  HomeRosterEraCarouselSection,
  HomeTopScorerCarouselSection,
  HomeQuoteRotatorSection,
  EraComparisonChartSection,
} from "@/components/homepage-desktop-sections";
// Wave 11 — AudioPlayer (legacy BCC vibes FAB) replaced by the global
// WolfFloatingPlayer mounted in Providers.tsx. Same UX (auto-fire on
// first user gesture once opted in) but persistent across pages + with
// the new wolf-shaped UI + dual playlist (homepage / scroll).
// import { AudioPlayer } from "@/components/AudioPlayer";
// HomeFilteredContent removed — was a duplicate of /matches page
import { HomeRareCards } from "@/components/HomeRareCards";
import { HomeYouTubeShowcase } from "@/components/HomeYouTubeShowcase";
import { KillOfTheWeek } from "@/components/KillOfTheWeek";
import { HomeRecentClips } from "@/components/HomeRecentClips";
import { HomeWeekendBestClips } from "@/components/HomeWeekendBestClips";
import { HomeTimelineFeed } from "@/components/timeline/HomeTimelineFeed";
// QuoteCard import removed — was unused since the QuoteRotator replaced it.
import { QUOTES } from "@/lib/quotes";
// HomeQuoteRotator + EraComparisonChart now lazy-loaded via next/dynamic above
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
  // Tier 1 \u2014 operator-curated MP4 montages (Wave 12 EF). Mehdi's own
  // edits / intros / backstage clips uploaded via /admin/hero-videos to
  // R2. They take priority because they're hand-picked, and their audio
  // plays when the user has opted-in via the wolf player.
  const operatorVideos = await loadHeroVideos();
  const operatorClips = operatorVideos.map((v) => ({
    mp4Url: v.videoUrl,
    posterUrl: v.posterUrl,
    title: v.title,
    context: v.context ?? "Hero curate",
    durationMs: v.durationMs,
    audioVolume: v.audioVolume,
  }));

  // Tier 2 \u2014 auto-pulled top published kills from R2 (best-of from the
  // pipeline). Muted (no caster audio worth playing on raw clips).
  const topKills = await getPublishedKills(5, { buildTime: true });
  const r2Clips = topKills
    .filter((k) => k.clip_url_horizontal)
    .slice(0, 3)
    .map((k) => ({
      mp4Url: k.clip_url_horizontal!,
      title: k.ai_description ?? `${k.killer_champion} \u2192 ${k.victim_champion}`,
      context: `Game ${k.games?.game_number ?? "?"} \u00b7 ${k.games?.matches?.stage ?? "LEC"}`,
      durationMs: 15000,
      audioVolume: 0,
    }));

  // Tier 3 — YouTube fallback reels for variety / when operator hasn't
  // uploaded anything yet (fresh deploy).
  const youtubeClips = YOUTUBE_HERO_CLIPS;

  // Operator clips first (curated), then R2 auto-best-of, then YouTube.
  return [...operatorClips, ...r2Clips, ...youtubeClips];
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

// Bumped 60s → 300s → 1800s (Wave 13d, 2026-04-28). Supabase free tier
// audit found 80k DB requests/24h driven mostly by SSR refetches on
// every cache miss. Homepage data (kill-of-the-week, stats, roster)
// doesn't change by the minute — 30 min ISR cuts DB pressure by 6x
// vs the previous 5 min. Live Banner + NextMatchOverlay still poll
// separately for sub-minute freshness, so the user-perceived
// "liveness" is unchanged.
export const revalidate = 1800;

export default async function HomePage() {
  const data = loadRealData();
  const roster = getCurrentRoster(data);
  const stats = getTeamStats(data);
  const allMatches = getMatchesSorted(data);
  const isEmpty = data.total_matches === 0;
  const HERO_CLIPS = await buildHeroClips();

  // Live data fetches in parallel — all opt into the cookie-less anon
  // Supabase client (`buildTime: true`) so the page stays cacheable per
  // its `revalidate = 300` ISR setting. Each loader rethrows DynamicError
  // and falls back to `null` on Supabase failure → the hero degrades to
  // the static real-data.ts snapshot below if the DB is unreachable.
  const [allKills, liveLastMatch, liveCareer, liveTopScorer] =
    await Promise.all([
      getPublishedKills(500, { buildTime: true }),
      getHeroLastMatch(true),
      getHeroCareerStats(true),
      getHeroTopScorer(true),
    ]);
  const clipCount = allKills.filter(
    (k) => k.tracked_team_involvement === "team_killer" && k.kill_visible !== false,
  ).length;

  // Champion splash for the #1 player (most kills) — keeps using real-data
  // for the splash because that's the only place we curate the per-player
  // signature champion list.
  const topPlayer = [...roster].sort((a, b) => b.totalKills - a.totalKills)[0];
  const heroChamp = topPlayer?.champions[0] ?? "Jhin";

  // Build the rotating-carousel data : 5 starters with their signature
  // achievement headline. Achievement label rules — first match wins :
  //   1. The live top scorer (live DB read)         → "Top kills"
  //   2. Highest in-roster KDA ≥ 4                  → "KDA Champion"
  //   3. Most kills in roster (after live top)      → "Sniper"
  //   4. Otherwise role-based fallback              → "Titulaire"
  // Falls back gracefully when the live top scorer can't be matched
  // against the static roster (different IGNs across data sources).
  // Note : RosterPlayer doesn't carry per-player winRate / pentas (those
  // would need a separate per-player stat join), so we lean on KDA +
  // total kills which are present.
  const computeKda = (p: typeof roster[number]) =>
    p.totalDeaths > 0
      ? (p.totalKills + p.totalAssists) / p.totalDeaths
      : p.totalKills + p.totalAssists; // "perfect" KDA — sky's the limit
  const liveTopIgn = liveTopScorer?.ign?.toLowerCase() ?? "";
  const sortedByKills = [...roster].sort((a, b) => b.totalKills - a.totalKills);
  const top5 = sortedByKills.slice(0, 5);
  // ─── Hero card display variables (live → fallback chain) ──────────
  // Each card renders from a unified shape so the JSX below stays the
  // same regardless of which data source provided the values. Live wins,
  // static is the safety net for cold-start / DB-down cases.
  const heroLastMatch = liveLastMatch
    ? {
        id: liveLastMatch.externalId ?? liveLastMatch.matchId,
        date: liveLastMatch.scheduledAt,
        opponent: liveLastMatch.opponent,
        kc_score: liveLastMatch.kcScore,
        opp_score: liveLastMatch.oppScore,
        kc_won: liveLastMatch.kcWon,
        stage: liveLastMatch.stage ?? "Saison",
        best_of: liveLastMatch.bestOf,
      }
    : allMatches.length > 0
      ? allMatches[0]
      : null;
  const heroCareerKills = liveCareer?.totalKills ?? stats.totalKills;
  const heroCareerWins = liveCareer?.wins ?? stats.wins;
  const heroCareerLosses = liveCareer?.losses ?? stats.losses;
  const heroCareerGames = liveCareer?.totalGames ?? stats.totalGames;
  const heroCareerWrPct =
    liveCareer && liveCareer.wins + liveCareer.losses > 0
      ? liveCareer.winRate * 100
      : stats.wins + stats.losses > 0
        ? (stats.wins / (stats.wins + stats.losses)) * 100
        : 0;
  const heroCareerClips = liveCareer?.publishedClips ?? clipCount;
  const heroCareerYearStart = liveCareer?.yearStart ?? 2024;
  const heroCareerYearEnd =
    liveCareer?.yearEnd ?? new Date().getUTCFullYear();

  const carouselPlayers: RosterPlayerStat[] = top5.map((p, i) => {
    const isLiveTop = !!liveTopIgn && p.name.toLowerCase().includes(liveTopIgn);
    const kda = computeKda(p);
    let achievementLabel = "Titulaire";
    let achievement = `${displayRole(p.role)} · ${p.gamesPlayed} games`;
    if (isLiveTop && liveTopScorer) {
      achievementLabel = "Top kills";
      achievement = `${liveTopScorer.totalKills} kills sur ${
        liveTopScorer.gamesPlayed || p.gamesPlayed
      } games — la machine offensive`;
    } else if (kda >= 4) {
      achievementLabel = "KDA Champion";
      achievement = `KDA ${kda.toFixed(2)} — le métronome`;
    } else if (i === 0) {
      // Roster top scorer (when live didn't match anyone)
      achievementLabel = "Sniper";
      achievement = `${p.totalKills} kills sur ${p.gamesPlayed} games — la machine offensive`;
    }
    return {
      ign: p.name,
      role: displayRole(p.role),
      imageUrl: PLAYER_PHOTOS[p.name] ?? null,
      totalKills: p.totalKills,
      gamesPlayed: p.gamesPlayed,
      winRate: 0,
      pentas: undefined,
      bestKda: kda,
      publishedClips: undefined,
      achievement,
      achievementLabel,
    };
  });

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
            {/* Next / last match card — live from Supabase if available,
                falls back to the static real-data.ts snapshot otherwise. */}
            {heroLastMatch && (() => {
              const lastMatch = heroLastMatch;
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
                  Carri&egrave;re LEC &middot; {heroCareerYearStart} &rarr; {heroCareerYearEnd}
                </p>
                <div className="flex items-baseline gap-2 mb-2">
                  <AnimatedNumber
                    value={heroCareerKills}
                    duration={2}
                    className="font-data text-5xl lg:text-6xl font-black text-[var(--gold)] tabular-nums leading-none"
                  />
                  <span className="text-xs text-white/50 uppercase tracking-widest font-semibold">kills</span>
                </div>
                {/* 🐛 2026-04-28 fix : `flex-wrap` + tighter gaps so the
                    five W/L/G/WR/CLIPS pills can fold to a second line on
                    the narrow right-rail (md:max-w-sm = 384 px) instead
                    of overflowing the card. The bullet separators were
                    moved into a flex-shrink-0 wrapper so the wrap point
                    falls between pills, not in the middle of one. */}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-data">
                  <span className="flex items-baseline gap-1 flex-shrink-0">
                    <AnimatedNumber value={heroCareerWins} duration={1.6} className="text-[var(--green)] font-bold text-lg" />
                    <span className="text-[9px] uppercase tracking-wider text-white/40">W</span>
                  </span>
                  <span className="text-white/15 flex-shrink-0">&bull;</span>
                  <span className="flex items-baseline gap-1 flex-shrink-0">
                    <AnimatedNumber value={heroCareerLosses} duration={1.6} className="text-[var(--red)] font-bold text-lg" />
                    <span className="text-[9px] uppercase tracking-wider text-white/40">L</span>
                  </span>
                  <span className="text-white/15 flex-shrink-0">&bull;</span>
                  <span className="flex items-baseline gap-1 flex-shrink-0">
                    <AnimatedNumber value={heroCareerGames} duration={1.6} className="font-bold text-lg text-white" />
                    <span className="text-[9px] uppercase tracking-wider text-white/40">G</span>
                  </span>
                  <span className="text-white/15 flex-shrink-0">&bull;</span>
                  <span className="flex items-baseline gap-1 flex-shrink-0">
                    <AnimatedNumber
                      value={heroCareerWrPct}
                      duration={1.8}
                      format="percent1"
                      className="text-[var(--gold)] font-bold text-lg"
                    />
                    <span className="text-[9px] uppercase tracking-wider text-white/40">WR</span>
                  </span>
                  {heroCareerClips > 0 && (
                    <>
                      <span className="text-white/15 flex-shrink-0">&bull;</span>
                      <span className="flex items-baseline gap-1 flex-shrink-0">
                        <AnimatedNumber value={heroCareerClips} duration={1.8} className="text-[var(--cyan)] font-bold text-lg" />
                        <span className="text-[9px] uppercase tracking-wider text-white/40">CLIPS</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Rotating spotlight on the 5 starters — desktop ; static
                lightweight top-scorer card fallback on mobile. */}
            {carouselPlayers.length > 0 && (
              <HomeTopScorerCarouselSection
                players={carouselPlayers}
                fallback={
                  <Link
                    href={`/player/${encodeURIComponent(carouselPlayers[0].ign)}`}
                    className="rounded-xl bg-black/55 backdrop-blur-md border border-[var(--gold)]/20 px-5 py-4"
                  >
                    <p className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--gold)]/60 mb-2">
                      {carouselPlayers[0].achievementLabel}
                    </p>
                    <div className="flex items-center gap-3">
                      {carouselPlayers[0].imageUrl ? (
                        <Image
                          src={carouselPlayers[0].imageUrl}
                          alt={carouselPlayers[0].ign}
                          width={44}
                          height={44}
                          className="rounded-full border border-[var(--gold)]/40 object-cover object-top"
                        />
                      ) : null}
                      <div className="flex-1 min-w-0">
                        <p className="font-display text-lg font-black text-white truncate">
                          {carouselPlayers[0].ign}
                        </p>
                        <p className="text-[10px] text-white/50 font-data uppercase tracking-wider">
                          {carouselPlayers[0].role} · {carouselPlayers[0].gamesPlayed} games
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-data text-2xl font-black text-[var(--gold)] tabular-nums leading-none">
                          {carouselPlayers[0].totalKills}
                        </p>
                        <p className="text-[9px] text-white/40 uppercase tracking-wider mt-1">kills</p>
                      </div>
                    </div>
                  </Link>
                }
              />
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

      {/* ═══ MEILLEURS CLIPS DU WEEK-END ═══════════════════════════════
          Section bien haut sous le hero, avant le Kill of the Week.
          Surface les clips publiés sur la fenêtre vendredi-dimanche
          en cours (ou le dernier week-end joué si on est en milieu
          de semaine). Re-ranke par score IA + boost multi-kill +
          boost communauté. Ne s'affiche pas si zéro clip dans le
          système (fresh deploy / worker pas encore tourné). */}
      <HomeWeekendBestClips />

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

      {/* ═══ ROSTER ERA CAROUSEL — Iconic lineup per year ═══════════════
          Wrapped in HomeRosterEraCarouselSection which gates on desktop
          AND lazy-loads via next/dynamic with ssr:false. */}
      <HomeRosterEraCarouselSection rosters={getEraRosters()} />

      {/* ═══ ROTATING CITATIONS — slow rotation, particle dissolve ═════
          Same lazy + DesktopOnly pattern. */}
      <HomeQuoteRotatorSection quotes={QUOTES} />

      {/* ═══ CARTES LEGENDAIRES — TCG visual layer en showcase home ═════ */}
      <HomeRareCards />

      {/* ═══ YOUTUBE PARALLAX SHOWCASE (RSS-driven 3D carousel) ═══════════
          🔴 DesktopOnly : the parallax 3D transforms + drag handlers +
          all the curated YouTube thumbnails were the heaviest single
          mobile-hostile section. Skipped entirely on mobile. */}
      <DesktopOnly>
        <HomeYouTubeShowcase />
      </DesktopOnly>

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
        return <EraComparisonChartSection data={eraData} />;
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
