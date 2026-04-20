import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ClipDetailEditor } from "./clip-detail-editor";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Edit Clip — Admin",
  robots: { index: false, follow: false },
};

export default async function ClipDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createServerSupabase();
  const { data: clip } = await sb
    .from("kills")
    .select(
      "id, killer_champion, victim_champion, game_time_seconds, highlight_score, " +
        "avg_rating, rating_count, comment_count, impression_count, " +
        "clip_url_horizontal, clip_url_vertical, clip_url_vertical_low, " +
        "thumbnail_url, og_image_url, ai_description, ai_tags, caster_hype_level, " +
        "multi_kill, is_first_blood, tracked_team_involvement, assistants, " +
        "confidence, fight_type, lane_phase, matchup_lane, champion_class, " +
        "kill_visible, needs_reclip, reclip_reason, status, retry_count, " +
        "created_at, updated_at, " +
        "games!inner (external_id, game_number, vod_youtube_id, vod_offset_seconds, " +
        "  matches!inner (external_id, stage, scheduled_at))",
    )
    .eq("id", id)
    .single();

  if (!clip) notFound();

  return <ClipDetailEditor clip={clip} />;
}
