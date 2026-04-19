import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

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

/**
 * PATCH /api/kills/[id]/edit — admin edit a kill's metadata
 *
 * Body: { ai_description?, fight_type?, ai_tags?, highlight_score?, hidden? }
 *
 * No auth check for now — this is an internal tool on a non-indexed route.
 * TODO: add admin auth when we have Discord login.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

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

  // Hidden = remove from feed (set kill_visible = false)
  if (typeof body.hidden === "boolean") {
    patch.kill_visible = !body.hidden;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const sb = await createServerSupabase();
  const { error } = await sb
    .from("kills")
    .update(patch)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, patched: Object.keys(patch) });
}
