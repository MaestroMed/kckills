import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";
import { patchClip } from "@/app/admin/clips/actions";

/** GET /api/admin/clips/[id] */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: 403 });

  const { id } = await params;
  const sb = await createServerSupabase();
  const { data, error } = await sb
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

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

/** PATCH /api/admin/clips/[id] — Wave 18 thin proxy onto the server
 *  action so external callers (Postman / scripts) keep working. The
 *  admin clip-detail editor calls patchClip() directly via the server
 *  action import — no HTTP round-trip. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = await patchClip(id, body as Record<string, never>);
  if (!result.ok) {
    const status = result.error?.includes("Forbidden") ? 403 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, patched: result.patched ?? [] });
}
