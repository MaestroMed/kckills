import "server-only";
import { createServerSupabase } from "./server";

export interface PublishedMoment {
  id: string;
  game_id: string;
  classification: string;
  kill_count: number;
  blue_kills: number;
  red_kills: number;
  kc_involvement: string;
  gold_swing: number;
  participants_involved: number;
  start_time_seconds: number;
  end_time_seconds: number;
  clip_url_horizontal: string | null;
  clip_url_vertical: string | null;
  clip_url_vertical_low: string | null;
  /** HLS master playlist URL (Phase 4 / migration 007). NULL until
   *  worker hls_packager has processed this moment. */
  hls_master_url: string | null;
  thumbnail_url: string | null;
  moment_score: number | null;
  ai_tags: string[];
  ai_description: string | null;
  avg_rating: number | null;
  rating_count: number;
  comment_count: number;
  impression_count: number;
  created_at: string;
}

export async function getPublishedMoments(
  limit = 200
): Promise<PublishedMoment[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("moments")
    .select(
      `id, game_id, classification, kill_count, blue_kills, red_kills,
       kc_involvement, gold_swing, participants_involved,
       start_time_seconds, end_time_seconds,
       clip_url_horizontal, clip_url_vertical, clip_url_vertical_low,
       hls_master_url,
       thumbnail_url, moment_score, ai_tags, ai_description,
       avg_rating, rating_count, comment_count, impression_count,
       created_at`
    )
    .eq("status", "published")
    .not("clip_url_vertical", "is", null)
    .not("thumbnail_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Failed to fetch moments:", error.message);
    return [];
  }

  return (data ?? []) as PublishedMoment[];
}

export async function getMomentById(
  id: string
): Promise<PublishedMoment | null> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("moments")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    return null;
  }

  return data as PublishedMoment;
}

export async function getMomentKills(momentId: string) {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("kills")
    .select(
      `id, killer_champion, victim_champion, game_time_seconds,
       tracked_team_involvement, is_first_blood, multi_kill,
       highlight_score, ai_description`
    )
    .eq("moment_id", momentId)
    .order("game_time_seconds", { ascending: true });

  if (error) {
    console.error("Failed to fetch moment kills:", error.message);
    return [];
  }

  return data ?? [];
}
