import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";

/**
 * GET /api/admin/clips
 *
 * Query params:
 *   q               — full-text search in description (search_vector)
 *   fight_type[]    — filter by fight_type
 *   tags[]          — filter by AI tag (any-of)
 *   min_score       — minimum highlight_score
 *   max_score       — maximum highlight_score
 *   hidden          — 'true' | 'false' | 'only'
 *   has_description — 'true' | 'false'
 *   involvement     — 'team_killer' | 'team_victim' | 'any'
 *   sort            — 'score_desc' | 'score_asc' | 'recent' | 'oldest' | 'rating' | 'comments'
 *   limit           — max 500, default 100
 *   cursor          — ISO timestamp for cursor pagination
 */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const fightTypes = sp.getAll("fight_type");
  const tags = sp.getAll("tags");
  const minScore = sp.get("min_score");
  const maxScore = sp.get("max_score");
  const hidden = sp.get("hidden"); // 'true' hides, 'only' shows only hidden, null shows both
  const hasDescription = sp.get("has_description");
  const involvement = sp.get("involvement") ?? "team_killer";
  const sort = sp.get("sort") ?? "score_desc";
  const limit = Math.min(500, parseInt(sp.get("limit") ?? "100", 10));

  const sb = await createServerSupabase();
  let query = sb
    .from("kills")
    .select(
      "id, killer_champion, victim_champion, game_time_seconds, highlight_score, " +
        "avg_rating, rating_count, comment_count, impression_count, " +
        "clip_url_vertical, thumbnail_url, ai_description, ai_tags, " +
        "multi_kill, is_first_blood, tracked_team_involvement, " +
        "kill_visible, fight_type, needs_reclip, created_at, updated_at, " +
        "games!inner (game_number, matches!inner (external_id, stage, scheduled_at))",
      { count: "exact" },
    )
    .eq("status", "published");

  if (involvement !== "any") {
    query = query.eq("tracked_team_involvement", involvement);
  }

  if (hidden === "only") query = query.eq("kill_visible", false);
  else if (hidden === "true") query = query.eq("kill_visible", true);
  // null/"false" = show both

  if (hasDescription === "true") query = query.not("ai_description", "is", null);
  else if (hasDescription === "false") query = query.is("ai_description", null);

  if (minScore) query = query.gte("highlight_score", parseFloat(minScore));
  if (maxScore) query = query.lte("highlight_score", parseFloat(maxScore));

  if (fightTypes.length > 0) query = query.in("fight_type", fightTypes);

  if (tags.length > 0) {
    // ai_tags is JSONB array — contains any of the tags
    query = query.overlaps("ai_tags", tags);
  }

  if (q) {
    // Full-text via search_vector (see migration 001 trigger)
    query = query.textSearch("search_vector", q, { type: "websearch" });
  }

  // Sort
  switch (sort) {
    case "score_asc":
      query = query.order("highlight_score", { ascending: true, nullsFirst: true });
      break;
    case "recent":
      query = query.order("created_at", { ascending: false });
      break;
    case "oldest":
      query = query.order("created_at", { ascending: true });
      break;
    case "rating":
      query = query.order("avg_rating", { ascending: false, nullsFirst: false });
      break;
    case "comments":
      query = query.order("comment_count", { ascending: false });
      break;
    case "score_desc":
    default:
      query = query.order("highlight_score", { ascending: false, nullsFirst: false });
      break;
  }

  query = query.limit(limit);

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    items: data ?? [],
    total: count ?? 0,
    limit,
  });
}
