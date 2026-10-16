import { NextRequest, NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";
import { deriveActorRole, logAdminAction } from "@/lib/admin/audit";
import { pickRestorable, tableForAction } from "@/lib/admin/restorable";

/**
 * POST /api/admin/audit/[id]/undo — remet l'entité dans l'état `before`
 * d'une action du journal (kill ou joueur), limité aux colonnes de
 * lib/admin/restorable. L'annulation est elle-même journalisée.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const { id } = await params;

  const { data: row, error } = await g.sb.from("admin_actions").select("*").eq("id", id).maybeSingle();
  if (error || !row) return NextResponse.json({ error: "Action introuvable" }, { status: 404 });

  const table = tableForAction(row.action);
  if (!table || !row.entity_id) {
    return NextResponse.json({ error: `Annulation impossible pour « ${row.action} »` }, { status: 400 });
  }
  const patch = pickRestorable(table, row.before);
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Pas d'état antérieur enregistré pour cette action" }, { status: 400 });
  }

  const { data: current } = await g.sb.from(table).select(Object.keys(patch).join(",")).eq("id", row.entity_id).maybeSingle();
  const { data, error: upErr } = await g.sb.from(table).update(patch).eq("id", row.entity_id).select("id");
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Entité introuvable" }, { status: 404 });

  await logAdminAction({
    action: `${row.action}.undone`,
    entityType: row.entity_type,
    entityId: row.entity_id,
    before: current,
    after: patch,
    notes: `Annulation de l'action ${id}`,
    actorRole: deriveActorRole(g.admin),
    request: req,
  });
  return NextResponse.json({ ok: true, restored: Object.keys(patch) });
}
