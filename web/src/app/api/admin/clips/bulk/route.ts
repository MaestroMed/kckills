import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { deriveActorRole, logAdminAction, requireAdmin } from "@/lib/admin/audit";

const VALID_ACTIONS = [
  "hide", "unhide",
  "mark_reclip", "clear_reclip",
  "set_fight_type", "add_tags", "remove_tags",
  "mark_reanalyze",
];

/**
 * POST /api/admin/clips/bulk
 *
 * Body: { ids: string[], action: string, payload?: any }
 *
 * Actions:
 *   hide           — set kill_visible=false
 *   unhide         — set kill_visible=true
 *   mark_reclip    — set needs_reclip=true + reason from payload.reason
 *   clear_reclip   — set needs_reclip=false
 *   set_fight_type — payload.fight_type
 *   add_tags       — payload.tags (merge with existing ai_tags)
 *   remove_tags    — payload.tags
 *   mark_reanalyze — set status='clipped', retry_count=0 (daemon picks up next cycle)
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: 403 });

  const body = await req.json();
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  const action: string = body.action ?? "";
  const payload = body.payload ?? {};

  if (ids.length === 0) {
    return NextResponse.json({ error: "No ids provided" }, { status: 400 });
  }
  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: "Max 500 ids per bulk op" }, { status: 400 });
  }

  const sb = await createServerSupabase();

  let patch: Record<string, unknown> = {};
  let complexUpdate = false;

  switch (action) {
    case "hide":
      patch = { kill_visible: false };
      break;
    case "unhide":
      patch = { kill_visible: true };
      break;
    case "mark_reclip":
      patch = { needs_reclip: true, reclip_reason: payload.reason ?? "bulk admin flag" };
      break;
    case "clear_reclip":
      patch = { needs_reclip: false, reclip_reason: null };
      break;
    case "set_fight_type":
      if (typeof payload.fight_type !== "string") {
        return NextResponse.json({ error: "payload.fight_type required" }, { status: 400 });
      }
      patch = { fight_type: payload.fight_type };
      break;
    case "mark_reanalyze":
      patch = { status: "clipped", retry_count: 0 };
      break;
    case "add_tags":
    case "remove_tags":
      if (!Array.isArray(payload.tags) || payload.tags.length === 0) {
        return NextResponse.json({ error: "payload.tags[] required" }, { status: 400 });
      }
      complexUpdate = true;
      break;
  }

  if (complexUpdate) {
    // Read current tags, merge, write back (per-row)
    const { data: current } = await sb
      .from("kills")
      .select("id, ai_tags")
      .in("id", ids);

    const updates: Promise<unknown>[] = [];
    for (const row of current ?? []) {
      const existing: string[] = Array.isArray(row.ai_tags) ? row.ai_tags : [];
      let next: string[];
      if (action === "add_tags") {
        next = [...new Set([...existing, ...payload.tags])];
      } else {
        next = existing.filter((t) => !payload.tags.includes(t));
      }
      updates.push(
        Promise.resolve(
          sb.from("kills").update({ ai_tags: next, updated_at: new Date().toISOString() }).eq("id", row.id),
        ),
      );
    }
    await Promise.all(updates);
  } else {
    patch.updated_at = new Date().toISOString();
    const { error } = await sb.from("kills").update(patch).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAction({
    action: `kill.bulk_${action}`,
    entityType: "kill",
    entityId: `bulk_${ids.length}`,
    after: { ids, action, payload },
    actorRole: deriveActorRole(admin),
    request: req,
  });

  return NextResponse.json({ ok: true, affected: ids.length });
}
