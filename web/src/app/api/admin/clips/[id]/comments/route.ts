import { NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";

/** GET /api/admin/clips/[id]/comments — tous les commentaires du kill, quel que soit leur statut de modération. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const { id } = await params;

  const { data, error } = await g.sb
    .from("comments")
    .select("id, content, moderation_status, created_at, toxicity_score, user_id")
    .eq("kill_id", id)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
