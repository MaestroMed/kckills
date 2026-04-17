import { getPublishedKills } from "@/lib/supabase/kills";
import { ReviewClient } from "./review-client";
import type { Metadata } from "next";

export const revalidate = 60;
export const metadata: Metadata = {
  title: "Clip QA Review \u2014 KCKILLS",
  robots: { index: false, follow: false },
};

export default async function ReviewPage() {
  const kills = await getPublishedKills(50);

  const items = kills
    .filter((k) => k.clip_url_horizontal || k.clip_url_vertical)
    .map((k) => ({
      id: k.id,
      killerChampion: k.killer_champion ?? "?",
      victimChampion: k.victim_champion ?? "?",
      clipHorizontal: k.clip_url_horizontal,
      clipVertical: k.clip_url_vertical,
      thumbnail: k.thumbnail_url,
      aiDescription: k.ai_description,
      aiTags: k.ai_tags ?? [],
      highlightScore: k.highlight_score,
      multiKill: k.multi_kill,
      isFirstBlood: k.is_first_blood,
      kcInvolvement: k.tracked_team_involvement,
      gameTimeSeconds: k.game_time_seconds ?? 0,
      gameNumber: k.games?.game_number ?? 1,
      matchStage: k.games?.matches?.stage ?? "LEC",
    }));

  return <ReviewClient items={items} />;
}
