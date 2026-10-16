import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { adminDbUnavailable, requireAdmin } from "@/lib/admin/audit";

/** GET /api/admin/moderation/comments?status=pending|approved|rejected|flagged */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "pending";
  const minToxicity = parseFloat(sp.get("min_toxicity") ?? "0");
  const limit = Math.min(200, parseInt(sp.get("limit") ?? "50", 10));

  const sb = createServiceSupabase();

  if (!sb) return adminDbUnavailable();
  let query = sb
    .from("comments")
    .select(
      "id, content, kill_id, user_id, parent_id, moderation_status, " +
        "moderation_reason, toxicity_score, upvotes, report_count, " +
        "is_deleted, created_at, " +
        "kills (id, killer_champion, victim_champion, thumbnail_url, ai_description)",
      { count: "exact" },
    )
    .eq("moderation_status", status)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  // Un commentaire pas encore passé par Haiku a toxicity_score NULL : le
  // filtre ne s'applique que si on demande un seuil (sinon la file
  // « pending » excluait justement les commentaires à modérer).
  if (minToxicity > 0) query = query.gte("toxicity_score", minToxicity);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // comments.user_id pointe sur auth.users, pas sur profiles : pas de
  // jointure PostgREST possible, on rattache les profils à part.
  const rows = (data ?? []) as unknown as Array<{ user_id: string } & Record<string, unknown>>;
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const profiles = new Map<string, { discord_username: string | null; discord_avatar_url: string | null }>();
  if (userIds.length) {
    const { data: profs } = await sb
      .from("profiles")
      .select("id, discord_username, discord_avatar_url")
      .in("id", userIds);
    for (const p of profs ?? []) profiles.set(p.id, { discord_username: p.discord_username, discord_avatar_url: p.discord_avatar_url });
  }
  const items = rows.map((r) => ({ ...r, profiles: profiles.get(r.user_id) ?? null }));

  return NextResponse.json({ items, total: count ?? 0 });
}
