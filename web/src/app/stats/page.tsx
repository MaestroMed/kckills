import Link from "next/link";
import { loadRealData, getTeamStats, getCurrentRoster, getMatchesSorted } from "@/lib/real-data";
import { getPublishedKills } from "@/lib/supabase/kills";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { PageHero } from "@/components/ui/PageHero";
import { TaggingInsights } from "@/components/TaggingInsights";
import type { Metadata } from "next";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Stats KC \u2014 KCKILLS",
  description: "Toutes les statistiques Karmine Corp en LEC. Kills, winrate, KDA, records.",
};

export default async function StatsPage() {
  const data = loadRealData();
  const stats = getTeamStats(data);
  const roster = getCurrentRoster(data);
  const matches = getMatchesSorted(data);
  const clips = await getPublishedKills(1);

  const totalGames = stats.totalGames;
  const winRate = matches.length > 0
    ? Math.round((stats.wins / matches.length) * 100)
    : 0;
  const kda = stats.totalDeaths > 0
    ? ((stats.totalKills + 0) / stats.totalDeaths).toFixed(1)
    : "\u221e";
  const avgKillsPerGame = totalGames > 0
    ? (stats.totalKills / totalGames).toFixed(1)
    : "0";

  // Records
  const bestMatch = matches.reduce(
    (best, m) => {
      const kcKills = m.games.reduce((a, g) => a + g.kc_kills, 0);
      return kcKills > best.kills ? { match: m, kills: kcKills } : best;
    },
    { match: matches[0], kills: 0 }
  );

  const bestPlayer = roster.reduce(
    (best, p) => {
      const killRate = p.gamesPlayed > 0 ? p.totalKills / p.gamesPlayed : 0;
      return killRate > best.rate ? { name: p.name, rate: killRate, role: p.role } : best;
    },
    { name: "", rate: 0, role: "" }
  );

  return (
    <div className="-mt-6">
      <PageHero
        variant="compact"
        crumbs={[
          { label: "Accueil", href: "/" },
          { label: "Stats" },
        ]}
        badge="Karmine Corp · LEC"
        title="STATS"
        subtitle="Toutes les statistiques Karmine Corp depuis l'entree en LEC. Kills, winrate, KDA, records par joueur."
        backgroundSrc="/images/hero-bg.jpg"
      />

      <div className="space-y-10 py-12">

      {/* ═══ BIG NUMBERS ═══ */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Matchs" value={matches.length} color="var(--gold)" />
        <StatCard label="Kills KC" value={stats.totalKills} color="var(--green)" />
        <StatCard label="Winrate" value={winRate} suffix="%" color={winRate >= 50 ? "var(--green)" : "var(--red)"} />
        <StatCard label="Clips vid\u00e9o" value={clips.length > 0 ? clips.length : 0} color="var(--cyan)" />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Games" value={totalGames} color="var(--text-secondary)" />
        <StatCard label="Deaths" value={stats.totalDeaths} color="var(--red)" />
        <StatCard label="K/D ratio" value={parseFloat(kda) || 0} decimal color="var(--gold)" />
        <StatCard label="Kills/game" value={parseFloat(avgKillsPerGame)} decimal color="var(--cyan)" />
      </div>

      {/* ═══ RECORDS ═══ */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-[var(--border-gold)]" />
          <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
            Records
          </span>
          <span className="h-px flex-1 bg-[var(--border-gold)]" />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {bestMatch.match && (
            <Link
              href={`/match/${bestMatch.match.id}`}
              className="stat-card rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 hover:border-[var(--gold)]/40 transition-all"
            >
              <p className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
                Match le plus sanglant
              </p>
              <p className="font-display text-2xl font-black text-[var(--gold)]">
                {bestMatch.kills} kills
              </p>
              <p className="text-sm text-[var(--text-secondary)]">
                KC vs {bestMatch.match.opponent.code} &middot; {bestMatch.match.stage}
              </p>
            </Link>
          )}

          {bestPlayer.name && (
            <Link
              href={`/player/${encodeURIComponent(bestPlayer.name)}`}
              className="stat-card rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 hover:border-[var(--gold)]/40 transition-all"
            >
              <p className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
                Top killer par game
              </p>
              <p className="font-display text-2xl font-black text-[var(--gold)]">
                {bestPlayer.name}
              </p>
              <p className="text-sm text-[var(--text-secondary)]">
                {bestPlayer.rate.toFixed(1)} kills/game &middot; {bestPlayer.role.toUpperCase()}
              </p>
            </Link>
          )}
        </div>
      </section>

      {/* ═══ TAGGING INSIGHTS — distributions sur les 6 dimensions IA ═══ */}
      <TaggingInsights />

      {/* ═══ ROSTER STATS ═══ */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-[var(--border-gold)]" />
          <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
            Roster 2026
          </span>
          <span className="h-px flex-1 bg-[var(--border-gold)]" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-gold)] text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                <th className="py-3 text-left font-data">Joueur</th>
                <th className="py-3 text-left font-data">Role</th>
                <th className="py-3 text-right font-data">Games</th>
                <th className="py-3 text-right font-data">K</th>
                <th className="py-3 text-right font-data">D</th>
                <th className="py-3 text-right font-data">A</th>
                <th className="py-3 text-right font-data">KDA</th>
                <th className="py-3 text-right font-data">Champs</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((p) => {
                const pKda = p.totalDeaths > 0
                  ? ((p.totalKills + p.totalAssists) / p.totalDeaths).toFixed(1)
                  : "\u221e";
                return (
                  <tr key={p.name} className="border-b border-[var(--border-gold)]/30 hover:bg-[var(--bg-elevated)] transition-colors">
                    <td className="py-3">
                      <Link href={`/player/${encodeURIComponent(p.name)}`} className="font-bold text-[var(--gold)] hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="py-3 text-[var(--text-muted)]">{p.role.toUpperCase()}</td>
                    <td className="py-3 text-right font-data">{p.gamesPlayed}</td>
                    <td className="py-3 text-right font-data text-[var(--green)]">{p.totalKills}</td>
                    <td className="py-3 text-right font-data text-[var(--red)]">{p.totalDeaths}</td>
                    <td className="py-3 text-right font-data">{p.totalAssists}</td>
                    <td className="py-3 text-right font-data font-bold text-[var(--gold)]">{pKda}</td>
                    <td className="py-3 text-right font-data">{p.champions.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix = "",
  color,
  decimal = false,
}: {
  label: string;
  value: number;
  suffix?: string;
  color: string;
  decimal?: boolean;
}) {
  return (
    <div className="stat-card rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 text-center">
      <div className="font-data text-3xl md:text-4xl font-black" style={{ color }}>
        {decimal ? value.toFixed(1) : <AnimatedNumber value={value} />}
        {suffix}
      </div>
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mt-1">
        {label}
      </p>
    </div>
  );
}
