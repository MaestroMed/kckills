/**
 * HeroLiveStats — async server component for the homepage hero RIGHT column.
 *
 * Wave 13h (2026-05-07) — extracted from `app/page.tsx` so the hero's left
 * column (title shimmer + CTAs + roster pills) can stream into the
 * static shell IMMEDIATELY, without waiting on the four Supabase
 * queries that feed the right-column cards. Wrap this in a
 * <Suspense fallback={<HeroLiveStatsSkeleton />}> on the page and the
 * skeleton paints in the same column dimensions while the live data
 * resolves — zero CLS, faster FCP / LCP / TTI.
 *
 * The four queries (clip count, last match, career stats, top scorer)
 * still fan out via `Promise.all` here, so total latency is still
 * bounded by the slowest one — we just stop blocking the rest of the
 * hero on it.
 */

import Link from "next/link";
import Image from "next/image";
import { type RealData, type RosterPlayer, displayRole } from "@/lib/real-data";
import { PLAYER_PHOTOS, TEAM_LOGOS, KC_LOGO } from "@/lib/kc-assets";
import { getPublishedKcKillCount } from "@/lib/supabase/kills";
import {
  getHeroLastMatch,
  getHeroCareerStats,
  getHeroTopScorer,
} from "@/lib/supabase/hero-stats";
import { type RosterPlayerStat } from "@/components/HomeTopScorerCarousel";
import { HomeTopScorerCarouselSection } from "@/components/homepage-desktop-sections";
import { AnimatedNumber } from "@/components/AnimatedNumber";

interface HeroLiveStatsProps {
  roster: RosterPlayer[];
  isEmpty: boolean;
  stats: ReturnType<typeof import("@/lib/real-data").getTeamStats>;
  allMatches: RealData["matches"];
}

export async function HeroLiveStats({
  roster,
  isEmpty,
  stats,
  allMatches,
}: HeroLiveStatsProps) {
  // ─── Live data fetch — parallel ───────────────────────────────────
  // `buildTime: true` opts into the cookie-less anon Supabase client so
  // the page stays cacheable per its `revalidate` ISR setting. Each
  // loader rethrows DynamicError and falls back to `null` on Supabase
  // failure → the cards degrade to the static real-data.ts snapshot
  // below if the DB is unreachable.
  const [clipCount, liveLastMatch, liveCareer, liveTopScorer] =
    await Promise.all([
      getPublishedKcKillCount({ buildTime: true }),
      getHeroLastMatch(true),
      getHeroCareerStats(true),
      getHeroTopScorer(true),
    ]);

  // ─── Carousel computation (achievements based on live + static) ───
  const computeKda = (p: RosterPlayer) =>
    p.totalDeaths > 0
      ? (p.totalKills + p.totalAssists) / p.totalDeaths
      : p.totalKills + p.totalAssists;
  const liveTopIgn = liveTopScorer?.ign?.toLowerCase() ?? "";
  const sortedByKills = [...roster].sort((a, b) => b.totalKills - a.totalKills);
  const top5 = sortedByKills.slice(0, 5);

  // ─── Hero card display variables (live → fallback chain) ──────────
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
    <div className="md:col-span-5 lg:col-span-6 flex flex-col gap-3 md:max-w-sm md:ml-auto">
      {/* Last match card */}
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
  );
}

/**
 * Skeleton — renders fixed-dimension placeholders matching the live card
 * heights (last match ~88 px, career stats ~120 px, top-scorer ~88 px)
 * so the Suspense fallback paints in the same column box and there's
 * zero CLS when the data resolves.
 */
export function HeroLiveStatsSkeleton() {
  return (
    <div
      className="md:col-span-5 lg:col-span-6 flex flex-col gap-3 md:max-w-sm md:ml-auto"
      aria-hidden="true"
    >
      <div className="rounded-xl bg-black/55 backdrop-blur-md border border-[var(--gold)]/20 px-5 py-4 h-[88px] animate-pulse" />
      <div className="rounded-xl bg-black/55 backdrop-blur-md border border-[var(--gold)]/20 px-5 py-4 h-[120px] animate-pulse" />
      <div className="rounded-xl bg-black/55 backdrop-blur-md border border-[var(--gold)]/20 px-5 py-4 h-[88px] animate-pulse" />
    </div>
  );
}
