import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { logAdminAction, requireAdmin } from "@/lib/admin/audit";

const VALID_FIGHT_TYPES = [
  "solo_kill", "pick", "gank", "skirmish_2v2", "skirmish_3v3",
  "teamfight_4v4", "teamfight_5v5",
];

const VALID_TAGS = [
  "outplay", "teamfight", "solo_kill", "tower_dive", "baron_fight",
  "dragon_fight", "flash_predict", "1v2", "1v3", "clutch", "clean",
  "mechanical", "shutdown", "comeback", "engage", "peel", "snipe",
  "steal", "skirmish", "pick", "gank", "ace", "flank",
];

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

/** PATCH /api/admin/clips/[id] — edit + audit */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const sb = await createServerSupabase();

  // Load current state for audit diff
  const { data: before } = await sb
    .from("kills")
    .select("ai_description, fight_type, ai_tags, highlight_score, kill_visible, needs_reclip, reclip_reason")
    .eq("id", id)
    .single();

  const patch: Record<string, unknown> = {};

  if (typeof body.ai_description === "string" && body.ai_description.trim()) {
    patch.ai_description = body.ai_description.trim();
  }
  if (typeof body.fight_type === "string" && VALID_FIGHT_TYPES.includes(body.fight_type)) {
    patch.fight_type = body.fight_type;
  }
  if (Array.isArray(body.ai_tags)) {
    patch.ai_tags = body.ai_tags.filter((t: string) => VALID_TAGS.includes(t));
  }
  if (typeof body.highlight_score === "number" && body.highlight_score >= 1 && body.highlight_score <= 10) {
    patch.highlight_score = Math.round(body.highlight_score * 10) / 10;
  }
  if (typeof body.hidden === "boolean") {
    patch.kill_visible = !body.hidden;
  } else if (typeof body.kill_visible === "boolean") {
    patch.kill_visible = body.kill_visible;
  }
  if (typeof body.needs_reclip === "boolean") {
    patch.needs_reclip = body.needs_reclip;
    if (body.needs_reclip && typeof body.reclip_reason === "string") {
      patch.reclip_reason = body.reclip_reason;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  patch.updated_at = new Date().toISOString();

  const { error } = await sb.from("kills").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    action: "kill.edit",
    entityType: "kill",
    entityId: id,
    before,
    after: patch,
  });

  return NextResponse.json({ ok: true, patched: Object.keys(patch) });
}
