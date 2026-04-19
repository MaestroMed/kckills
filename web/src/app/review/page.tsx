import { getPublishedKills } from "@/lib/supabase/kills";
import { ReviewEditor } from "./review-editor";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Backoffice Clips \u2014 KCKILLS",
  robots: { index: false, follow: false },
};

export default async function ReviewPage() {
  // Load ALL kills, not just 50
  const kills = await getPublishedKills(500);

  const items = kills
    .filter((k) => k.tracked_team_involvement === "team_killer")
    .filter((k) => k.clip_url_vertical)
    .map((k) => ({
      id: k.id,
      killerChampion: k.killer_champion ?? "?",
      victimChampion: k.victim_champion ?? "?",
      clipHorizontal: k.clip_url_horizontal,
      clipVertical: k.clip_url_vertical,
      thumbnail: k.thumbnail_url,
      aiDescription: k.ai_description ?? "",
      aiTags: k.ai_tags ?? [],
      fightType: k.fight_type ?? "solo_kill",
      highlightScore: k.highlight_score ?? 5,
      multiKill: k.multi_kill,
      isFirstBlood: k.is_first_blood,
      killVisible: k.kill_visible ?? true,
      kcInvolvement: k.tracked_team_involvement,
      gameTimeSeconds: k.game_time_seconds ?? 0,
      gameNumber: k.games?.game_number ?? 1,
      matchStage: k.games?.matches?.stage ?? "LEC",
    }));

  return <ReviewEditor items={items} />;
}
