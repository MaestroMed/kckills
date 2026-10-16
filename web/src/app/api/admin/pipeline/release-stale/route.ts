import { NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";
import { deriveActorRole, logAdminAction } from "@/lib/admin/audit";

/**
 * POST /api/admin/pipeline/release-stale
 *
 * Remet en attente les jobs `claimed` dont le bail (locked_until) a expiré :
 * un worker arrêté net (« stop tout », crash) laisse ses jobs réservés et
 * personne ne les reprend avant l'expiration côté file. Sans effet sur un
 * job dont le bail court encore.
 */
export async function POST(req: Request) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;

  const now = new Date().toISOString();
  const { data, error } = await g.sb
    .from("pipeline_jobs")
    .update({ status: "pending", locked_by: null, locked_until: null, claimed_at: null, updated_at: now })
    .eq("status", "claimed")
    .lt("locked_until", now)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const released = data?.length ?? 0;
  await logAdminAction({
    action: "pipeline.release_stale",
    entityType: "pipeline_job",
    after: { released },
    actorRole: deriveActorRole(g.admin),
    request: req,
  });
  return NextResponse.json({ ok: true, released });
}
