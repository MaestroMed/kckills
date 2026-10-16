import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { adminRouteDb } from "@/lib/admin/db";
import { deriveActorRole, logAdminAction } from "@/lib/admin/audit";
import { writeConfig } from "@/lib/admin/config-store";
import { findHomeTheme } from "@/lib/home-themes";
import { getHomeThemeSetting, type HomeThemeSetting } from "@/lib/home-theme-settings";

/**
 * POST /api/admin/home-theme  { forceId: string | null, until?: ISO | null }
 * Force un thème d'accueil (ou revient à l'automatique avec null) et
 * régénère l'accueil tout de suite.
 */
export async function POST(req: NextRequest) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const body = (await req.json().catch(() => ({}))) as { forceId?: string | null; until?: string | null };
  const forceId = body.forceId ?? null;
  if (forceId && !findHomeTheme(forceId)) return NextResponse.json({ error: `Thème inconnu : ${forceId}` }, { status: 400 });
  const until = body.until ? new Date(body.until) : null;
  if (until && Number.isNaN(until.getTime())) return NextResponse.json({ error: "Date de fin invalide" }, { status: 400 });

  const before = await getHomeThemeSetting();
  const next: HomeThemeSetting = { forceId, until: until?.toISOString() ?? null, setAt: new Date().toISOString() };
  try {
    await writeConfig("home-theme", next);
  } catch (err) {
    return NextResponse.json({ error: `Enregistrement impossible : ${(err as Error).message}` }, { status: 502 });
  }
  revalidatePath("/");
  revalidatePath("/themes");

  await logAdminAction({
    action: "home_theme.set",
    entityType: "home_theme",
    entityId: forceId ?? "auto",
    before,
    after: next,
    actorRole: deriveActorRole(g.admin),
    request: req,
  });
  return NextResponse.json({ ok: true, ...next });
}
