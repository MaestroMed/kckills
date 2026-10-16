import { NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";

/** GET /api/admin/clips/[id]/annotations — versions de l'analyse IA (ai_annotations), plus récente d'abord. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const { id } = await params;

  const { data, error } = await g.sb
    .from("ai_annotations")
    .select("id, model_name, cost_usd, ai_description_fr, ai_tags, highlight_score, is_current, created_at")
    .eq("kill_id", id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data ?? []).map((a) => ({
    id: a.id,
    model: a.is_current ? `${a.model_name} · actuelle` : a.model_name,
    cost_usd: a.cost_usd === null ? null : Number(a.cost_usd),
    description: a.ai_description_fr,
    tags: Array.isArray(a.ai_tags) ? (a.ai_tags as string[]) : null,
    highlight_score: a.highlight_score,
    created_at: a.created_at,
  }));
  return NextResponse.json({ items });
}
