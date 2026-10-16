import { NextRequest, NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";
import { deriveActorRole, logAdminAction } from "@/lib/admin/audit";
import { fetchAll } from "@/lib/admin/paginate";

/**
 * Échecs définitifs (dead_letter_jobs) regroupés par cause.
 *
 * GET  → { groups: [{ type, error_code, count, sample, last_failed_at }], total }
 *        sur toutes les lignes non résolues (lecture paginée, pas les 1 000
 *        premières).
 * POST { type, error_code, action: "requeue" | "cancel" | "wont_fix" }
 *        applique l'action à tout le groupe :
 *          requeue  → un job neuf par ligne dans pipeline_jobs (un job
 *                     identique déjà en attente compte comme remis), puis
 *                     resolution_status = 'requeued'
 *          cancel   → abandon voulu ('cancelled')
 *          wont_fix → perte acceptée, cause connue ('wont_fix')
 *        Plafond : 2 000 lignes par appel (relancer pour la suite).
 */
interface DlqRow {
  id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  failed_at: string;
}

const MAX_PER_CALL = 2000;

export async function GET() {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const rows = await fetchAll<Pick<DlqRow, "type" | "error_code" | "error_message" | "failed_at" | "id">>((from, to) =>
    g.sb
      .from("dead_letter_jobs")
      .select("id, type, error_code, error_message, failed_at")
      .eq("resolution_status", "pending")
      .order("failed_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
  const groups = new Map<string, { type: string; error_code: string | null; count: number; sample: string | null; last_failed_at: string }>();
  for (const r of rows) {
    const key = `${r.type}\u0000${r.error_code ?? ""}`;
    const cur = groups.get(key);
    if (cur) cur.count++;
    else groups.set(key, { type: r.type, error_code: r.error_code, count: 1, sample: r.error_message?.slice(0, 240) ?? null, last_failed_at: r.failed_at });
  }
  return NextResponse.json({
    total: rows.length,
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
  });
}

export async function POST(req: NextRequest) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const { sb, admin } = g;
  const body = (await req.json().catch(() => ({}))) as { type?: string; error_code?: string | null; action?: string };
  const action = body.action;
  if (!body.type || !["requeue", "cancel", "wont_fix"].includes(action ?? "")) {
    return NextResponse.json({ error: "type et action (requeue | cancel | wont_fix) requis" }, { status: 400 });
  }

  // Un constructeur de requête neuf par page : les builders supabase-js
  // sont mutables, réutiliser le même empilerait les .order()/.range().
  const groupQuery = () => {
    const q = sb
      .from("dead_letter_jobs")
      .select("id, type, entity_type, entity_id, payload, error_code, error_message, failed_at")
      .eq("resolution_status", "pending")
      .eq("type", body.type!);
    return body.error_code ? q.eq("error_code", body.error_code) : q.is("error_code", null);
  };
  const rows = await fetchAll<DlqRow>((from, to) => groupQuery().order("id").range(from, to), MAX_PER_CALL);

  const now = new Date().toISOString();
  let requeued = 0;
  const failedIds = new Set<string>();
  if (action === "requeue") {
    // Par paquets de 50 : un job déjà en attente (index d'idempotence,
    // 23505) ne doit pas faire échouer tout le paquet.
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      const results = await Promise.all(
        chunk.map((r) =>
          sb.from("pipeline_jobs").insert({
            type: r.type,
            entity_type: r.entity_type,
            entity_id: r.entity_id,
            payload: r.payload ?? {},
            priority: 40,
          }),
        ),
      );
      results.forEach((res, j) => {
        if (!res.error || res.error.code === "23505") requeued++;
        else failedIds.add(chunk[j].id);
      });
    }
  }

  const resolvedIds = rows.map((r) => r.id).filter((id) => !failedIds.has(id));
  const status = action === "requeue" ? "requeued" : action === "cancel" ? "cancelled" : "wont_fix";
  let resolved = 0;
  for (let i = 0; i < resolvedIds.length; i += 200) {
    const { data, error } = await sb
      .from("dead_letter_jobs")
      .update({ resolution_status: status, resolved_by: "admin", resolved_at: now, resolution_note: `groupe ${body.type} / ${body.error_code ?? "sans code"}` })
      .in("id", resolvedIds.slice(i, i + 200))
      .select("id");
    if (error) return NextResponse.json({ error: error.message, resolved }, { status: 500 });
    resolved += data?.length ?? 0;
  }

  await logAdminAction({
    action: `dlq.group_${action}`,
    entityType: "dead_letter_jobs",
    entityId: `${body.type}/${body.error_code ?? "null"}`,
    after: { matched: rows.length, resolved, requeued, failed: failedIds.size },
    actorRole: deriveActorRole(admin),
    request: req,
  });
  return NextResponse.json({ ok: true, matched: rows.length, resolved, requeued, failed: failedIds.size, more: rows.length >= MAX_PER_CALL });
}
