import { createAnonSupabase } from "@/lib/supabase/server";
import { fetchNextKcMatch } from "@/lib/next-match-server";
import { WEATHER, forcedWeather, type Mood, type MoodWeather } from "./presets";

/**
 * Météo du site d'après la forme de la KC.
 *
 * Moral (-1..1) : moyenne des dernières séries, pondérées par leur âge
 * (demi-vie 7 jours) et leur enjeu (playoffs : une défaite y pèse plus
 * lourd qu'une victoire), plus quelques événements datés que les données ne
 * savent pas lire seules (une qualification aux Worlds après une défaite).
 * Divisé par max(somme des poids, 1) : sans match récent, le moral revient
 * au neutre.
 *
 * Tension (0..1) : approche du prochain match (72 h → 1 au coup d'envoi) ;
 * elle fait lever le vent. Match en cours → temps « électrique ».
 */

const DAY = 86_400_000;
const HALF_LIFE_DAYS = 7;

/**
 * Événements datés (à tenir à jour comme lib/eras.ts). `impact` en
 * « victoires » : 2,5 = pèse comme deux victoires et demie du même jour.
 */
const EVENTS: { date: string; impact: number; label: string }[] = [
  // 19/09/2026, Nice : défaite 0-3 contre MKOI mais 3e place, première
  // qualification aux Worlds de l'histoire du club (lib/eras.ts).
  { date: "2026-09-19", impact: 2.5, label: "qualifiés pour les Worlds" },
];

interface Series {
  at: number;
  kcWon: boolean;
  kcScore: number;
  oppScore: number;
  stage: string;
  opp: string;
}

/** Séries récentes de la KC, ou null si la base ne répond pas. */
async function recentSeries(now: number): Promise<Series[] | null> {
  const sb = createAnonSupabase();
  const { data: team, error: teamErr } = await sb.from("teams").select("id").eq("is_tracked", true).limit(1).maybeSingle();
  const teamId = team?.id as string | undefined;
  if (teamErr || !teamId) return null;
  const since = new Date(now - 90 * DAY).toISOString();
  const { data: matches, error } = await sb
    .from("matches")
    .select("id, external_id, scheduled_at, stage, team_blue_id, team_red_id, winner_team_id")
    .or(`team_blue_id.eq.${teamId},team_red_id.eq.${teamId}`)
    .eq("state", "completed")
    // séries officielles seulement (les lignes gol.gg doublonnent des games)
    .not("external_id", "like", "golgg_%")
    .gte("scheduled_at", since)
    .order("scheduled_at", { ascending: false })
    .limit(20);
  if (error) return null;
  const rows = matches ?? [];
  if (rows.length === 0) return [];
  const { data: games, error: gamesErr } = await sb
    .from("games")
    .select("match_id, winner_team_id")
    .in("match_id", rows.map((m) => m.id));
  if (gamesErr) return null;
  const oppIds = [...new Set(rows.map((m) => (m.team_blue_id === teamId ? m.team_red_id : m.team_blue_id)).filter(Boolean))];
  const { data: teams } = await sb.from("teams").select("id, code").in("id", oppIds as string[]);
  const code = new Map((teams ?? []).map((t) => [t.id as string, t.code as string]));
  const out: Series[] = [];
  for (const m of rows) {
    const opp = m.team_blue_id === teamId ? m.team_red_id : m.team_blue_id;
    let kc = 0;
    let op = 0;
    for (const g of games ?? []) {
      if (g.match_id !== m.id) continue;
      if (g.winner_team_id === teamId) kc++;
      else if (g.winner_team_id === opp) op++;
    }
    if (kc + op === 0) continue;
    out.push({
      at: Date.parse(m.scheduled_at as string),
      kcWon: m.winner_team_id ? m.winner_team_id === teamId : kc > op,
      kcScore: kc,
      oppScore: op,
      stage: (m.stage as string | null) ?? "",
      opp: code.get(opp as string) ?? "?",
    });
  }
  return out;
}

function ago(ms: number): string {
  const d = Math.floor(ms / DAY);
  if (d <= 0) return "aujourd'hui";
  if (d === 1) return "hier";
  return `il y a ${d} j`;
}

function until(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return "dans moins d'une heure";
  if (h < 24) return `dans ${Math.round(h)} h`;
  return `dans ${Math.round(h / 24)} j`;
}

export async function getMoodWeather(now: number = Date.now()): Promise<MoodWeather> {
  const [series, next] = await Promise.all([
    recentSeries(now).catch(() => null),
    fetchNextKcMatch(now).catch(() => null),
  ]);
  // Sans les résultats, on ne devine pas : temps neutre (les événements
  // seuls feraient croire à la gloire).
  if (!series) return { ...forcedWeather("variable"), reason: "Forme de la KC indisponible" };

  // ── moral ──
  let sum = 0;
  let wsum = 0;
  for (const s of series) {
    const w = 0.5 ** ((now - s.at) / DAY / HALF_LIFE_DAYS);
    const playoffs = /play|final|round|semi|quarter|knockout|tiebreak|bracket/i.test(s.stage);
    let r = s.kcWon ? 1 : -1;
    if (playoffs) r *= s.kcWon ? 1.3 : 1.95; // une défaite en playoffs coûte cher
    if (s.kcScore + s.oppScore >= 2 && (s.kcScore === 0 || s.oppScore === 0)) r *= 1.15; // 2-0, 3-0
    sum += w * r;
    wsum += w;
  }
  const recentEvents = EVENTS.filter((e) => now - Date.parse(e.date) < 30 * DAY && Date.parse(e.date) <= now);
  for (const e of recentEvents) {
    const w = 0.5 ** ((now - Date.parse(e.date)) / DAY / HALF_LIFE_DAYS);
    sum += w * e.impact;
    wsum += w;
  }
  const morale = Math.max(-1, Math.min(1, sum / Math.max(wsum, 1)));

  // ── tension / direct ──
  const kickoff = next ? Date.parse(next.kickoffISO) : NaN;
  const live = Boolean(next?.isLive);
  const tension = live ? 1 : Number.isFinite(kickoff) ? Math.max(0, Math.min(1, 1 - (kickoff - now) / (72 * 3_600_000))) : 0;

  let mood: Mood;
  if (live) mood = "electrique";
  else if (morale > 0.55) mood = "gloire";
  else if (morale > 0.2) mood = "beau";
  else if (morale > -0.2) mood = "variable";
  else if (morale > -0.55) mood = "gris";
  else mood = "tempete";

  const base = WEATHER[mood];
  // Le vent se lève à l'approche du match.
  const wind = +(base.wind * (1 + 0.25 * tension)).toFixed(2);
  const gustAmp = +(base.gustAmp * (1 + 0.3 * tension)).toFixed(2);

  const parts: string[] = [];
  const last = series[0];
  if (last) {
    parts.push(`${last.kcWon ? "Victoire" : "Défaite"} ${last.kcScore}-${last.oppScore} contre ${last.opp} ${ago(now - last.at)}`);
  }
  for (const e of recentEvents) parts.push(e.label.charAt(0).toUpperCase() + e.label.slice(1));
  if (live) parts.push("KC en direct");
  else if (next && Number.isFinite(kickoff)) parts.push(`${next.league} ${until(kickoff - now)}`);

  return {
    ...base,
    wind,
    gustAmp,
    mood,
    morale: +morale.toFixed(2),
    tension: +tension.toFixed(2),
    reason: parts.join(" · ") || "Pas de match récent",
  };
}
