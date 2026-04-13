import { loadRealData, getMatchesSorted } from "@/lib/real-data";
import { computeKillScore } from "@/lib/feed-algorithm";
import { getPublishedKills } from "@/lib/supabase/kills";
import { ScrollFeed, type FeedItem, type AggregateFeedItem, type VideoFeedItem } from "./scroll-feed";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Scroll \u2014 KCKILLS",
  description: "Scroll les kills KC comme sur TikTok. Vrais clips vid\u00e9o des matchs LEC, g\u00e9n\u00e9r\u00e9s automatiquement.",
  openGraph: {
    title: "KC Kills \u2014 Le TikTok des kills LoL",
    description: "Scroll, rate et partage chaque kill Karmine Corp de la LEC. Clips vid\u00e9o autoplay + descriptions AI.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "KC Kills \u2014 Le TikTok des kills LoL",
    description: "Scroll les kills KC comme sur TikTok.",
  },
};

export default async function ScrollPage() {
  // ─── 1. Load both data sources in parallel ──────────────────────────
  const [data, allKills] = await Promise.all([
    Promise.resolve(loadRealData()),
    getPublishedKills(500),
  ]);
  // ONLY show KC kills (team_killer) — not deaths, not misidentified opponent kills
  const supabaseKills = allKills.filter(
    (k) => k.tracked_team_involvement === "team_killer"
  );
  const matches = getMatchesSorted(data);

  // ─── 2. Build the Supabase video items (real clips) ────────────────
  const videoItems: VideoFeedItem[] = supabaseKills
    .filter((k) => k.clip_url_vertical) // defensive — already filtered server-side
    .map((k) => {
      const matchMeta = k.games?.matches;
      const matchJson = data.matches.find((m) => m.id === (matchMeta?.external_id ?? ""));
      const opponentCode = matchJson?.opponent.code ?? "LEC";
      const kcWon = matchJson?.kc_won ?? null;
      const matchScore = matchJson ? `${matchJson.kc_score}-${matchJson.opp_score}` : null;
      // Wilson-ish score: (0.6 × highlight/10) + (0.3 × rating/5) + (0.1 × engagement cap)
      const hl = (k.highlight_score ?? 5) / 10;
      const rt = k.rating_count > 0 ? (k.avg_rating ?? 0) / 5 : 0;
      const engagement = k.impression_count > 5
        ? Math.min(1, (k.rating_count + k.comment_count) / k.impression_count)
        : 0;
      let score = hl * 0.6 + rt * 0.3 + engagement * 0.1;
      if (k.multi_kill === "penta") score *= 2.0;
      else if (k.multi_kill === "quadra") score *= 1.5;
      else if (k.multi_kill === "triple") score *= 1.2;
      // KC kills are the hero content — deaths are context but shouldn't dominate the feed
      if (k.tracked_team_involvement === "team_killer") score *= 2.0;
      else if (k.tracked_team_involvement === "team_victim") score *= 0.3;
      // Boost video items so real clips always outrank aggregate items at equal base
      score *= 10;
      return {
        kind: "video" as const,
        id: k.id,
        score,
        killerChampion: k.killer_champion ?? "?",
        victimChampion: k.victim_champion ?? "?",
        clipVertical: k.clip_url_vertical ?? "",
        clipVerticalLow: k.clip_url_vertical_low ?? null,
        clipHorizontal: k.clip_url_horizontal ?? null,
        thumbnail: k.thumbnail_url ?? null,
        highlightScore: k.highlight_score ?? null,
        avgRating: k.avg_rating ?? null,
        ratingCount: k.rating_count,
        aiDescription: k.ai_description ?? null,
        aiTags: k.ai_tags ?? [],
        multiKill: k.multi_kill,
        isFirstBlood: k.is_first_blood,
        kcInvolvement: k.tracked_team_involvement,
        gameTimeSeconds: k.game_time_seconds ?? 0,
        gameNumber: k.games?.game_number ?? 1,
        matchExternalId: matchMeta?.external_id ?? "",
        matchStage: matchMeta?.stage ?? "LEC",
        matchDate: matchMeta?.scheduled_at ?? k.created_at,
        opponentCode,
        kcWon,
        matchScore,
      };
    });

  // ─── 3. Build legacy aggregate items (fallback while backfill runs) ──
  const videoMatchIds = new Set(
    videoItems.map((v) => v.matchExternalId).filter(Boolean)
  );

  const aggregateItems: AggregateFeedItem[] = [];
  for (const match of matches) {
    // Skip matches that already have real clips — prevents the same match
    // from appearing twice (once as video, once as aggregate).
    if (videoMatchIds.has(match.id)) continue;

    for (const game of match.games) {
      for (const p of game.kc_players) {
        if (!p.name.startsWith("KC ")) continue;
        if (p.kills === 0 && p.assists === 0) continue;
        const cleanName = p.name.replace("KC ", "");
        const bestOpp = [...game.opp_players].sort((a, b) => b.deaths - a.deaths)[0] ?? null;
        const score = computeKillScore(
          p.kills,
          p.deaths,
          p.assists,
          game.kc_kills,
          true,
          match.kc_won
        );

        let multiKill: string | null = null;
        if (p.kills >= 5) multiKill = "penta";
        else if (p.kills >= 4) multiKill = "quadra";
        else if (p.kills >= 3) multiKill = "triple";
        else if (p.kills >= 2) multiKill = "double";

        aggregateItems.push({
          kind: "aggregate",
          id: `${match.id}-${game.number}-${cleanName}`,
          kcPlayer: p,
          oppPlayer: bestOpp,
          match: {
            id: match.id,
            date: match.date,
            stage: match.stage,
            opponent: match.opponent,
            kc_won: match.kc_won,
          },
          game: {
            number: game.number,
            kc_kills: game.kc_kills,
            opp_kills: game.opp_kills,
          },
          isKcKiller: p.kills > 0,
          score,
          multiKill,
        });
      }
    }
  }

  // ─── 4. Merge + sort: videos first by their own score, then aggregates ──
  const items: FeedItem[] = [
    ...videoItems.sort((a, b) => b.score - a.score),
    ...aggregateItems.sort((a, b) => b.score - a.score),
  ];

  return <ScrollFeed items={items} videoCount={videoItems.length} />;
}

// inferOpponent removed — lookup now inline in the map (includes kcWon)
