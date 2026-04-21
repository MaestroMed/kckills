import Link from "next/link";
import { loadRealData, getMatchesSorted } from "@/lib/real-data";
import { getPublishedKills } from "@/lib/supabase/kills";
import { createAnonSupabase } from "@/lib/supabase/server";
import { MatchesAccordion } from "./matches-accordion";

export const revalidate = 300;
export const metadata = { title: "Matchs KC \u2014 KCKILLS" };

export default async function MatchesPage() {
  const sb = await createAnonSupabase();
  const [data, allClips, dbMatchesRes, dbTeamsRes] = await Promise.all([
    Promise.resolve(loadRealData()),
    getPublishedKills(500),
    sb.from("matches").select("external_id,scheduled_at,stage,format,team_blue_id,team_red_id,winner_team_id"),
    sb.from("teams").select("id,code,name"),
  ]);
  const matches = getMatchesSorted(data);

  // Build team lookup
  const teams = new Map((dbTeamsRes.data ?? []).map((t) => [t.id, t]));
  const dbMatches = dbMatchesRes.data ?? [];

  // Merge: matches NOT in static JSON but in DB → add as "DB-only"
  const jsonIds = new Set(matches.map((m) => m.id));
  const dbOnly = dbMatches.filter((m) => !jsonIds.has(m.external_id)).map((m) => {
    const blue = teams.get(m.team_blue_id ?? "");
    const red = teams.get(m.team_red_id ?? "");
    const winner = teams.get(m.winner_team_id ?? "");
    const isKcBlue = blue?.code === "KC";
    const opponent = isKcBlue ? red : blue;
    return {
      id: m.external_id,
      date: (m.scheduled_at ?? "").slice(0, 10),
      stage: m.stage ?? "LEC",
      best_of: m.format ?? "bo1",
      opponent: { code: opponent?.code ?? "?", name: opponent?.name ?? "?" },
      kc_won: winner?.code === "KC",
      kc_score: 0,  // unknown without games detail
      opp_score: 0,
      games: [],
    };
  });

  const allMatches = [...matches, ...dbOnly];

  // Count clips per match
  const clipsByMatch = new Map<string, number>();
  for (const clip of allClips) {
    const matchId = clip.games?.matches?.external_id;
    if (matchId) {
      clipsByMatch.set(matchId, (clipsByMatch.get(matchId) ?? 0) + 1);
    }
  }

  // Group by year
  const byYear: Record<string, typeof allMatches> = {};
  for (const m of allMatches) {
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
        clipCount: clipsByMatch.get(match.id) ?? 0,
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
      <p className="text-[var(--text-muted)]">
        {allMatches.length} matchs &middot; {data.total_games} games
        {allClips.length > 0 && (
          <span className="ml-2 text-[var(--gold)]">
            &middot; {allClips.length} clips vid&eacute;o
          </span>
        )}
      </p>

      <MatchesAccordion years={years} />
    </div>
  );
}
