import Link from "next/link";
import Image from "next/image";
import { loadRealData, getMatchesSorted, getCurrentRoster } from "@/lib/real-data";
import { computeKillScore, type ScoredKill } from "@/lib/feed-algorithm";
import { championIconUrl } from "@/lib/constants";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";
import { getPublishedKills, type PublishedKillRow } from "@/lib/supabase/kills";
import { TopFilters } from "./top-filters";

export const revalidate = 120;
export const metadata = { title: "Top Kills \u2014 KCKILLS" };

export default async function TopPage({
  searchParams,
}: {
  searchParams: Promise<{ player?: string; year?: string; champion?: string; multi?: string }>;
}) {
  const params = await searchParams;
  const data = loadRealData();
  const matches = getMatchesSorted(data, params.year ? parseInt(params.year) : undefined);
  const roster = getCurrentRoster(data);
  const playerNames = roster.map((p) => p.name);

  const scored: ScoredKill[] = [];
  for (const match of matches) {
    for (const game of match.games) {
      for (const p of game.kc_players) {
        if (!p.name.startsWith("KC ")) continue;
        if (p.kills === 0 && p.assists === 0) continue;
        const bestOpp = [...game.opp_players].sort((a, b) => b.deaths - a.deaths)[0];
        const cleanName = p.name.replace("KC ", "");
        scored.push({
          playerName: cleanName,
          champion: p.champion,
          opponentName: bestOpp ? bestOpp.name.replace(/^[A-Z]+ /, "") : "?",
          opponentChampion: bestOpp?.champion ?? "?",
          kills: p.kills, deaths: p.deaths, assists: p.assists,
          matchId: match.id, matchDate: match.date, opponent: match.opponent.code,
          stage: match.stage, gameNumber: game.number,
          gameKcKills: game.kc_kills, gameOppKills: game.opp_kills,
          isKcKiller: true, kcWon: match.kc_won, gold: p.gold,
          score: computeKillScore(p.kills, p.deaths, p.assists, game.kc_kills, true, match.kc_won),
        });
      }
    }
  }
  // ─── Apply URL filters ──────────────────────────────────────────────
  let filtered = scored;
  if (params.player) {
    filtered = filtered.filter((s) => s.playerName === params.player);
  }
  if (params.champion) {
    filtered = filtered.filter((s) => s.champion === params.champion);
  }
  if (params.multi === "3") {
    filtered = filtered.filter((s) => s.kills >= 3);
  } else if (params.multi === "5") {
    filtered = filtered.filter((s) => s.kills >= 5);
  } else if (params.multi === "perfect") {
    filtered = filtered.filter((s) => s.deaths === 0 && s.kills >= 2);
  }
  filtered.sort((a, b) => b.score - a.score);

  // ─── Fetch top real clips from Supabase ──────────────────────────────
  const topClips = await getPublishedKills(10);

  return (
    <div className="space-y-8">
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>Top</span>
      </nav>

      <div>
        <h1 className="font-display text-3xl font-bold">
          Top <span className="text-gold-gradient">Performances</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Class&eacute; par highlight score (vid&eacute;o) + score composite (stats).
        </p>
      </div>

      {/* ═══ REAL HIGHLIGHT CLIPS (from pipeline) ═══ */}
      {topClips.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-[var(--gold)] animate-pulse" />
            <h2 className="font-display text-lg font-bold text-[var(--gold)] uppercase tracking-widest">
              Top {topClips.length} clips vid&eacute;o
            </h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {topClips.slice(0, 6).map((k: PublishedKillRow, i: number) => {
              const isKc = k.tracked_team_involvement === "team_killer";
              return (
                <Link
                  key={k.id}
                  href={`/kill/${k.id}`}
                  className="group flex items-center gap-3 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3 hover:border-[var(--gold)]/50 transition-all"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--bg-primary)] font-display font-black text-lg text-[var(--gold)]">
                    {i + 1}
                  </div>
                  {k.thumbnail_url && (
                    <Image
                      src={k.thumbnail_url}
                      alt=""
                      width={56}
                      height={56}
                      className="h-14 w-14 rounded-lg object-cover flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-sm font-bold truncate">
                      <span className={isKc ? "text-[var(--gold)]" : "text-white"}>
                        {k.killer_champion}
                      </span>
                      <span className="text-[var(--text-muted)] mx-1">&rarr;</span>
                      <span className="text-white/80">{k.victim_champion}</span>
                    </p>
                    {k.ai_description && (
                      <p className="text-[10px] text-[var(--text-muted)] truncate italic">
                        {k.ai_description}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                    {k.highlight_score != null && (
                      <span className="font-data text-sm font-bold text-[var(--gold)]">
                        {k.highlight_score.toFixed(1)}
                      </span>
                    )}
                    {k.multi_kill && (
                      <span className="text-[9px] font-bold uppercase text-[var(--orange)]">
                        {k.multi_kill}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <TopFilters players={playerNames} champions={[...new Set(filtered.map(s => s.champion))].sort()} />

      {/* Podium — #1 bigger, #2 and #3 smaller */}
      {filtered.length >= 3 && (
        <div className="flex items-end justify-center gap-3 md:gap-4">
          {/* #2 */}
          <PodiumCard kill={filtered[1]} rank={2} height="h-[280px]" />
          {/* #1 — tallest + crown */}
          <PodiumCard kill={filtered[0]} rank={1} height="h-[340px]" crown />
          {/* #3 */}
          <PodiumCard kill={filtered[2]} rank={3} height="h-[260px]" />
        </div>
      )}

      {/* Separators: top 5, top 10, top 25 */}
      {filtered.length > 3 && (
        <div className="space-y-6">
          {/* Top 5 */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-px flex-1 bg-[var(--border-gold)]" />
              <span className="text-[10px] uppercase tracking-widest text-[var(--gold)] font-bold">Top 5</span>
              <div className="h-px flex-1 bg-[var(--border-gold)]" />
            </div>
            <div className="space-y-1.5">
              {filtered.slice(3, 5).map((k, i) => <RankRow key={`${k.matchId}-${k.playerName}-${k.gameNumber}`} kill={k} rank={i + 4} />)}
            </div>
          </div>

          {/* Top 10 */}
          {filtered.length > 5 && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="h-px flex-1 bg-[var(--border-gold)]" />
                <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Top 10</span>
                <div className="h-px flex-1 bg-[var(--border-gold)]" />
              </div>
              <div className="space-y-1.5">
                {filtered.slice(5, 10).map((k, i) => <RankRow key={`${k.matchId}-${k.playerName}-${k.gameNumber}`} kill={k} rank={i + 6} />)}
              </div>
            </div>
          )}

          {/* Top 25 */}
          {filtered.length > 10 && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="h-px flex-1 bg-[var(--border-gold)]" />
                <span className="text-[10px] uppercase tracking-widest text-[var(--text-disabled)]">Top 25</span>
                <div className="h-px flex-1 bg-[var(--border-gold)]" />
              </div>
              <div className="space-y-1.5">
                {filtered.slice(10, 25).map((k, i) => <RankRow key={`${k.matchId}-${k.playerName}-${k.gameNumber}`} kill={k} rank={i + 11} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PodiumCard({ kill, rank, height, crown }: { kill: ScoredKill; rank: number; height: string; crown?: boolean }) {
  const photo = PLAYER_PHOTOS[kill.playerName];
  return (
    <Link
      href={`/kill/${kill.matchId}-${kill.gameNumber}-${kill.playerName}`}
      className={`group relative overflow-hidden rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] ${height} w-[160px] md:w-[200px] transition-all duration-500 hover:border-[var(--gold)]/50 hover:shadow-2xl hover:shadow-[var(--gold)]/10 hover:scale-105`}
    >
      {/* Rank badge */}
      <div className={`absolute top-3 left-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black text-black shadow-lg ${rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : "rank-3"}`}>
        #{rank}
      </div>

      {/* Crown for #1 */}
      {crown && <div className="absolute top-[-4px] left-1/2 -translate-x-1/2 z-10 text-2xl animate-bounce">{"\uD83D\uDC51"}</div>}

      {/* Champion bg */}
      <Image
        src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${kill.champion}_0.jpg`}
        alt=""
        fill
        sizes="(max-width: 768px) 100vw, 33vw"
        className="object-cover opacity-30 group-hover:opacity-50 transition-opacity"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

      {/* Content */}
      <div className="relative z-10 flex flex-col justify-end h-full p-4">
        {/* Player photo */}
        {photo && (
          <Image src={photo} alt={kill.playerName} width={40} height={40} className="rounded-full border border-[var(--gold)]/30 mb-2" />
        )}
        <p className="font-display text-base font-bold text-[var(--gold)]">{kill.playerName}</p>
        <p className="text-[10px] text-[var(--text-muted)]">{kill.champion} vs {kill.opponent}</p>
        <p className="font-data text-lg font-black mt-2">
          <span className="text-[var(--green)]">{kill.kills}</span>
          <span className="text-white/30">/</span>
          <span className="text-[var(--red)]">{kill.deaths}</span>
          <span className="text-white/30">/</span>
          <span className="text-[var(--text-secondary)]">{kill.assists}</span>
        </p>
        <div className="flex items-center justify-between mt-2">
          <span className="font-data text-2xl font-black text-[var(--gold)]">{kill.score}</span>
          <span className="text-[9px] text-[var(--text-disabled)]">pts</span>
        </div>
      </div>
    </Link>
  );
}

function RankRow({ kill, rank }: { kill: ScoredKill; rank: number }) {
  return (
    <Link
      href={`/kill/${kill.matchId}-${kill.gameNumber}-${kill.playerName}`}
      className="match-row flex items-center gap-4 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3"
    >
      <span className="w-8 text-center font-data text-sm font-bold text-[var(--text-disabled)]">#{rank}</span>
      <Image src={championIconUrl(kill.champion)} alt={kill.champion} width={32} height={32} className="rounded-full border border-[var(--border-gold)]" data-tooltip={kill.champion} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          <span className="text-[var(--gold)]">{kill.playerName}</span>
          <span className="text-[var(--text-muted)]"> ({kill.champion}) vs {kill.opponent}</span>
        </p>
        <p className="text-[10px] text-[var(--text-muted)]">{kill.stage} &middot; Game {kill.gameNumber}</p>
      </div>
      <p className="font-data text-sm">
        <span className="text-[var(--green)]">{kill.kills}</span>/
        <span className="text-[var(--red)]">{kill.deaths}</span>/
        <span>{kill.assists}</span>
      </p>
      <span className="font-data font-bold text-[var(--gold)] w-12 text-right">{kill.score}</span>
    </Link>
  );
}
