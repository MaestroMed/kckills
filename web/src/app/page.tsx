import Link from "next/link";
import Image from "next/image";
import { loadRealData, getCurrentRoster, getTeamStats, getMatchesSorted, displayRole } from "@/lib/real-data";
import { championIconUrl, championSplashUrl } from "@/lib/constants";
import { PLAYER_PHOTOS, TEAM_LOGOS, KC_LOGO } from "@/lib/kc-assets";
import { AudioPlayer } from "@/components/AudioPlayer";
import { HomeFilteredContent } from "@/components/HomeFilteredContent";
import { HomeClipsShowcase } from "@/components/HomeClipsShowcase";

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

      {/* ═══ HERO — Full viewport ════════════════════════════════════════ */}
      <section className="relative min-h-[85vh] flex items-center justify-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/hero-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover opacity-25 scale-105" />
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-primary)]/60 via-[var(--bg-primary)]/70 to-[var(--bg-primary)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-primary)]/80 via-transparent to-[var(--bg-primary)]/80" />

        <div className="relative z-10 text-center px-4 w-full max-w-5xl">
          <div className="flex items-center justify-center gap-3 mb-6">
            <Image src={KC_LOGO} alt="KC" width={48} height={48} className="rounded-xl" />
            <span className="rounded-full border border-[var(--gold)]/20 bg-[var(--gold)]/5 px-5 py-2 text-xs font-medium text-[var(--gold)]">
              LEC 2026 &middot; Karmine Corp
            </span>
          </div>

          <h1 className="font-display text-7xl font-black tracking-tight md:text-9xl">
            <span className="text-shimmer">KCKILLS</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-lg text-[var(--text-muted)]">
            Every kill. Rated. Remembered.
          </p>

          {!isEmpty && (
            <div className="mt-10 inline-flex items-baseline gap-3">
              <span className="font-data text-6xl font-black text-[var(--gold)] md:text-7xl">{stats.totalKills}</span>
              <span className="text-base text-[var(--text-muted)]">kills &middot; {stats.wins}W-{stats.losses}L &middot; {stats.totalGames} games</span>
            </div>
          )}

          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/scroll" className="rounded-xl bg-[var(--gold)] px-10 py-5 text-lg font-bold text-[var(--bg-primary)] transition-all hover:bg-[var(--gold-bright)] hover:shadow-2xl hover:shadow-[var(--gold)]/25 hover:scale-105 active:scale-95">
              Scroll les kills
            </Link>
            <Link href="/matches" className="rounded-xl border border-[var(--border-gold)] px-10 py-5 text-lg font-medium text-[var(--text-secondary)] transition-all hover:border-[var(--gold)]/40 hover:text-[var(--gold)]">
              Matchs
            </Link>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 animate-bounce">
          <svg className="h-6 w-6 text-[var(--gold)]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
