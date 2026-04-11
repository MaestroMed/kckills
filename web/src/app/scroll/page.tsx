import { loadRealData, getMatchesSorted } from "@/lib/real-data";
import { computeKillScore } from "@/lib/feed-algorithm";
import { ScrollFeed } from "./scroll-feed";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Scroll \u2014 KCKILLS",
  description: "Scroll les kills KC comme sur TikTok.",
};

export default function ScrollPage() {
  const data = loadRealData();
  const matches = getMatchesSorted(data);

  const items: {
    id: string;
    kcPlayer: { name: string; champion: string; role: string; kills: number; deaths: number; assists: number; gold: number; cs: number; level: number };
    oppPlayer: { name: string; champion: string; role: string; kills: number; deaths: number; assists: number; gold: number; cs: number; level: number } | null;
    match: { id: string; date: string; stage: string; opponent: { code: string; name: string }; kc_won: boolean };
    game: { number: number; kc_kills: number; opp_kills: number };
    isKcKiller: boolean;
    score: number;
    multiKill: string | null;
  }[] = [];

  for (const match of matches) {
    for (const game of match.games) {
      for (const p of game.kc_players) {
        if (!p.name.startsWith("KC ")) continue;
        if (p.kills === 0 && p.assists === 0) continue;
        const cleanName = p.name.replace("KC ", "");
        const bestOpp = [...game.opp_players].sort((a, b) => b.deaths - a.deaths)[0] ?? null;
        const score = computeKillScore(p.kills, p.deaths, p.assists, game.kc_kills, true, match.kc_won);

        // Detect multi-kill
        let multiKill: string | null = null;
        if (p.kills >= 5) multiKill = "penta";
        else if (p.kills >= 4) multiKill = "quadra";
        else if (p.kills >= 3) multiKill = "triple";
        else if (p.kills >= 2) multiKill = "double";

        items.push({
          id: `${match.id}-${game.number}-${cleanName}`,
          kcPlayer: p,
          oppPlayer: bestOpp,
          match: { id: match.id, date: match.date, stage: match.stage, opponent: match.opponent, kc_won: match.kc_won },
          game: { number: game.number, kc_kills: game.kc_kills, opp_kills: game.opp_kills },
          isKcKiller: p.kills > 0,
          score,
          multiKill,
        });
      }
    }
  }

  // Sort by Wilson score (best performances first) instead of chronological
  items.sort((a, b) => b.score - a.score);

  return <ScrollFeed items={items} />;
}
