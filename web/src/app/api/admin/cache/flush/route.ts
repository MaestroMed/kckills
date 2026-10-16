import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { adminRouteDb } from "@/lib/admin/db";
import { deriveActorRole, logAdminAction } from "@/lib/admin/audit";

/**
 * POST /api/admin/cache/flush — invalide le cache de données et d'ISR de
 * tout le site : chaque page se régénère à sa prochaine visite. À utiliser
 * après une correction de données faite hors de l'admin (script worker).
 */
export async function POST(req: Request) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  revalidatePath("/", "layout");
  await logAdminAction({
    action: "cache.flush",
    entityType: "site",
    actorRole: deriveActorRole(g.admin),
    request: req,
  });
  return NextResponse.json({ ok: true });
}
