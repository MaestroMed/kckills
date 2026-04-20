import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";

/** GET /api/admin/audit — list admin actions */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const entityType = sp.get("entity_type");
  const actor = sp.get("actor");
  const limit = Math.min(200, parseInt(sp.get("limit") ?? "50", 10));

  const sb = await createServerSupabase();
  let query = sb
    .from("admin_actions")
    .select("id, actor_label, action, entity_type, entity_id, created_at, notes")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (entityType) query = query.eq("entity_type", entityType);
  if (actor) query = query.eq("actor_label", actor);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [] });
}
