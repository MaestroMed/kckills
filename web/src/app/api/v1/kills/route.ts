import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { Pagination } from "@/lib/schemas/pagination";

/**
 * GET /api/v1/kills — Public API for published KC kills.
 *
 * Query params:
 *   limit (default 20, max 100)
 *   offset (default 0)
 *   champion — filter by killer_champion
 *   involvement — "team_killer" | "team_victim"
 *   sort — "highlight_score" (default) | "created_at" | "game_time_seconds"
 *
 * Returns JSON array of kill objects with clip URLs, scores, and metadata.
 * Rate limited to anon key RLS — only published kills visible.
 */

const Query = Pagination.extend({
  champion: z.string().min(1).max(64).optional(),
  involvement: z.enum(["team_killer", "team_victim"]).optional(),
  sort: z
    .enum(["highlight_score", "created_at", "game_time_seconds"])
    .default("highlight_score"),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parsed = Query.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid params", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { limit, offset, champion, involvement, sort } = parsed.data;

  const supabase = await createServerSupabase();

  let query = supabase
    .from("kills")
    .select(
      `id, killer_champion, victim_champion, game_time_seconds,
       highlight_score, avg_rating, rating_count,
       clip_url_horizontal, clip_url_vertical, clip_url_vertical_low,
       thumbnail_url, og_image_url,
       ai_description, ai_tags, multi_kill, is_first_blood,
       tracked_team_involvement, created_at`
    )
    .eq("status", "published")
    .not("clip_url_vertical", "is", null);

  if (champion) {
    query = query.eq("killer_champion", champion);
  }
  if (involvement) {
    query = query.eq("tracked_team_involvement", involvement);
  }

  query = query
    .order(sort, { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    kills: data ?? [],
    count: (data ?? []).length,
    offset,
    limit,
  }, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
