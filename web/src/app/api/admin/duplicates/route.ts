import { NextRequest, NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";
import { deriveActorRole, logAdminAction } from "@/lib/admin/audit";
import { readConfig, writeConfig } from "@/lib/admin/config-store";
import { pairKey } from "@/lib/admin/duplicates";

/**
 * POST /api/admin/duplicates
 *   { keep, drop }        neutralise `drop` comme doublon de `keep` : même
 *                         convention que worker/scripts/dedup_cross_game.py
 *                         (status = duplicate, is_duplicate_of = keep), ce qui
 *                         le retire du feed ; ses anciennes URL redirigent vers
 *                         `keep` (getDuplicateKeeperId).
 *   { ignore: [a, b] }    « pas un doublon » : la paire ne sera plus proposée
 *                         (liste sur R2, config/dedup-ignored.json).
 */
export async function POST(req: NextRequest) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const body = (await req.json().catch(() => ({}))) as { keep?: string; drop?: string; ignore?: [string, string] };

  if (body.ignore?.length === 2) {
    const cur = (await readConfig<{ keys: string[] }>("dedup-ignored")) ?? { keys: [] };
    const key = pairKey(body.ignore[0], body.ignore[1]);
    if (!cur.keys.includes(key)) cur.keys.push(key);
    await writeConfig("dedup-ignored", cur);
    return NextResponse.json({ ok: true });
  }

  const { keep, drop } = body;
  if (!keep || !drop || keep === drop) return NextResponse.json({ error: "keep et drop requis" }, { status: 400 });

  const { data: before } = await g.sb.from("kills").select("id, status, publication_status, kill_visible, is_duplicate_of").eq("id", drop).maybeSingle();
  if (!before) return NextResponse.json({ error: "Kill introuvable" }, { status: 404 });

  const { data, error } = await g.sb
    .from("kills")
    .update({ status: "duplicate", is_duplicate_of: keep, kill_visible: false, updated_at: new Date().toISOString() })
    .eq("id", drop)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Aucune ligne modifiée" }, { status: 500 });

  await logAdminAction({
    action: "kill.mark_duplicate",
    entityType: "kill",
    entityId: drop,
    before,
    after: { status: "duplicate", is_duplicate_of: keep, kill_visible: false },
    actorRole: deriveActorRole(g.admin),
    request: req,
  });
  return NextResponse.json({ ok: true });
}
