import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { loadRealData, getMatchesSorted, displayRole } from "@/lib/real-data";
import { championIconUrl } from "@/lib/constants";
import { computeKillScore } from "@/lib/feed-algorithm";
import { KillInteractions } from "./interactions";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

// Build a flat kill index from real data for lookup
function buildKillIndex(data: ReturnType<typeof loadRealData>) {
  const kills: {
    id: string;
    playerName: string;
    champion: string;
    opponentName: string;
    opponentChampion: string;
    kills: number;
    deaths: number;
    assists: number;
    gold: number;
    cs: number;
    matchId: string;
    matchDate: string;
    opponent: string;
    opponentFull: string;
    stage: string;
    gameNumber: number;
    gameKcKills: number;
    gameOppKills: number;
    kcWon: boolean;
    isKcKiller: boolean;
    score: number;
    role: string;
    multiKill: string | null;
  }[] = [];

  for (const match of data.matches) {
    for (const game of match.games) {
      for (const p of game.kc_players) {
        if (!p.name.startsWith("KC ")) continue;
        if (p.kills === 0 && p.deaths === 0) continue;
        const bestOpp = [...game.opp_players].sort((a, b) => b.deaths - a.deaths)[0];
        const cleanName = p.name.replace("KC ", "");
        const id = `${match.id}-${game.number}-${cleanName}`;
        kills.push({
          id,
          playerName: cleanName,
          champion: p.champion,
          opponentName: bestOpp ? bestOpp.name.replace(/^[A-Z]+ /, "") : "?",
          opponentChampion: bestOpp?.champion ?? "?",
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          gold: p.gold,
          cs: p.cs,
          matchId: match.id,
          matchDate: match.date,
          opponent: match.opponent.code,
          opponentFull: match.opponent.name,
          stage: match.stage,
          gameNumber: game.number,
          gameKcKills: game.kc_kills,
          gameOppKills: game.opp_kills,
          kcWon: match.kc_won,
          isKcKiller: p.kills > 0,
          score: computeKillScore(p.kills, p.deaths, p.assists, game.kc_kills, true, match.kc_won),
          role: p.role,
          multiKill: p.kills >= 5 ? "penta" : p.kills >= 4 ? "quadra" : p.kills >= 3 ? "triple" : p.kills >= 2 ? "double" : null,
        });
      }
    }
  }
  return kills;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const data = loadRealData();
  const kills = buildKillIndex(data);
  const kill = kills.find((k) => k.id === id);
  if (!kill) return { title: "Kill introuvable — KCKILLS" };

  const title = `${kill.playerName} (${kill.champion}) vs ${kill.opponent} — KCKILLS`;
  return {
    title,
    description: `${kill.kills}/${kill.deaths}/${kill.assists} — ${kill.stage} — KC vs ${kill.opponent}`,
    openGraph: { title, description: `Score: ${kill.score}` },
  };
}

