/**
 * GET /api/teams — public catalog of pro LoL teams.
 *
 * Powers <TeamSelector /> (combobox / bottom-sheet) and the team picker
 * inside <LeagueNav />. The route is env-gated to preserve the KC pilot's
 * byte-identical UI :
 *
 *   * `NEXT_PUBLIC_LOLTOK_PUBLIC=false` (default) → only `is_tracked`
 *     teams (today's pilot data: KC, KCB, plus any tracked rivals) are
 *     surfaced. The selector still works but it's KC-flavoured.
 *   * `NEXT_PUBLIC_LOLTOK_PUBLIC=true` → every team in the catalog is
 *     surfaced. This is the LoLTok rewrite path.
 *
 * Edge runtime — no Node-only deps, the loader uses the lightweight
 * supabase-js anon client. Five-minute SWR cache keeps the response
 * cheap (the table changes weekly at most when a new team is signed).
 */

import { NextResponse } from "next/server";
import {
  getTeams,
  filterTeamsForPublic,
  isLoltokPublic,
} from "@/lib/teams-loader";

export const runtime = "edge";
export const revalidate = 300;

/** Wire shape — narrower than TeamRow so future internal fields can be
 *  added to the loader without leaking. */
interface WireTeam {
  slug: string;
  code: string;
  name: string;
  region: string | null;
  league: string | null;
  logo_url: string | null;
}

export async function GET() {
  const all = await getTeams();
  const visible = filterTeamsForPublic(all);

  const payload: WireTeam[] = visible.map((t) => ({
    slug: t.slug,
    code: t.code,
    name: t.name,
    region: t.region,
    league: t.league,
    logo_url: t.logo_url,
  }));

  return NextResponse.json(
    { teams: payload, count: payload.length, mode: isLoltokPublic() ? "loltok" : "kc_pilot" },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
