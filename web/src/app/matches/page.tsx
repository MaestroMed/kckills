import Link from "next/link";
import { loadRealData, getMatchesSorted } from "@/lib/real-data";
import { MatchesAccordion } from "./matches-accordion";

export const dynamic = "force-dynamic";
export const metadata = { title: "Matchs KC \u2014 KCKILLS" };

export default function MatchesPage() {
  const data = loadRealData();
  const matches = getMatchesSorted(data);

  // Group by year
  const byYear: Record<string, typeof matches> = {};
  for (const m of matches) {
    const year = m.date.slice(0, 4);
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(m);
  }

  const years = Object.entries(byYear)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([year, yearMatches]) => ({
      year,
      matches: yearMatches.map((match) => ({
        id: match.id,
        opponent: match.opponent,
        kc_won: match.kc_won,
        kc_score: match.kc_score,
        opp_score: match.opp_score,
        stage: match.stage,
        best_of: match.best_of,
        date: match.date,
        totalKc: match.games.reduce((a, g) => a + g.kc_kills, 0),
        totalOpp: match.games.reduce((a, g) => a + g.opp_kills, 0),
        hasGames: match.games.length > 0,
      })),
    }));

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>Matchs</span>
      </nav>

      <h1 className="font-display text-3xl font-bold">
        Matchs <span className="text-gold-gradient">Karmine Corp</span>
      </h1>
      <p className="text-[var(--text-muted)]">{matches.length} matchs &middot; {data.total_games} games</p>

      <MatchesAccordion years={years} />
    </div>
  );
}
