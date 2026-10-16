import { NextRequest, NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";
import { deriveActorRole, logAdminAction } from "@/lib/admin/audit";

/**
 * POST /api/admin/games/[id]
 *
 *   { action: "set_vod", vod_youtube_id, vod_offset_seconds, force? }
 *       recale la VOD de la game. Refusé (409) si une autre game du même
 *       match a déjà cette VOD à moins de 15 min — sauf `force: true`.
 *   { action: "reclip_all" }  needs_reclip sur tous les clips de la game
 *   { action: "hide_all" }    retire les clips de la game du feed
 *                             (kill_visible = false + needs_reclip)
 *   { action: "show_all" }    remet en ligne les clips masqués de la game
 *
 * Les kills restent publiés pendant le re-clip (décision du 30/09 : on
 * ne change jamais `status`, qui dépublierait par trigger).
 */
const VOD_RE = /^[A-Za-z0-9_-]{11}$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const { sb, admin } = g;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    vod_youtube_id?: string;
    vod_offset_seconds?: number;
    force?: boolean;
  };

  const { data: game, error } = await sb
    .from("games")
    .select("id, match_id, game_number, vod_youtube_id, vod_offset_seconds")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!game) return NextResponse.json({ error: "Game introuvable" }, { status: 404 });

  const now = new Date().toISOString();
  let after: Record<string, unknown> = {};

  if (body.action === "set_vod") {
    const vod = String(body.vod_youtube_id ?? "").trim();
    const off = Number(body.vod_offset_seconds);
    if (!VOD_RE.test(vod)) return NextResponse.json({ error: "Identifiant YouTube invalide (11 caractères)" }, { status: 400 });
    if (!Number.isInteger(off) || off <= 0 || off > 48 * 3600) {
      return NextResponse.json({ error: "Offset invalide : secondes entières > 0 (0 = inconnu, interdit)" }, { status: 400 });
    }
    if (!body.force && game.match_id) {
      const { data: siblings } = await sb
        .from("games")
        .select("id, game_number, vod_offset_seconds")
        .eq("match_id", game.match_id)
        .eq("vod_youtube_id", vod)
        .neq("id", id);
      const clash = (siblings ?? []).find((s) => s.vod_offset_seconds != null && Math.abs(s.vod_offset_seconds - off) < 900);
      if (clash) {
        return NextResponse.json(
          { error: `La G${clash.game_number} du même match est déjà sur cette VOD à ${clash.vod_offset_seconds} s (moins de 15 min d'écart).`, conflict: clash },
          { status: 409 },
        );
      }
    }
    const { data, error: upErr } = await sb
      .from("games")
      .update({ vod_youtube_id: vod, vod_offset_seconds: off })
      .eq("id", id)
      .select("id");
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: "Aucune ligne modifiée" }, { status: 500 });
    after = { vod_youtube_id: vod, vod_offset_seconds: off };
  } else if (["reclip_all", "hide_all", "show_all"].includes(body.action ?? "")) {
    const patch =
      body.action === "reclip_all" ? { needs_reclip: true, reclip_reason: "admin: game recalée", updated_at: now }
      : body.action === "hide_all" ? { kill_visible: false, needs_reclip: true, reclip_reason: "admin: game sur la mauvaise VOD", updated_at: now }
      : { kill_visible: true, updated_at: now };
    let q = sb.from("kills").update(patch).eq("game_id", id).not("clip_url_vertical", "is", null);
    if (body.action === "show_all") q = q.eq("kill_visible", false);
    const { data, error: upErr } = await q.select("id");
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    after = { ...patch, affected: data?.length ?? 0 };
  } else {
    return NextResponse.json({ error: "action ∈ set_vod, reclip_all, hide_all, show_all" }, { status: 400 });
  }

  await logAdminAction({
    action: `game.${body.action}`,
    entityType: "game",
    entityId: id,
    before: { vod_youtube_id: game.vod_youtube_id, vod_offset_seconds: game.vod_offset_seconds },
    after,
    actorRole: deriveActorRole(admin),
    request: req,
  });
  return NextResponse.json({ ok: true, ...after });
}
