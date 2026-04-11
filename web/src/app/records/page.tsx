import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import {
  loadRealData,
  getKCRoster,
  getPlayerStats,
  type RealMatch,
  type RealGame,
  type RealPlayer,
} from "@/lib/real-data";
import { championIconUrl } from "@/lib/constants";
import { PLAYER_PHOTOS, KC_LOGO, TEAM_LOGOS } from "@/lib/kc-assets";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Records",
  description:
    "Les records carriere de la Karmine Corp : plus de kills sur une game, KDA le plus haut, plus longue victoire, champion le plus joue.",
  openGraph: {
    title: "Records — KCKILLS",
    description: "Les records carriere de la Karmine Corp en LEC.",
    type: "website",
  },
};

/* ─── Types ───────────────────────────────────────────────── */

interface GameContext {
  match: RealMatch;
  game: RealGame;
  kcPlayer: RealPlayer;
}

function cleanName(name: string): string {
  const prefixes = ["KC "];
  for (const p of prefixes) {
    if (name.startsWith(p)) return name.slice(p.length);
  }
  return name;
}

/* ─── Page ─────────────────────────────────────────────────── */

export default function RecordsPage() {
  const data = loadRealData();
  const roster = getKCRoster(data);

  // Compute all records from the real dataset
  const allKcGamePlayers: GameContext[] = [];
  for (const match of data.matches) {
    for (const game of match.games) {
      for (const p of game.kc_players) {
        if (p.name.startsWith("KC ")) {
          allKcGamePlayers.push({ match, game, kcPlayer: p });
        }
      }
    }
  }

  // --- Records calculations ---

  // Most kills in a single game by a KC player
  const mostKillsInGame = [...allKcGamePlayers].sort(
    (a, b) => b.kcPlayer.kills - a.kcPlayer.kills
  )[0];

  // Highest KDA in a single game (deaths > 0 only)
  const highestKda = [...allKcGamePlayers]
    .filter((x) => x.kcPlayer.deaths > 0)
    .map((x) => ({
      ...x,
      kda: (x.kcPlayer.kills + x.kcPlayer.assists) / x.kcPlayer.deaths,
    }))
    .sort((a, b) => b.kda - a.kda)[0];

  // Perfect game (KDA with 0 deaths and most kills+assists)
  const perfectGame = [...allKcGamePlayers]
    .filter((x) => x.kcPlayer.deaths === 0 && x.kcPlayer.kills + x.kcPlayer.assists >= 5)
    .sort(
      (a, b) =>
        b.kcPlayer.kills + b.kcPlayer.assists - (a.kcPlayer.kills + a.kcPlayer.assists)
    )[0];

  // Most gold in a game
  const mostGoldGame = [...allKcGamePlayers].sort(
    (a, b) => b.kcPlayer.gold - a.kcPlayer.gold
  )[0];

  // Most CS in a game
  const mostCsGame = [...allKcGamePlayers].sort(
    (a, b) => b.kcPlayer.cs - a.kcPlayer.cs
  )[0];

  // Biggest stomp (max kill diff)
  const biggestStomp = [...data.matches]
    .flatMap((m) =>
      m.games.map((g) => ({
        match: m,
        game: g,
        diff: g.kc_kills - g.opp_kills,
      }))
    )
    .filter((x) => x.diff > 0)
    .sort((a, b) => b.diff - a.diff)[0];

  // Biggest loss (max negative diff)
  const biggestLoss = [...data.matches]
    .flatMap((m) =>
      m.games.map((g) => ({
        match: m,
        game: g,
        diff: g.kc_kills - g.opp_kills,
      }))
    )
    .filter((x) => x.diff < 0)
    .sort((a, b) => a.diff - b.diff)[0];

  // Most games played by a KC player
  const mostGamesPlayer = [...roster].sort((a, b) => b.gamesPlayed - a.gamesPlayed)[0];

  // Top scorer career
  const topScorer = [...roster].sort((a, b) => b.totalKills - a.totalKills)[0];

  // Most champions played
  const mostChampionsPlayer = [...roster].sort(
    (a, b) => b.champions.length - a.champions.length
  )[0];

  // Team champion most used
  const champCount: Record<string, number> = {};
  for (const ctx of allKcGamePlayers) {
    champCount[ctx.kcPlayer.champion] = (champCount[ctx.kcPlayer.champion] ?? 0) + 1;
  }
  const mostPlayedChamp = Object.entries(champCount).sort((a, b) => b[1] - a[1])[0];

  // Top scorer stats details (for the big card)
  const topScorerStats = topScorer ? getPlayerStats(data, topScorer.name) : null;

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
      {/* ═══ HERO ═══ */}
      <section className="relative min-h-[50vh] flex items-center justify-center overflow-hidden px-6 md:px-16 py-20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/hero-bg.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-30 scale-110"
          style={{ filter: "blur(2px)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-primary)] via-[var(--bg-primary)]/60 to-[var(--bg-primary)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-black/60" />

        <div className="relative z-10 text-center max-w-4xl">
          <nav className="mb-6 flex items-center justify-center gap-2 text-xs text-white/50">
            <Link href="/" className="hover:text-[var(--gold)]">
              Accueil
            </Link>
            <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
            <span className="text-[var(--gold)]">Records</span>
          </nav>

          <div className="inline-flex items-center gap-3 mb-6">
            <span className="rounded-full border border-[var(--gold)]/30 bg-black/50 backdrop-blur-sm px-4 py-1.5 text-[11px] font-bold tracking-[0.2em] uppercase text-[var(--gold)]">
              Karmine Corp &middot; LEC 2024 &rarr; 2026
            </span>
          </div>

          <h1 className="font-display font-black tracking-tight leading-[0.82] text-5xl md:text-7xl lg:text-8xl mb-5">
            <span className="hero-title-glow">
              <span className="text-shimmer">RECORDS</span>
            </span>
          </h1>

          <p className="max-w-2xl mx-auto text-base md:text-lg text-white/80 font-medium leading-relaxed">
            Tout ce que la KC Army doit savoir par coeur. Les plus gros KDA,
            les games qui ont marque l&apos;histoire, les joueurs qui ont cumule
            le plus de moments memorables depuis l&apos;entree en LEC.
          </p>
        </div>
      </section>

      {/* ═══ RECORDS GRID ═══ */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 lg:px-16 py-16 space-y-12">
        {/* ─── Top scorer showcase ─── */}
        {topScorer && topScorerStats && (
          <div
            className="relative overflow-hidden rounded-3xl border-2 p-8 md:p-12"
            style={{
              borderColor: "rgba(200,170,110,0.3)",
              background:
                "linear-gradient(135deg, rgba(200,170,110,0.08) 0%, transparent 60%)",
            }}
          >
            <div className="grid gap-8 md:grid-cols-12 items-center">
              <div className="md:col-span-4 flex justify-center md:justify-start">
                {PLAYER_PHOTOS[topScorer.name] ? (
                  <div className="relative h-48 w-48 md:h-56 md:w-56 rounded-full overflow-hidden border-4 border-[var(--gold)]/40 shadow-2xl shadow-[var(--gold)]/20">
                    <Image
                      src={PLAYER_PHOTOS[topScorer.name]}
                      alt={topScorer.name}
                      fill
                      className="object-cover object-top"
                    />
                  </div>
                ) : (
                  <div className="h-48 w-48 rounded-full bg-[var(--gold)]/10 flex items-center justify-center border-4 border-[var(--gold)]/40">
                    <span className="font-display text-6xl font-black text-[var(--gold)]">
                      {topScorer.name[0]}
                    </span>
                  </div>
                )}
              </div>

              <div className="md:col-span-8">
                <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
                  🏆 Top scorer carriere LEC
                </p>
                <Link
                  href={`/player/${encodeURIComponent(topScorer.name)}`}
                  className="font-display text-5xl md:text-7xl font-black text-white hover:text-[var(--gold)] transition-colors inline-block mb-4"
                >
                  {topScorer.name}
                </Link>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                  <div>
                    <p className="font-data text-3xl md:text-4xl font-black text-[var(--gold)] tabular-nums">
                      {topScorer.totalKills}
                    </p>
                    <p className="text-[10px] text-white/50 uppercase tracking-widest mt-1">
                      Kills
                    </p>
                  </div>
                  <div>
                    <p className="font-data text-3xl md:text-4xl font-black tabular-nums">
                      {topScorerStats.kda}
                    </p>
                    <p className="text-[10px] text-white/50 uppercase tracking-widest mt-1">
                      KDA
                    </p>
                  </div>
                  <div>
                    <p className="font-data text-3xl md:text-4xl font-black tabular-nums">
                      {topScorer.gamesPlayed}
                    </p>
                    <p className="text-[10px] text-white/50 uppercase tracking-widest mt-1">
                      Games
                    </p>
                  </div>
                  <div>
                    <p className="font-data text-3xl md:text-4xl font-black tabular-nums">
                      {topScorer.champions.length}
                    </p>
                    <p className="text-[10px] text-white/50 uppercase tracking-widest mt-1">
                      Champs
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Per-game records grid ─── */}
        <div>
          <h2 className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-6">
            Records individuels par game
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {mostKillsInGame && (
              <RecordCard
                label="Plus de kills sur une game"
                value={`${mostKillsInGame.kcPlayer.kills} kills`}
                player={cleanName(mostKillsInGame.kcPlayer.name)}
                champion={mostKillsInGame.kcPlayer.champion}
                matchId={mostKillsInGame.match.id}
                opponent={mostKillsInGame.match.opponent.code}
                date={mostKillsInGame.match.date}
                icon="\u2694\uFE0F"
              />
            )}
            {highestKda && (
              <RecordCard
                label="KDA le plus haut"
                value={`${highestKda.kda.toFixed(1)} KDA`}
                sublabel={`${highestKda.kcPlayer.kills} / ${highestKda.kcPlayer.deaths} / ${highestKda.kcPlayer.assists}`}
                player={cleanName(highestKda.kcPlayer.name)}
                champion={highestKda.kcPlayer.champion}
                matchId={highestKda.match.id}
                opponent={highestKda.match.opponent.code}
                date={highestKda.match.date}
                icon="\uD83D\uDC51"
              />
            )}
            {perfectGame && (
              <RecordCard
                label="Perfect game (0 death)"
                value={`${perfectGame.kcPlayer.kills}/0/${perfectGame.kcPlayer.assists}`}
                player={cleanName(perfectGame.kcPlayer.name)}
                champion={perfectGame.kcPlayer.champion}
                matchId={perfectGame.match.id}
                opponent={perfectGame.match.opponent.code}
                date={perfectGame.match.date}
                icon="\u2728"
              />
            )}
            {mostGoldGame && (
              <RecordCard
                label="Plus de gold sur une game"
                value={`${(mostGoldGame.kcPlayer.gold / 1000).toFixed(1)}K gold`}
                player={cleanName(mostGoldGame.kcPlayer.name)}
                champion={mostGoldGame.kcPlayer.champion}
                matchId={mostGoldGame.match.id}
                opponent={mostGoldGame.match.opponent.code}
                date={mostGoldGame.match.date}
                icon="\uD83D\uDCB0"
              />
            )}
            {mostCsGame && (
              <RecordCard
                label="Plus de CS sur une game"
                value={`${mostCsGame.kcPlayer.cs} CS`}
                player={cleanName(mostCsGame.kcPlayer.name)}
                champion={mostCsGame.kcPlayer.champion}
                matchId={mostCsGame.match.id}
                opponent={mostCsGame.match.opponent.code}
                date={mostCsGame.match.date}
                icon="\uD83E\uDD16"
              />
            )}
            {mostPlayedChamp && (
              <RecordCard
                label="Champion le plus joue"
                value={mostPlayedChamp[0]}
                sublabel={`${mostPlayedChamp[1]} games`}
                champion={mostPlayedChamp[0]}
                icon="\uD83C\uDFAF"
              />
            )}
          </div>
        </div>

        {/* ─── Team-level records ─── */}
        <div>
          <h2 className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-6">
            Records d&apos;equipe
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {biggestStomp && (
              <TeamRecordCard
                label="Plus gros stomp"
                kcKills={biggestStomp.game.kc_kills}
                oppKills={biggestStomp.game.opp_kills}
                opponent={biggestStomp.match.opponent.code}
                matchId={biggestStomp.match.id}
                stage={biggestStomp.match.stage}
                date={biggestStomp.match.date}
                diff={biggestStomp.diff}
                win
              />
            )}
            {biggestLoss && (
              <TeamRecordCard
                label="Plus grosse defaite"
                kcKills={biggestLoss.game.kc_kills}
                oppKills={biggestLoss.game.opp_kills}
                opponent={biggestLoss.match.opponent.code}
                matchId={biggestLoss.match.id}
                stage={biggestLoss.match.stage}
                date={biggestLoss.match.date}
                diff={Math.abs(biggestLoss.diff)}
                win={false}
              />
            )}
          </div>
        </div>

        {/* ─── Roster records ─── */}
        <div>
          <h2 className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-6">
            Roster actuel &middot; carriere LEC
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {mostGamesPlayer && (
              <RosterRecordCard
                label="Plus de games joues"
                value={`${mostGamesPlayer.gamesPlayed} games`}
                player={mostGamesPlayer.name}
                icon="\u23F1\uFE0F"
              />
            )}
            {mostChampionsPlayer && (
              <RosterRecordCard
                label="Plus large champion pool"
                value={`${mostChampionsPlayer.champions.length} champions`}
                player={mostChampionsPlayer.name}
                icon="\uD83D\uDCDA"
              />
            )}
            {topScorer && (
              <RosterRecordCard
                label="Meilleur scorer"
                value={`${topScorer.totalKills} kills`}
                player={topScorer.name}
                icon="\uD83C\uDFC6"
              />
            )}
          </div>
        </div>

        {/* ─── CTA ─── */}
        <div className="text-center pt-8">
          <Link
            href="/hall-of-fame"
            className="inline-flex items-center gap-3 rounded-xl border border-[var(--gold)]/50 bg-[var(--gold)]/10 backdrop-blur-sm px-8 py-4 font-display text-sm font-bold uppercase tracking-widest text-[var(--gold)] hover:bg-[var(--gold)]/20 transition-all"
          >
            Voir le Hall of Fame
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        </div>
      </section>
    </div>
  );
}

/* ─── Card components ─────────────────────────────────────── */

function RecordCard({
  label,
  value,
  sublabel,
  player,
  champion,
  matchId,
  opponent,
  date,
  icon,
}: {
  label: string;
  value: string;
  sublabel?: string;
  player?: string;
  champion?: string;
  matchId?: string;
  opponent?: string;
  date?: string;
  icon: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 transition-all hover:border-[var(--gold)]/50 hover:-translate-y-1">
      <div className="flex items-start justify-between mb-3">
        <p className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--gold)]/60">
          {label}
        </p>
        <span className="text-2xl">{icon}</span>
      </div>
      <p className="font-display text-3xl font-black text-[var(--gold)] leading-none mb-1">
        {value}
      </p>
      {sublabel && (
        <p className="font-data text-xs text-white/50 mb-3">{sublabel}</p>
      )}
      <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-3">
        {champion && (
          <Image
            src={championIconUrl(champion)}
            alt={champion}
            width={32}
            height={32}
            className="rounded-full border border-[var(--gold)]/30"
          />
        )}
        <div className="flex-1 min-w-0">
          {player && (
            <p className="text-sm font-bold text-white truncate">{player}</p>
          )}
          {champion && (
            <p className="text-[10px] text-white/40 uppercase tracking-wider">
              {champion}
            </p>
          )}
        </div>
        {matchId && opponent && (
          <Link
            href={`/match/${matchId}`}
            className="text-[10px] text-[var(--gold)]/60 hover:text-[var(--gold)] uppercase tracking-wider"
          >
            vs {opponent}
          </Link>
        )}
      </div>
      {date && (
        <p className="text-[9px] text-white/30 font-data mt-2">
          {new Date(date).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
      )}
    </div>
  );
}

function TeamRecordCard({
  label,
  kcKills,
  oppKills,
  opponent,
  matchId,
  stage,
  date,
  diff,
  win,
}: {
  label: string;
  kcKills: number;
  oppKills: number;
  opponent: string;
  matchId: string;
  stage: string;
  date: string;
  diff: number;
  win: boolean;
}) {
  const oppLogo = TEAM_LOGOS[opponent];
  return (
    <Link
      href={`/match/${matchId}`}
      className="group relative overflow-hidden rounded-2xl border bg-[var(--bg-surface)] p-6 transition-all hover:-translate-y-1"
      style={{
        borderColor: win ? "rgba(0,200,83,0.3)" : "rgba(232,64,87,0.3)",
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <p className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--gold)]/60">
          {label}
        </p>
        <span
          className="rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"
          style={{
            color: win ? "var(--green)" : "var(--red)",
            backgroundColor: win ? "rgba(0,200,83,0.15)" : "rgba(232,64,87,0.15)",
            borderWidth: 1,
            borderColor: win ? "rgba(0,200,83,0.4)" : "rgba(232,64,87,0.4)",
          }}
        >
          +{diff} diff
        </span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 flex-1">
          <Image src={KC_LOGO} alt="KC" width={40} height={40} className="rounded-lg" />
          <div className="font-data text-3xl font-black tabular-nums">
            <span className={win ? "text-[var(--green)]" : "text-white/60"}>
              {kcKills}
            </span>
            <span className="text-white/20 mx-2">-</span>
            <span className={!win ? "text-[var(--red)]" : "text-white/60"}>
              {oppKills}
            </span>
          </div>
          {oppLogo ? (
            <Image
              src={oppLogo}
              alt={opponent}
              width={40}
              height={40}
              className="rounded-lg"
            />
          ) : (
            <div className="h-10 w-10 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center text-xs font-bold">
              {opponent}
            </div>
          )}
        </div>
      </div>

      <p className="text-[10px] text-white/40 uppercase tracking-wider">
        KC vs {opponent} &middot; {stage} &middot;{" "}
        {new Date(date).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </p>
    </Link>
  );
}

function RosterRecordCard({
  label,
  value,
  player,
  icon,
}: {
  label: string;
  value: string;
  player: string;
  icon: string;
}) {
  const photo = PLAYER_PHOTOS[player];
  return (
    <Link
      href={`/player/${encodeURIComponent(player)}`}
      className="group flex items-center gap-4 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 transition-all hover:border-[var(--gold)]/50 hover:-translate-y-1"
    >
      {photo ? (
        <div className="relative h-16 w-16 rounded-full overflow-hidden border-2 border-[var(--gold)]/40 flex-shrink-0">
          <Image
            src={photo}
            alt={player}
            fill
            className="object-cover object-top"
          />
        </div>
      ) : (
        <div className="h-16 w-16 rounded-full bg-[var(--gold)]/10 flex items-center justify-center text-3xl flex-shrink-0">
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--gold)]/60 mb-1">
          {label}
        </p>
        <p className="font-display text-lg font-black text-white truncate group-hover:text-[var(--gold)] transition-colors">
          {player}
        </p>
        <p className="font-data text-sm text-[var(--gold)] font-bold mt-0.5">
          {value}
        </p>
      </div>
      <span className="text-2xl opacity-50">{icon}</span>
    </Link>
  );
}
