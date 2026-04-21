import { getPublishedKills } from "@/lib/supabase/kills";
import { loadRealData } from "@/lib/real-data";
import { ClipsGrid, type ClipCard } from "./clips-grid";

export const revalidate = 60;
export const metadata = {
  title: "Clips — KCKILLS",
  description: "Tous les clips Karmine Corp. Filtrer par joueur, équipe adverse, type de fight, multi-kills, first bloods.",
};

export default async function ClipsPage() {
  const [kills, data] = await Promise.all([
    getPublishedKills(500),
    Promise.resolve(loadRealData()),
  ]);

  // Only KC team_killer + visible clips
  const cards: ClipCard[] = kills
    .filter((k) => k.tracked_team_involvement === "team_killer" && k.kill_visible !== false && k.clip_url_vertical)
    .map((k) => {
      const matchExt = k.games?.matches?.external_id;
      const matchJson = matchExt ? data.matches.find((m) => m.id === matchExt) : null;
      return {
        id: k.id,
        killerChampion: k.killer_champion ?? "?",
        victimChampion: k.victim_champion ?? "?",
        killerPlayerId: k.killer_player_id,
        thumbnail: k.thumbnail_url,
        clipVerticalLow: k.clip_url_vertical_low,
        highlightScore: k.highlight_score,
        avgRating: k.avg_rating,
        ratingCount: k.rating_count ?? 0,
        commentCount: k.comment_count ?? 0,
        impressionCount: k.impression_count ?? 0,
        aiDescription: k.ai_description,
        aiTags: k.ai_tags ?? [],
        multiKill: k.multi_kill,
        isFirstBlood: k.is_first_blood,
        fightType: k.fight_type,
        gameTimeSeconds: k.game_time_seconds ?? 0,
        gameNumber: k.games?.game_number ?? 1,
        matchStage: k.games?.matches?.stage ?? "LEC",
        matchDate: k.games?.matches?.scheduled_at ?? k.created_at,
        opponentCode: matchJson?.opponent.code ?? "LEC",
        opponentName: matchJson?.opponent.name ?? null,
        kcWon: matchJson?.kc_won ?? null,
        matchScore: matchJson ? `${matchJson.kc_score}-${matchJson.opp_score}` : null,
        createdAt: k.created_at,
      };
    })
    // Default: chronological (most recent first by match date)
    .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""));

  return <ClipsGrid initialCards={cards} />;
}
