import Link from "next/link";
import Image from "next/image";
import { loadRealData, getCurrentRoster, getTeamStats, getMatchesSorted, displayRole } from "@/lib/real-data";
import { championIconUrl, championSplashUrl } from "@/lib/constants";
import { PLAYER_PHOTOS, TEAM_LOGOS, KC_LOGO } from "@/lib/kc-assets";
import { AudioPlayer } from "@/components/AudioPlayer";
import { HomeFilteredContent } from "@/components/HomeFilteredContent";
import { HomeClipsShowcase } from "@/components/HomeClipsShowcase";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { MacronEasterEgg } from "@/components/MacronEasterEgg";
import { HeroClipBackground } from "@/components/HeroClipBackground";

/** Iconic clips that play in the hero background, one after the other.
 *  Mixed variety: highlights, pentakills, voicecomms, reactions, comebacks.
 */
const HERO_CLIPS = [
  {
    videoId: "bqBVNEm52A0",
    title: "KC 3-0 G2 — ALL GAMES HIGHLIGHTS",
    context: "Le Sacre · Winter 2025",
    durationMs: 18000,
  },
  {
    videoId: "AelCWTFNOZQ",
    title: "« WE ARE THE CHAMPIONS ! » — KC VoiceComms",
    context: "Le Sacre · Backstage",
    durationMs: 15000,
  },
  {
    videoId: "j9JlExfa9mY",
    title: "REKKLES PENTAKILL JINX vs GameWard",
    context: "L'Ere Rekkles · LFL 2022",
    durationMs: 14000,
  },
  {
    videoId: "9aM1SIsGWDk",
    title: "KC vs G2 — ALL GAMES HIGHLIGHTS",
    context: "LEC Versus 2026 · Final",
    durationMs: 16000,
  },
  {
    videoId: "VXdc0Q2HdCg",
    title: "Le discours de Kameto apres la finale",
    context: "Le Sacre · Post-match",
    durationMs: 18000,
  },
  {
    videoId: "pMSFp7wku5Y",
    title: "KC vs G2 Game 3 — Vladi Viktor 10/1/7",
    context: "Le Sacre · Game 3 MVP",
    durationMs: 18000,
  },
  {
    videoId: "42lv5jASq9I",
    title: "KC vs G2 ALL GAMES — LEC 2026 Grand Final",
    context: "Le Renouveau · Versus 2026",
    durationMs: 16000,
  },
  {
    videoId: "8AJP6HleZh8",
    title: "KC vs CFO — Un match dans la legende",
    context: "First Stand · Seoul 2025",
    durationMs: 18000,
  },
  {
    videoId: "M7xaenPvPU4",
    title: "KC vs Vitality — LEC Spring 2026 Week 1",
    context: "Spring 2026 · En cours",
    durationMs: 14000,
  },
  {
    videoId: "EfN64vP2n2o",
    title: "Top 10 Caliste Plays — Best of 2025",
    context: "Rookie of the Year 2025",
    durationMs: 18000,
  },
];

export const dynamic = "force-dynamic";

