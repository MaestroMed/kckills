import { NextRequest, NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";

/**
 * GET /api/admin/texts?tab=…&q=…&offset=N — descriptions des clips en ligne.
 *
 *   provisional : texte de repli « … analyse IA en attente » (pannes de
 *                 quota d'avril et juillet) — il apparaît jusque dans l'OG
 *   missing     : aucune description
 *   all         : toutes, avec recherche plein texte optionnelle
 */
const PAGE = 40;
const PUBLISHED = "publication_status.eq.published,and(publication_status.is.null,status.eq.published)";

export async function GET(req: NextRequest) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const sp = req.nextUrl.searchParams;
  const tab = sp.get("tab") ?? "provisional";
  const q = (sp.get("q") ?? "").trim().replace(/[^\p{L}\p{N} '-]/gu, " ").slice(0, 80);
  const offset = Math.max(0, parseInt(sp.get("offset") ?? "0", 10) || 0);

  const base = (head: boolean) => {
    let b = g.sb
      .from("kills")
      .select(
        head ? "id" : "id, killer_champion, victim_champion, ai_description, thumbnail_url, highlight_score, game_time_seconds, updated_at",
        head ? { count: "exact", head: true } : { count: "exact" },
      )
      .eq("kill_visible", true)
      .or(PUBLISHED);
    if (tab === "provisional") b = b.ilike("ai_description", "%analyse IA en attente%");
    else if (tab === "missing") b = b.is("ai_description", null);
    else if (q) b = b.ilike("ai_description", `%${q}%`);
    return b;
  };

  if (sp.get("counts")) {
    const [p, m] = await Promise.all([
      g.sb.from("kills").select("id", { count: "exact", head: true }).eq("kill_visible", true).or(PUBLISHED).ilike("ai_description", "%analyse IA en attente%"),
      g.sb.from("kills").select("id", { count: "exact", head: true }).eq("kill_visible", true).or(PUBLISHED).is("ai_description", null),
    ]);
    return NextResponse.json({ provisional: p.count ?? 0, missing: m.count ?? 0 });
  }

  const { data, error, count } = await base(false).order("highlight_score", { ascending: false, nullsFirst: false }).order("id").range(offset, offset + PAGE - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [], count: count ?? 0, page: PAGE });
}