export default async function KillDetailPage({ params }: Props) {
  const { id } = await params;
  const data = loadRealData();
  const kills = buildKillIndex(data);
  const kill = kills.find((k) => k.id === id);

  if (!kill) notFound();

  const kda = kill.deaths > 0
    ? ((kill.kills + kill.assists) / kill.deaths).toFixed(1)
    : "Perfect";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <Link href={`/match/${kill.matchId}`} className="hover:text-[var(--gold)]">
          KC vs {kill.opponent}
        </Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>Game {kill.gameNumber}</span>
      </nav>

      {/* Clip area — splash art background */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--border-gold)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${kill.champion}_0.jpg`} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/50" />
        <div className="relative z-10 flex h-full items-center justify-center">
          <div className="flex items-center gap-6">
            <div className="overflow-hidden rounded-xl border-2 border-[var(--gold)]/40 shadow-lg shadow-[var(--gold)]/10">
              <Image src={championIconUrl(kill.champion)} alt={kill.champion} width={100} height={100} />
            </div>
            <div className="flex flex-col items-center">
              <div className="h-12 w-12 flex items-center justify-center rounded-full bg-[var(--gold)]/20 border border-[var(--gold)]/30">
                <svg className="h-6 w-6 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border-2 border-[var(--red)]/40">
              <Image src={championIconUrl(kill.opponentChampion)} alt={kill.opponentChampion} width={100} height={100} />
            </div>
          </div>
        </div>
        <div className="absolute bottom-3 left-0 right-0 text-center">
          <span className="rounded-full bg-black/60 backdrop-blur-sm px-3 py-1 text-[10px] text-[var(--text-muted)]">
            Clip bient&ocirc;t disponible
          </span>
        </div>
      </div>

      {/* Kill info card */}
      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 space-y-4">
        {/* Player line */}
        <div className="flex items-center gap-3">
          <Image src={championIconUrl(kill.champion)} alt={kill.champion} width={48} height={48}
            className="rounded-xl border border-[var(--gold)]/30" />
          <div>
            <h1 className="font-display text-xl font-bold text-[var(--gold)]">{kill.playerName}</h1>
            <p className="text-sm text-[var(--text-muted)]">{kill.champion} &middot; {displayRole(kill.role)}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="font-data text-2xl font-bold">
              <span className="text-[var(--green)]">{kill.kills}</span>
              /<span className="text-[var(--red)]">{kill.deaths}</span>
              /<span className="text-[var(--text-secondary)]">{kill.assists}</span>
            </p>
            <p className="text-xs text-[var(--text-muted)]">KDA {kda}</p>
          </div>
        </div>

        {/* Multi-kill + tags */}
        <div className="flex flex-wrap gap-2">
          {kill.multiKill && (
            <span className={`rounded-md px-3 py-1 text-xs font-black uppercase tracking-wider ${
              kill.multiKill === "penta" ? "badge-penta bg-[var(--gold)]/20 border border-[var(--gold)]/40" :
              kill.multiKill === "quadra" ? "text-[var(--orange)] bg-[var(--orange)]/15 border border-[var(--orange)]/30" :
              kill.multiKill === "triple" ? "text-[var(--orange)] bg-[var(--orange)]/10 border border-[var(--orange)]/20" :
              "text-[var(--text-secondary)] bg-white/5 border border-white/10"
            }`}>
              {kill.multiKill} kill
            </span>
          )}
          {kill.deaths === 0 && kill.kills >= 2 && (
            <span className="rounded-full bg-[var(--green)]/10 border border-[var(--green)]/20 px-2.5 py-0.5 text-[10px] text-[var(--green)]">#clean</span>
          )}
          {kill.kills >= 3 && kill.deaths <= 1 && (
            <span className="rounded-full bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2.5 py-0.5 text-[10px] text-[var(--gold)]">#outplay</span>
          )}
          {kill.kills >= 5 && (
            <span className="rounded-full bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2.5 py-0.5 text-[10px] text-[var(--gold)]">#carry</span>
          )}
          {kill.gameKcKills > kill.gameOppKills * 2 && (
            <span className="rounded-full bg-[var(--cyan)]/10 border border-[var(--cyan)]/20 px-2.5 py-0.5 text-[10px] text-[var(--cyan)]">#stomp</span>
          )}
        </div>

        {/* Score */}
        <div className="flex items-center gap-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-gold)] p-3">
          <div className="flex items-center gap-1.5">
            <svg className="h-4 w-4 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span className="font-data text-lg font-black text-[var(--gold)]">{kill.score}</span>
            <span className="text-[10px] text-[var(--text-muted)]">pts</span>
          </div>
          <span className="text-[10px] text-[var(--text-disabled)]">Score composite (KDA, kill participation, victoire)</span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-3">
          <div className="stat-card rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] p-3 text-center">
            <p className="font-data text-lg font-bold text-[var(--gold)]">{kill.score}</p>
            <p className="text-[10px] text-[var(--text-muted)]">Score</p>
          </div>
          <div className="stat-card rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] p-3 text-center">
            <p className="font-data text-lg font-bold">{(kill.gold / 1000).toFixed(1)}k</p>
            <p className="text-[10px] text-[var(--text-muted)]">Gold</p>
          </div>
          <div className="stat-card rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] p-3 text-center">
            <p className="font-data text-lg font-bold">{kill.cs}</p>
            <p className="text-[10px] text-[var(--text-muted)]">CS</p>
          </div>
          <div className="stat-card rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] p-3 text-center">
            <p className={`font-data text-lg font-bold ${kill.kcWon ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
              {kill.kcWon ? "W" : "L"}
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">Result</p>
          </div>
        </div>

        {/* Match context */}
        <Link href={`/match/${kill.matchId}`}
          className="block rounded-lg bg-[var(--bg-primary)] border border-[var(--border-gold)] p-3 text-sm hover:border-[var(--gold)]/40 transition-colors">
          <p className="font-medium">KC vs {kill.opponentFull}</p>
          <p className="text-xs text-[var(--text-muted)]">
            {kill.stage} &middot; Game {kill.gameNumber} &middot;{" "}
            <span className="font-data">{kill.gameKcKills}-{kill.gameOppKills}</span> &middot;{" "}
            {new Date(kill.matchDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </Link>
      </div>

      {/* Interactions (client component) */}
      <KillInteractions killId={id} />

      {/* Riot disclaimer */}
      <p className="text-[10px] text-[var(--text-disabled)] text-center">
        KCKILLS was created under Riot Games&apos; &quot;Legal Jibber Jabber&quot; policy.
        Riot Games does not endorse or sponsor this project.
      </p>
    </div>
  );
}
