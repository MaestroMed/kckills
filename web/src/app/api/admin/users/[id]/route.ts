import { NextRequest, NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";
import { deriveActorRole, logAdminAction } from "@/lib/admin/audit";

/**
 * Demandes RGPD reçues hors du site (Discord, e-mail) :
 *
 * GET    /api/admin/users/[id]  export JSON des données de l'utilisateur
 *                               (même contenu que GET /api/me)
 * DELETE /api/admin/users/[id]  effacement complet (art. 17), même méthode
 *                               que DELETE /api/me : contenu des commentaires
 *                               vidé, puis suppression de auth.users, qui
 *                               cascade sur profils, notes, likes, favoris,
 *                               abonnements push. Corps : { confirm: "<pseudo>" }.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });
  const [profile, ratings, comments] = await Promise.all([
    g.sb
      .from("profiles")
      .select("id, discord_username, discord_avatar_url, riot_summoner_name, riot_tag, riot_rank, riot_top_champions, riot_linked_at, total_ratings, total_comments, badges, created_at, last_seen_at")
      .eq("id", id)
      .maybeSingle(),
    g.sb.from("ratings").select("kill_id, score, created_at").eq("user_id", id),
    g.sb.from("comments").select("id, kill_id, content, created_at").eq("user_id", id).eq("is_deleted", false),
  ]);
  if (!profile.data) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  return new NextResponse(
    JSON.stringify({ exported_at: new Date().toISOString(), user_id: id, profile: profile.data, ratings: ratings.data ?? [], comments: comments.data ?? [] }, null, 2),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="kckills-export-${id.slice(0, 8)}.json"`,
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { confirm?: string };

  const { data: profile } = await g.sb.from("profiles").select("id, discord_username").eq("id", id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  const expected = profile.discord_username ?? id.slice(0, 8);
  if (body.confirm !== expected) {
    return NextResponse.json({ error: `Pour confirmer, recopie exactement : ${expected}` }, { status: 400 });
  }

  await g.sb.from("comments").update({ is_deleted: true, content: "[supprime]" }).eq("user_id", id);
  const { error } = await g.sb.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: `Effacement impossible : ${error.message}` }, { status: 500 });

  // Le journal ne garde ni le pseudo ni l'identifiant Discord : seulement
  // le fait qu'un compte a été effacé, et quand.
  await logAdminAction({
    action: "user.erase",
    entityType: "user",
    entityId: id,
    notes: "Effacement RGPD (art. 17) depuis l'admin",
    actorRole: deriveActorRole(g.admin),
    request: req,
  });
  return NextResponse.json({ ok: true });
}
