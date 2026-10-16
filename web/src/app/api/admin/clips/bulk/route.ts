import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  adminDbUnavailable,
  deriveActorRole,
  logAdminAction,
  requireAdmin,
} from "@/lib/admin/audit";

const VALID_ACTIONS = [
  "hide", "unhide",
  "mark_reclip", "clear_reclip",
  "set_fight_type", "add_tags", "remove_tags",
  "mark_reanalyze", "approve_qc", "set_featured",
];

/**
 * POST /api/admin/clips/bulk
 *
 * Body: { ids: string[], action: string, payload?: any }
 * Response: { ok: true, affected } — affected = lignes réellement modifiées
 * (0 si aucun id ne correspond : l'appelant ne doit rien retirer de l'UI).
 *
 * Actions:
 *   hide           — set kill_visible=false
 *   unhide         — set kill_visible=true
 *   mark_reclip    — set needs_reclip=true + reason from payload.reason
 *   clear_reclip   — set needs_reclip=false
 *   set_fight_type — payload.fight_type
 *   add_tags       — payload.tags (merge with existing ai_tags)
 *   remove_tags    — payload.tags
 *   mark_reanalyze — job clip.analyze par kill (priorité éditoriale). Plus de
 *                    status='clipped' : changer `status` fait recalculer
 *                    publication_status par trigger et dépubliait le clip.
 *   approve_qc     — validation humaine : game_events.qc_human_approved = true
 *                    (porte de publication) + kills.qc_status = 'passed'
 *   set_featured   — programme les clips en « clip du jour » sur les
 *                    prochains jours LIBRES à partir d'aujourd'hui (UTC),
 *                    dans l'ordre de sélection ; n'écrase aucun jour déjà pris
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

  const sb = createServiceSupabase();
  if (!sb) return adminDbUnavailable();

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
    case "approve_qc":
    case "set_featured":
      complexUpdate = true;
      break;
    case "add_tags":
    case "remove_tags":
      if (!Array.isArray(payload.tags) || payload.tags.length === 0) {
        return NextResponse.json({ error: "payload.tags[] required" }, { status: 400 });
      }
      complexUpdate = true;
      break;
  }

  // `affected` = lignes réellement modifiées (.select("id")), pas ids.length :
  // l'UI doit pouvoir repérer un 200 qui n'a rien changé en base.
  let affected = 0;
  let writeError: string | null = null;

  if (action === "mark_reanalyze") {
    const results = await Promise.all(
      ids.map((id) =>
        sb.from("pipeline_jobs").insert({
          type: "clip.analyze",
          entity_type: "kill",
          entity_id: id,
          priority: 80,
          payload: { kill_id: id, requested_by: "admin_bulk" },
        }),
      ),
    );
    for (const r of results) {
      // 23505 : un job identique attend déjà, c'est le résultat voulu.
      if (!r.error || r.error.code === "23505") affected++;
      else writeError ??= r.error.message;
    }
  } else if (action === "approve_qc") {
    const { data, error } = await sb
      .from("game_events")
      .update({ qc_human_approved: true, publish_blocked_reason: null })
      .in("kill_id", ids)
      .select("kill_id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { error: kErr } = await sb
      .from("kills")
      .update({ qc_status: "passed", updated_at: new Date().toISOString() })
      .in("id", ids);
    writeError = kErr?.message ?? null;
    affected = data?.length ?? 0;
  } else if (action === "set_featured") {
    const today = new Date();
    const horizon = new Date(today.getTime() + 366 * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const { data: taken, error } = await sb
      .from("featured_clips")
      .select("feature_date")
      .gte("feature_date", iso(today))
      .lte("feature_date", iso(horizon));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const busy = new Set((taken ?? []).map((r) => r.feature_date as string));
    const rows: { feature_date: string; kill_id: string; set_by_actor: string; notes: string }[] = [];
    const cursor = new Date(today);
    for (const id of ids.slice(0, 60)) {
      while (busy.has(iso(cursor))) cursor.setUTCDate(cursor.getUTCDate() + 1);
      rows.push({ feature_date: iso(cursor), kill_id: id, set_by_actor: "admin", notes: "programmé en lot" });
      busy.add(iso(cursor));
    }
    const { data, error: insErr } = await sb.from("featured_clips").insert(rows).select("feature_date");
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    affected = data?.length ?? 0;
    payload.dates = rows.map((r) => r.feature_date);
  } else if (complexUpdate) {
    // Read current tags, merge, write back (per-row)
    const { data: current, error: readError } = await sb
      .from("kills")
      .select("id, ai_tags")
      .in("id", ids);
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

    const results = await Promise.all(
      (current ?? []).map((row) => {
        const existing: string[] = Array.isArray(row.ai_tags) ? row.ai_tags : [];
        const next: string[] =
          action === "add_tags"
            ? [...new Set([...existing, ...payload.tags])]
            : existing.filter((t) => !payload.tags.includes(t));
        return sb
          .from("kills")
          .update({ ai_tags: next, updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .select("id");
      }),
    );
    for (const r of results) {
      affected += r.data?.length ?? 0;
      writeError ??= r.error?.message ?? null;
    }
  } else {
    patch.updated_at = new Date().toISOString();
    const { data, error } = await sb.from("kills").update(patch).in("id", ids).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    affected = data?.length ?? 0;
  }

  // Journalisé même en échec partiel des tags : les lignes déjà modifiées
  // doivent rester traçables.
  await logAdminAction({
    action: `kill.bulk_${action}`,
    entityType: "kill",
    entityId: `bulk_${ids.length}`,
    after: { ids, action, payload, affected },
    actorRole: deriveActorRole(admin),
    request: req,
  });

  if (writeError) return NextResponse.json({ error: writeError, affected }, { status: 500 });
  return NextResponse.json({ ok: true, affected });
}
