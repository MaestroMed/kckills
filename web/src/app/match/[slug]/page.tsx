import { notFound } from "next/navigation";
import { loadRealData, getMatchById, displayRole } from "@/lib/real-data";
import { championIconUrl } from "@/lib/constants";
import { KC_LOGO, TEAM_LOGOS } from "@/lib/kc-assets";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = loadRealData();
  const match = getMatchById(data, slug);
  if (!match) return { title: "Match introuvable — KCKILLS" };
  return {
    title: `KC vs ${match.opponent.code} — ${match.stage} — KCKILLS`,
  };
}

export default async function MatchPage({ params }: Props) {
  const { slug } = await params;
  const data = loadRealData();
  const match = getMatchById(data, slug);
  if (!match) notFound();

  const date = new Date(match.date);
  const totalKcKills = match.games.reduce((a, g) => a + g.kc_kills, 0);
  const totalOppKills = match.games.reduce((a, g) => a + g.opp_kills, 0);

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <Link href="/matches" className="hover:text-[var(--gold)]">Matchs</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>KC vs {match.opponent.code}</span>
      </nav>

      {/* Header */}
      <div className="flex items-center gap-6">
        <Image src={KC_LOGO} alt="KC" width={56} height={56} className="rounded-xl" />
        <div className="text-3xl font-bold text-[var(--text-muted)]">vs</div>
        {TEAM_LOGOS[match.opponent.code] ? (
          <Image src={TEAM_LOGOS[match.opponent.code]} alt={match.opponent.code} width={56} height={56} className="rounded-xl" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--bg-elevated)] text-xl font-black">{match.opponent.code}</div>
        )}
        <div>
          <h1 className="text-2xl font-bold">
            KC vs {match.opponent.name}
            <span className={`ml-3 text-lg font-bold ${match.kc_won ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
              {match.kc_won ? "Victoire" : "D\u00e9faite"} {match.kc_score}-{match.opp_score}
            </span>
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            {match.league} &middot; {match.stage} &middot; Bo{match.best_of} &middot; {date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
      </div>

      {/* Stats globales */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="stat-card rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-center">
          <p className="text-2xl font-bold text-[var(--green)]">{totalKcKills}</p>
          <p className="text-xs text-[var(--text-muted)]">KC kills</p>
        </div>
        <div className="stat-card rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-center">
          <p className="text-2xl font-bold text-[var(--red)]">{totalOppKills}</p>
          <p className="text-xs text-[var(--text-muted)]">{match.opponent.code} kills</p>
        </div>
        <div className="stat-card rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-center">
          <p className="text-2xl font-bold">{match.games.length}</p>
          <p className="text-xs text-[var(--text-muted)]">games</p>
        </div>
        <div className="stat-card rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-center">
          <p className="text-2xl font-bold text-[var(--gold)]">
            {totalOppKills > 0 ? (totalKcKills / totalOppKills).toFixed(1) : "\u221e"}
          </p>
          <p className="text-xs text-[var(--text-muted)]">K/D ratio</p>
        </div>
      </div>

      {/* Games */}
      {match.games.map((game) => (
        <div key={game.id} className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border-gold)] px-4 py-3 bg-[var(--bg-primary)]">
            <h2 className="font-semibold">Game {game.number}</h2>
            <div className="flex items-center gap-4">
              <span className="text-sm font-mono">
                <span className="text-[var(--green)] font-bold">{game.kc_kills}</span>
                <span className="text-[var(--text-muted)]"> - </span>
                <span className="text-[var(--red)] font-bold">{game.opp_kills}</span>
              </span>
              <div className="flex gap-2 text-[10px] text-[var(--text-muted)]">
                <span>{(game.kc_gold / 1000).toFixed(1)}k</span>
                <span>{game.kc_towers}T</span>
                <span>{game.kc_dragons}D</span>
                <span>{game.kc_barons}B</span>
              </div>
            </div>
          </div>

          {/* Kill timeline — dots showing KC kills vs opponent kills */}
          <div className="bg-[var(--bg-primary)] p-4 border-b border-[var(--border-gold)]">
            <p className="text-[9px] uppercase tracking-wider text-[var(--text-disabled)] mb-2">Kill Timeline</p>
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {/* Generate dots from KDA: KC kills = gold dots, opponent kills = red dots */}
              {Array.from({ length: game.kc_kills + game.opp_kills }).map((_, i) => {
                const isKc = i < game.kc_kills;
                return (
                  <div
                    key={i}
                    className={`h-3 w-3 rounded-full flex-shrink-0 transition-transform hover:scale-150 ${
                      isKc ? "bg-[var(--gold)]" : "bg-[var(--red)]/60"
                    }`}
                    title={isKc ? `KC kill #${i + 1}` : `${match.opponent.code} kill #${i - game.kc_kills + 1}`}
                  />
                );
              })}
              {game.kc_kills + game.opp_kills === 0 && (
                <p className="text-[10px] text-[var(--text-disabled)]">Pas de kills enregistr&eacute;s</p>
              )}
            </div>
            <div className="flex justify-between mt-1.5 text-[9px] text-[var(--text-disabled)]">
              <span>KC {game.kc_kills} kills</span>
              <span>{match.opponent.code} {game.opp_kills} kills</span>
            </div>
          </div>

          {/* VOD link if available */}
          {game.vods && game.vods.length > 0 && (
            <div className="px-4 py-2 border-b border-[var(--border-gold)]">
              <div className="flex flex-wrap gap-2">
                {game.vods.filter((v: {provider: string; parameter: string; locale: string}) => v.provider === "youtube").slice(0, 2).map((v: {provider: string; parameter: string; locale: string}, i: number) => (
                  <a
                    key={i}
                    href={`https://www.youtube.com/watch?v=${v.parameter}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--red)]/20 bg-[var(--red)]/5 px-3 py-1.5 text-[10px] font-medium text-[var(--red)] hover:bg-[var(--red)]/10 transition-colors"
                  >
                    <span>{"\u25B6"}</span>
                    VOD {v.locale?.split("-")[0]?.toUpperCase() || ""}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* KC Players — gold accent */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-3 w-1 rounded-full bg-[var(--gold)]" />
              <p className="text-xs font-semibold text-[var(--gold)] uppercase tracking-wider">Karmine Corp</p>
            </div>
            <div className="grid gap-1.5">
              {game.kc_players.filter((p) => p.name.startsWith("KC ")).map((p) => {
                const cleanName = p.name.replace("KC ", "");
                const killId = `${match.id}-${game.number}-${cleanName}`;
                return (
                <Link
                  key={p.name}
                  href={`/kill/${killId}`}
                  className="flex items-center gap-3 rounded-lg border-l-2 border-[var(--gold)]/30 bg-[var(--bg-primary)] p-2.5 hover:bg-[var(--bg-elevated)] hover:border-[var(--gold)] transition-all"
                >
                  <Image src={championIconUrl(p.champion)} alt={p.champion} width={36} height={36}
                    className="rounded-full border border-[var(--gold)]/30" data-tooltip={p.champion} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--gold)]">{cleanName}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{p.champion} &middot; {displayRole(p.role)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-data text-sm font-semibold">
                      <span className="text-[var(--green)]">{p.kills}</span>
                      /<span className="text-[var(--red)]">{p.deaths}</span>
                      /<span>{p.assists}</span>
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">{(p.gold / 1000).toFixed(1)}k &middot; {p.cs}CS &middot; Lv{p.level}</p>
                  </div>
                </Link>
                );
              })}
            </div>

            {/* Opponent Players — neutral */}
            <div className="flex items-center gap-2 mt-4 mb-2">
              <div className="h-3 w-1 rounded-full bg-[var(--text-disabled)]" />
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{match.opponent.name}</p>
            </div>
            <div className="grid gap-1.5">
              {game.opp_players.map((p) => (
                <div key={p.name} className="flex items-center gap-3 rounded-lg border-l-2 border-transparent bg-[var(--bg-primary)]/60 p-2.5">
                  <Image src={championIconUrl(p.champion)} alt={p.champion} width={36} height={36}
                    className="rounded-full border border-[var(--border-gold)] opacity-70" data-tooltip={p.champion} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-secondary)]">{p.name.replace(/^[A-Z]+ /, "")}</p>
                    <p className="text-[10px] text-[var(--text-disabled)]">{p.champion} &middot; {displayRole(p.role)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-data text-sm text-[var(--text-muted)]">
                      <span>{p.kills}</span>/<span>{p.deaths}</span>/<span>{p.assists}</span>
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">{(p.gold / 1000).toFixed(1)}k &middot; {p.cs}CS</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
