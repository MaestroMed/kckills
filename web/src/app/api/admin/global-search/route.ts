import { NextRequest, NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";
import { runGlobalSearch, type SearchType } from "@/lib/admin/global-search";

export type {
  GlobalSearchKill,
  GlobalSearchMatch,
  GlobalSearchJob,
  GlobalSearchUser,
  GlobalSearchResponse,
} from "@/lib/admin/global-search";

/**
 * GET /api/admin/global-search?q=…&types=kills,matches,jobs,users
 *
 * Backend de la recherche de la barre du haut. La logique vit dans
 * lib/admin/global-search (partagée avec la page /admin/search, qui
 * l'appelle directement au lieu de se refaire une requête HTTP).
 */
export const dynamic = "force-dynamic";

const TYPES: SearchType[] = ["kills", "matches", "jobs", "users"];

export async function GET(req: NextRequest) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
  }
  if (q.length > 100) {
    return NextResponse.json({ error: "Query too long" }, { status: 400 });
  }
  const wanted = (sp.get("types") ?? TYPES.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SearchType => (TYPES as string[]).includes(s));

  const body = await runGlobalSearch(g.sb, q, wanted);
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, max-age=30, must-revalidate" },
  });
}