export default function HomePage() {
  const data = loadRealData();
  const roster = getCurrentRoster(data);
  const stats = getTeamStats(data);
  const allMatches = getMatchesSorted(data);
  const isEmpty = data.total_matches === 0;

  // Champion splash for the #1 player (most kills)
  const topPlayer = [...roster].sort((a, b) => b.totalKills - a.totalKills)[0];
  const heroChamp = topPlayer?.champions[0] ?? "Jhin";

  return (
    <div className="-mx-4 -mt-6">
      <AudioPlayer />

      {/* ═══ HERO — Full viewport with auto-playing clip rotator ═══════ */}
      <section className="relative min-h-[100vh] md:min-h-[92vh] flex items-end md:items-center overflow-hidden">
        <HeroClipBackground clips={HERO_CLIPS} posterSrc="/images/hero-bg.jpg" />

        {/* Soft gradients — much lighter on desktop to let the video breathe */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--bg-primary)] pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-black/40 pointer-events-none hidden md:block" />

        {/* ─── Left block: title + tagline + CTAs (desktop left-aligned) ─── */}
        <div className="relative z-10 w-full px-6 md:px-12 lg:px-20 pb-24 md:pb-0">
          <div className="max-w-3xl md:text-left text-center mx-auto md:mx-0">
            {/* Tag row */}
            <div className="inline-flex items-center gap-3 mb-5">
              <MacronEasterEgg />
              <span className="rounded-full border border-[var(--gold)]/30 bg-black/50 backdrop-blur-sm px-4 py-1.5 text-[11px] font-bold tracking-[0.2em] uppercase text-[var(--gold)]">
                Karmine Corp &middot; LEC
              </span>
            </div>

            {/* Massive title — smaller on desktop to leave space for video */}
            <h1
              className="font-display font-black tracking-tight leading-[0.85] text-6xl md:text-7xl lg:text-8xl"
              style={{ textShadow: "0 4px 30px rgba(0,0,0,0.9), 0 0 60px rgba(0,0,0,0.5)" }}
            >
              <span className="text-shimmer">KCKILLS</span>
            </h1>

            <p
              className="mt-4 max-w-md text-base md:text-lg text-white/85 font-medium md:mx-0 mx-auto"
              style={{ textShadow: "0 2px 12px rgba(0,0,0,0.9)" }}
            >
              Every kill. Rated. Remembered.
            </p>

            {/* CTAs — more compact */}
            <div className="mt-7 flex items-center gap-3 md:justify-start justify-center flex-wrap">
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
            </div>
          </div>
        </div>

        {/* ─── Floating stats card — bottom-right on desktop, below on mobile ─── */}
        {!isEmpty && (
          <div className="absolute bottom-4 right-4 md:bottom-8 md:right-12 z-10 max-w-[calc(100vw-2rem)]">
            <div className="rounded-xl bg-black/55 backdrop-blur-md border border-[var(--gold)]/20 px-5 py-3.5 md:px-6 md:py-4">
              <p className="font-data text-[9px] uppercase tracking-[0.28em] text-[var(--gold)]/60 mb-1.5">
                Carri&egrave;re LEC &middot; 2024 &rarr; 2026
              </p>
              <div className="flex items-baseline gap-2 mb-2">
                <AnimatedNumber
                  value={stats.totalKills}
                  duration={2}
                  className="font-data text-4xl md:text-5xl font-black text-[var(--gold)] tabular-nums leading-none"
                />
                <span className="text-xs text-white/50 uppercase tracking-widest font-semibold">kills</span>
              </div>
              <div className="flex items-center gap-3 text-xs font-data">
                <span className="flex items-baseline gap-1">
                  <AnimatedNumber value={stats.wins} duration={1.6} className="text-[var(--green)] font-bold text-base" />
                  <span className="text-[9px] uppercase tracking-wider text-white/40">W</span>
                </span>
                <span className="text-white/15">&bull;</span>
                <span className="flex items-baseline gap-1">
                  <AnimatedNumber value={stats.losses} duration={1.6} className="text-[var(--red)] font-bold text-base" />
                  <span className="text-[9px] uppercase tracking-wider text-white/40">L</span>
                </span>
                <span className="text-white/15">&bull;</span>
                <span className="flex items-baseline gap-1">
                  <AnimatedNumber value={stats.totalGames} duration={1.6} className="font-bold text-base text-white" />
                  <span className="text-[9px] uppercase tracking-wider text-white/40">G</span>
                </span>
                <span className="text-white/15">&bull;</span>
                <span className="flex items-baseline gap-1">
                  <AnimatedNumber
                    value={(stats.wins / (stats.wins + stats.losses)) * 100}
                    duration={1.8}
                    format="percent1"
                    className="text-[var(--gold)] font-bold text-base"
                  />
                  <span className="text-[9px] uppercase tracking-wider text-white/40">WR</span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Scroll indicator — tiny, discrete */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 animate-bounce z-10">
          <svg className="h-5 w-5 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* ═══ ROSTER — Full width, tall bands ════════════════════════════ */}
      {roster.length > 0 && (
        <section className="relative overflow-hidden py-2">
          <div className="flex h-[70vh] min-h-[500px]">
            {roster.map((player, i) => {
              const photo = PLAYER_PHOTOS[player.name];
              const champ = player.champions[0] ?? "Jhin";
              return (
                <Link
                  key={player.name}
                  href={`/player/${encodeURIComponent(player.name)}`}
                  className="roster-band group relative flex-1 overflow-hidden border-r border-[var(--border-gold)] last:border-r-0 transition-all duration-700 hover:flex-[2] hover:z-10"
                >
                  {/* Background — player photo or champion splash */}
                  {photo ? (
                    <Image src={photo} alt={player.name} fill className="object-cover object-top transition-all duration-700 group-hover:scale-105 group-hover:brightness-110" />
                  ) : (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={championSplashUrl(champ)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40 transition-all duration-700 group-hover:scale-110 group-hover:opacity-60" />
                    </>
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

                    {/* Stats — appear on hover */}
                    <div className="mt-3 overflow-hidden max-h-0 group-hover:max-h-40 transition-all duration-500">
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

      {/* ═══ HIGHLIGHTS CLIPS SHOWCASE (real YouTube clips) ═══════════════ */}
      <HomeClipsShowcase />

      {/* ═══ TIMELINE + MATCHES (filtered) ═══════════════════════════════ */}
      <HomeFilteredContent allMatches={allMatches} />

      {/* ═══ LAST MATCH — Full section ══════════════════════════════════ */}
      {allMatches.length > 0 && allMatches[0].games.length > 0 && (() => {
        const match = allMatches[0];
        const oppLogo = TEAM_LOGOS[match.opponent.code];
        const bgChamp = match.games[0]?.kc_players?.find(p => p.name.startsWith("KC "))?.champion ?? "Jhin";
        return (
          <section className="relative overflow-hidden py-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={championSplashUrl(bgChamp)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.04]" />
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
