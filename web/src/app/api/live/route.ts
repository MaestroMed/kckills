import { NextResponse } from "next/server";

/**
 * GET /api/live — Server-side proxy to LolEsports `getLive` for the
 * KCKILLS LiveBanner.
 *
 * Why this exists (replaced a direct browser-side call):
 *   1. SECURITY: the LolEsports API key was previously baked into the
 *      client bundle. Any visitor opening DevTools could read it.
 *      Routing through this endpoint moves the key to env-var only.
 *   2. SCALING: at N visitors the direct path = N polls / 2min into
 *      LolEsports. With CDN cache (s-maxage=60) this becomes ~1
 *      poll / minute per region, regardless of traffic.
 *   3. RESILIENCE: server-side fetch can fail / retry without leaking
 *      the failure into client console. Returns a stable shape
 *      `{ isLive, opponent }` even on upstream errors.
 *
 * Response shape:
 *   { isLive: boolean, opponent: string | null }
 *
 * Cache headers tuned for the use case: 60s edge cache + 30s SWR. A
 * KC match never goes from "not live" to "live" in under 60s of human
 * notice anyway, and the SWR window keeps the banner snappy when
 * cache rotates.
 */

const LOL_ESPORTS_KEY = process.env.LOL_ESPORTS_API_KEY ?? "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z";
const LOL_ESPORTS_URL = "https://esports-api.lolesports.com/persisted/gw/getLive?hl=en-US";

interface LolEsportsTeam {
  code: string;
  name?: string;
}

interface LolEsportsEvent {
  state: string;
  match?: { teams?: LolEsportsTeam[] };
}

interface LolEsportsResponse {
  data?: { schedule?: { events?: LolEsportsEvent[] } };
}

export const revalidate = 60;

export async function GET() {
  try {
    const res = await fetch(LOL_ESPORTS_URL, {
      headers: { "x-api-key": LOL_ESPORTS_KEY },
      // Server-side fetch with explicit timeout so a hanging upstream
      // can't pile up requests forever. AbortSignal.timeout is supported
      // in all modern Node runtimes Vercel uses.
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { isLive: false, opponent: null },
        { headers: cacheHeaders(30) }, // shorter TTL on upstream error
      );
    }
    const data = (await res.json()) as LolEsportsResponse;
    const events = data.data?.schedule?.events ?? [];
    for (const event of events) {
      const teams = event.match?.teams ?? [];
      const kcOnSide = teams.some((t) => t.code === "KC");
      if (kcOnSide && event.state === "inProgress") {
        const opp = teams.find((t) => t.code !== "KC");
        // Pull additional info: scores + first available stream URL
        const kcTeam = teams.find((t) => t.code === "KC") as (LolEsportsTeam & { result?: { gameWins?: number } }) | undefined;
        const oppTeam = opp as (LolEsportsTeam & { result?: { gameWins?: number } }) | undefined;
        const eventFull = event as LolEsportsEvent & {
          streams?: Array<{ provider?: string; parameter?: string; locale?: string }>;
          blockName?: string;
          match?: { id?: string; teams?: LolEsportsTeam[]; strategy?: { type?: string; count?: number } };
        };
        const stream = eventFull.streams?.find((s) => s.locale === "fr-FR")
          ?? eventFull.streams?.find((s) => s.provider === "twitch")
          ?? eventFull.streams?.[0];
        const streamUrl = stream
          ? stream.provider === "twitch"
            ? `https://twitch.tv/${stream.parameter}`
            : stream.provider === "youtube"
              ? `https://youtube.com/watch?v=${stream.parameter}`
              : null
          : null;
        return NextResponse.json(
          {
            isLive: true,
            opponent: opp?.code ?? null,
            opponentName: opp?.name ?? null,
            kcScore: kcTeam?.result?.gameWins ?? 0,
            oppScore: oppTeam?.result?.gameWins ?? 0,
            block: eventFull.blockName ?? null,
            format: eventFull.match?.strategy ? `BO${eventFull.match.strategy.count}` : null,
            streamUrl,
            matchId: eventFull.match?.id ?? null,
          },
          { headers: cacheHeaders(60) },
        );
      }
    }
    return NextResponse.json(
      { isLive: false, opponent: null },
      { headers: cacheHeaders(60) },
    );
  } catch {
    // Upstream timeout / network error / parse error — degrade to "not live".
    return NextResponse.json(
      { isLive: false, opponent: null },
      { headers: cacheHeaders(30) },
    );
  }
}

function cacheHeaders(maxAge: number): Record<string, string> {
  return {
    "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=30`,
  };
}
