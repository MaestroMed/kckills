import { NextResponse } from "next/server";
import { createAnonSupabase } from "@/lib/supabase/server";

export const revalidate = 300; // 5 min cache

/** GET /api/featured/today — public endpoint for homepage hero */
export async function GET() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const sb = await createAnonSupabase();
    const { data: featured } = await sb
      .from("featured_clips")
      .select("kill_id,notes")
      .eq("feature_date", today)
      .maybeSingle();

    if (!featured) {
      return NextResponse.json({ kill: null }, { headers: cacheHeaders() });
    }

    const { data: kill } = await sb
      .from("kills")
      .select(
        "id,killer_champion,victim_champion,clip_url_vertical,clip_url_horizontal,thumbnail_url,ai_description,highlight_score,multi_kill,is_first_blood,fight_type,game_time_seconds",
      )
      .eq("id", featured.kill_id)
      .eq("status", "published")
      .maybeSingle();

    return NextResponse.json({ kill, notes: featured.notes }, { headers: cacheHeaders() });
  } catch {
    return NextResponse.json({ kill: null });
  }
}

function cacheHeaders(): Record<string, string> {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" };
}
