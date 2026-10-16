import { NextRequest, NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";
import { deriveActorRole, logAdminAction } from "@/lib/admin/audit";
import { setFeaturedKill } from "@/app/admin/featured/actions";

/**
 * POST /api/admin/clips/[id]/action  { action }
 *
 *   republish  → réaffiche le clip (kill_visible = true)
 *   hide       → masque le clip du feed (kill_visible = false)
 *   reanalyze  → met un job clip.analyze en file (priorité éditoriale)
 *   reclip     → needs_reclip = true (le clipper reprend les kills marqués ;
 *                aucun module ne consomme les jobs clip.reclip)
 *   feature    → clip du jour (featured_clips, date du jour UTC)
 *   og         → régénère l'image de partage (job og.generate)
 *   delete     → RETRAIT réversible : publication_status = 'retracted' et
 *                kill_visible = false. Pas de DELETE : la ligne porte les
 *                notes, commentaires et l'historique du pipeline.
 */
type Action = "republish" | "hide" | "reanalyze" | "reclip" | "feature" | "delete" | "og";
const ACTIONS: Action[] = ["republish", "hide", "reanalyze", "reclip", "feature", "delete", "og"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const { sb, admin } = g;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action as Action;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: `action ∈ ${ACTIONS.join(", ")}` }, { status: 400 });
  }

  const { data: before, error: readErr } = await sb
    .from("kills")
    .select("id, kill_visible, needs_reclip, publication_status, status")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: "Kill introuvable" }, { status: 404 });

  const now = new Date().toISOString();
  let after: Record<string, unknown> = {};

  const update = async (patch: Record<string, unknown>) => {
    const { data, error } = await sb.from("kills").update({ ...patch, updated_at: now }).eq("id", id).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Aucune ligne modifiée");
    after = { ...after, ...patch };
  };
  const enqueue = async (type: "clip.analyze" | "og.generate") => {
    const { error } = await sb.from("pipeline_jobs").insert({
      type,
      entity_type: "kill",
      entity_id: id,
      priority: 80,
      payload: { kill_id: id, requested_by: "admin" },
    });
    // 23505 = un job identique est déjà en attente (index d'idempotence) : c'est le résultat voulu.
    if (error && error.code !== "23505") throw new Error(error.message);
    after = { ...after, job: type, already_queued: error?.code === "23505" };
  };

  try {
    switch (action) {
      case "republish":
        // Annule aussi un retrait fait depuis cette fiche (« delete »).
        await update(before.publication_status === "retracted"
          ? { kill_visible: true, publication_status: "published" }
          : { kill_visible: true });
        break;
      case "hide":
        await update({ kill_visible: false });
        break;
      case "reanalyze":
        await enqueue("clip.analyze");
        break;
      case "og":
        await enqueue("og.generate");
        break;
      case "reclip":
        await update({ needs_reclip: true, reclip_reason: "admin: re-clip demandé depuis la fiche" });
        break;
      case "feature": {
        const r = await setFeaturedKill(now.slice(0, 10), id, "depuis la fiche clip");
        if (!r.ok) throw new Error(r.error ?? "Mise en avant impossible");
        after = { featured_date: now.slice(0, 10) };
        break;
      }
      case "delete":
        await update({ publication_status: "retracted", kill_visible: false });
        break;
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  if (action !== "feature") {
    // setFeaturedKill journalise déjà sa propre action.
    await logAdminAction({
      action: `kill.${action}`,
      entityType: "kill",
      entityId: id,
      before,
      after,
      actorRole: deriveActorRole(admin),
      request: req,
    });
  }
  return NextResponse.json({ ok: true, action, after });
}
