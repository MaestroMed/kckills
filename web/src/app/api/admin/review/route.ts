import { NextRequest, NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";

/**
 * GET /api/admin/review?queue=…&offset=N — file de revue des clips.
 *
 *   reports : kills visés par un signalement en attente
 *   qc      : QC humain demandé (qc_status = human_review)
 *   reclip  : clips publiés marqués à re-clipper
 *   recent  : tous les clips publiés, les plus récents d'abord
 *
 * GET ?counts=1 → nombre d'éléments par file.
 */
type ReviewQueue = "reports" | "qc" | "reclip" | "recent";
const QUEUES: ReviewQueue[] = ["reports", "qc", "reclip", "recent"];
const PAGE = 30;

const SELECT =
  "id, killer_champion, victim_champion, game_time_seconds, highlight_score, ai_description, ai_tags, " +
  "clip_url_vertical, clip_url_horizontal, thumbnail_url, kill_visible, needs_reclip, reclip_reason, qc_status, " +
  "publication_status, status, multi_kill, is_first_blood, fight_type, created_at, " +
  "killer:players!kills_killer_player_id_fkey (ign), victim:players!kills_victim_player_id_fkey (ign), " +
  "games (game_number, vod_offset_seconds, matches (stage, scheduled_at))";

const PUBLISHED = "publication_status.eq.published,and(publication_status.is.null,status.eq.published)";

export async function GET(req: NextRequest) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const { sb } = g;
  const sp = req.nextUrl.searchParams;

  const reportedIds = async () => {
    const { data } = await sb
      .from("reports")
      .select("target_id")
      .eq("target_type", "kill")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(500);
    return [...new Set((data ?? []).map((r) => r.target_id as string))];
  };

  // `select` = colonnes, `head` = comptage seul.
  const base = (queue: ReviewQueue, select: string, head = false) => {
    const q = sb.from("kills").select(select, head ? { count: "exact", head: true } : { count: "exact" });
    switch (queue) {
      case "qc":
        return q.eq("qc_status", "human_review");
      case "reclip":
        return q.eq("needs_reclip", true).eq("kill_visible", true).or(PUBLISHED);
      case "recent":
        return q.eq("kill_visible", true).or(PUBLISHED);
      default:
        return q;
    }
  };

  if (sp.get("counts")) {
    const ids = await reportedIds();
    const [qc, reclip, recent] = await Promise.all(
      (["qc", "reclip", "recent"] as const).map((q) => base(q, "id", true)),
    );
    return NextResponse.json({ reports: ids.length, qc: qc.count ?? 0, reclip: reclip.count ?? 0, recent: recent.count ?? 0 });
  }

  const queue = (QUEUES.includes(sp.get("queue") as ReviewQueue) ? sp.get("queue") : "recent") as ReviewQueue;
  const offset = Math.max(0, parseInt(sp.get("offset") ?? "0", 10) || 0);

  let q = base(queue, SELECT);
  if (queue === "reports") {
    const ids = await reportedIds();
    if (!ids.length) return NextResponse.json({ items: [], count: 0 });
    q = q.in("id", ids.slice(offset, offset + PAGE));
  } else {
    q = q.order("created_at", { ascending: false }).range(offset, offset + PAGE - 1);
  }
  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [], count: count ?? null, page: PAGE });
}
