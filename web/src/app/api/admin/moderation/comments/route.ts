import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";

/** GET /api/admin/moderation/comments?status=pending|approved|rejected|flagged */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "pending";
  const minToxicity = parseFloat(sp.get("min_toxicity") ?? "0");
  const limit = Math.min(200, parseInt(sp.get("limit") ?? "50", 10));

  const sb = await createServerSupabase();
  let query = sb
    .from("comments")
    .select(
      "id, content, kill_id, user_id, parent_id, moderation_status, " +
        "moderation_reason, toxicity_score, upvotes, report_count, " +
        "is_deleted, created_at, " +
        "kills (id, killer_champion, victim_champion, thumbnail_url, ai_description), " +
        "profiles (discord_username, discord_avatar_url)",
      { count: "exact" },
    )
    .eq("moderation_status", status)
    .eq("is_deleted", false)
    .gte("toxicity_score", minToxicity)
    .order("created_at", { ascending: false })
    .limit(limit);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [], total: count ?? 0 });
}
