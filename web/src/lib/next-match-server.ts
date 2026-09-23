import "server-only";

/**
 * Prochain match de la Karmine Corp, lu dans le calendrier LoL Esports.
 *
 * Toutes les ligues où KC peut jouer (LEC, Worlds, MSI, First Stand) sont
 * interrogées en parallèle : avant, seule la LEC l'était, et les Worlds 2026
 * (play-ins du 15 au 18 octobre) n'auraient jamais été annoncées. Cache
 * Next de 5 min par ligue ; une ligue en panne n'empêche pas les autres.
 */

const API_KEY = process.env.LOL_ESPORTS_API_KEY ?? "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z";
const API = "https://esports-api.lolesports.com/persisted/gw";

const LEAGUES = [
  { id: "98767991302996019", name: "LEC" },
  { id: "98767975604431411", name: "Worlds" },
  { id: "98767991325878492", name: "MSI" },
  { id: "113464388705111224", name: "First Stand" },
];

interface ScheduleEvent {
  startTime: string;
  state: string;
  blockName?: string;
  match?: {
    id?: string;
    teams?: Array<{ code?: string; name?: string }>;
    strategy?: { type?: string; count?: number };
  };
  league?: { name?: string };
}

export interface LiveNextMatch {
  kickoffISO: string;
  kickoffMs: number;
  msUntil: number;
  format: string;
  opponentCode: string;
  opponentName: string;
  stage: string;
  league: string;
  isLive: boolean;
}

async function leagueEvents(leagueId: string): Promise<ScheduleEvent[]> {
  try {
    const r = await fetch(`${API}/getSchedule?hl=fr-FR&leagueId=${leagueId}`, {
      headers: { "x-api-key": API_KEY },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 300 },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data?.data?.schedule?.events ?? []) as ScheduleEvent[];
  } catch {
    return [];
  }
}

export async function fetchNextKcMatch(now: number = Date.now()): Promise<LiveNextMatch | null> {
  const perLeague = await Promise.all(
    LEAGUES.map(async (l) => (await leagueEvents(l.id)).map((ev) => ({ ev, league: l.name }))),
  );
  const candidates = perLeague
    .flat()
    .filter(({ ev }) => {
      if (ev.state !== "unstarted" && ev.state !== "inProgress") return false;
      // Audit 2.0 : sans borne, un match fini restait « le prochain » et le
      // hero affichait EN DIRECT des heures après. Rien de commencé il y a
      // plus de 4 h.
      const started = Date.parse(ev.startTime);
      if (Number.isFinite(started) && started < now - 4 * 3600 * 1000) return false;
      return (ev.match?.teams ?? []).some((t) => t?.code === "KC");
    })
    .sort((a, b) => Date.parse(a.ev.startTime) - Date.parse(b.ev.startTime));
  const hit = candidates[0];
  if (!hit) return null;
  const { ev, league } = hit;
  const opponent = (ev.match?.teams ?? []).find((t) => t?.code !== "KC");
  const fmt = ev.match?.strategy;
  const kickoff = Date.parse(ev.startTime);
  return {
    kickoffISO: ev.startTime,
    kickoffMs: kickoff,
    msUntil: kickoff - now,
    format: fmt?.type === "bestOf" ? `bo${fmt.count}` : "bo1",
    opponentCode: opponent?.code ?? "?",
    opponentName: opponent?.name ?? "?",
    stage: ev.blockName ? `${ev.league?.name ?? league} · ${ev.blockName}` : (ev.league?.name ?? league),
    league: ev.league?.name ?? league,
    isLive: ev.state === "inProgress",
  };
}
