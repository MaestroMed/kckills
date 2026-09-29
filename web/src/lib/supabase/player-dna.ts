/**
 * L'affiche et l'ADN d'un joueur (/player/[slug], refonte du 29/09/2026).
 *
 * Tous ses kills KC publiés (tueur au pseudo identique, casse ignorée : la
 * table players garde des doublons « kyeahoo »/« Kyeahoo »), réduits au
 * strict nécessaire pour dessiner l'ADN — minute de jeu, date du match,
 * type de kill — puis les chiffres de l'affiche et son kill signature (le
 * mieux noté, avec clip). Pagination par 1 000 (plafond PostgREST), ISR.
 */

import "server-only";
import { cache } from "react";
import { createCachedAnonSupabase, rethrowIfDynamic } from "./server";

export interface DnaKill {
  id: string;
  /** Minute de jeu (secondes), null si inconnue. */
  t: number | null;
  /** Date du match (ms epoch), null si inconnue. */
  d: number | null;
  champ: string | null;
  mk: string | null;
  fb: boolean;
}

export interface SignatureKill {
  id: string;
  champion: string | null;
  victim: string | null;
  multiKill: string | null;
  firstBlood: boolean;
  opponent: string | null;
  playedAt: string | null;
  thumbnail: string | null;
}

export interface PlayerDna {
  kills: DnaKill[];
  total: number;
  counts: { penta: number; quadra: number; triple: number; double: number; firstBlood: number };
  topChampion: { name: string; kills: number } | null;
  first: string | null;
  last: string | null;
  signature: SignatureKill | null;
}

const PUBLISHED = "publication_status.eq.published,and(publication_status.is.null,status.eq.published)";

type One<T> = T | T[] | null | undefined;
const one = <T,>(x: One<T>): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

interface Row {
  id: string;
  killer_champion: string | null;
  game_time_seconds: number | null;
  multi_kill: string | null;
  is_first_blood: boolean | null;
  games: One<{ matches: One<{ scheduled_at: string | null }> }>;
}

export const getPlayerDna = cache(async function getPlayerDna(ign: string): Promise<PlayerDna | null> {
  try {
    const sb = createCachedAnonSupabase(1800);
    // select() d'abord : les filtres n'existent que sur le constructeur filtré.
    const base = (cols: string) =>
      sb
        .from("kills")
        .select(cols)
        .or(PUBLISHED)
        .eq("tracked_team_involvement", "team_killer")
        .not("kill_visible", "is", false)
        .ilike("killer.ign", ign);

    const rows: Row[] = [];
    for (let page = 0; page < 4; page++) {
      const { data, error } = await base(
        "id, killer_champion, game_time_seconds, multi_kill, is_first_blood, killer:players!kills_killer_player_id_fkey!inner(ign), games!inner(matches!inner(scheduled_at))",
      )
        .order("id")
        .range(page * 1000, page * 1000 + 999);
      if (error) {
        console.warn("[player-dna]", error.message);
        break;
      }
      rows.push(...((data ?? []) as unknown as Row[]));
      if (!data || data.length < 1000) break;
    }
    if (rows.length === 0) return null;

    const counts = { penta: 0, quadra: 0, triple: 0, double: 0, firstBlood: 0 };
    const perChamp = new Map<string, number>();
    let first: number | null = null;
    let last: number | null = null;
    const kills: DnaKill[] = rows.map((r) => {
      const at = one(one(r.games)?.matches)?.scheduled_at;
      const d = at ? Date.parse(at) : NaN;
      if (Number.isFinite(d)) {
        first = first === null ? d : Math.min(first, d);
        last = last === null ? d : Math.max(last, d);
      }
      if (r.multi_kill && r.multi_kill in counts) counts[r.multi_kill as keyof typeof counts] += 1;
      if (r.is_first_blood) counts.firstBlood += 1;
      if (r.killer_champion) perChamp.set(r.killer_champion, (perChamp.get(r.killer_champion) ?? 0) + 1);
      return {
        id: r.id,
        t: r.game_time_seconds,
        d: Number.isFinite(d) ? d : null,
        champ: r.killer_champion,
        mk: r.multi_kill,
        fb: !!r.is_first_blood,
      };
    });
    const top = [...perChamp.entries()].sort((a, b) => b[1] - a[1])[0];

    // Le kill signature : le mieux noté qui a un clip.
    let signature: SignatureKill | null = null;
    const { data: sig } = await base(
      "id, killer_champion, victim_champion, multi_kill, is_first_blood, thumbnail_url, killer:players!kills_killer_player_id_fkey!inner(ign), games!inner(matches!inner(scheduled_at, team_blue:teams!matches_team_blue_id_fkey(code), team_red:teams!matches_team_red_id_fkey(code)))",
    )
      .not("clip_url_vertical", "is", null)
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .limit(1);
    const s = (sig?.[0] ?? null) as unknown as {
      id: string;
      killer_champion: string | null;
      victim_champion: string | null;
      multi_kill: string | null;
      is_first_blood: boolean | null;
      thumbnail_url: string | null;
      games: One<{ matches: One<{ scheduled_at: string | null; team_blue: One<{ code: string }>; team_red: One<{ code: string }> }> }>;
    } | null;
    if (s) {
      const m = one(one(s.games)?.matches);
      const codes = [one(m?.team_blue)?.code, one(m?.team_red)?.code].filter(Boolean) as string[];
      signature = {
        id: s.id,
        champion: s.killer_champion,
        victim: s.victim_champion,
        multiKill: s.multi_kill,
        firstBlood: !!s.is_first_blood,
        opponent: codes.find((c) => c !== "KC") ?? null,
        playedAt: m?.scheduled_at ?? null,
        thumbnail: s.thumbnail_url,
      };
    }

    const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
    return {
      kills,
      total: kills.length,
      counts,
      topChampion: top ? { name: top[0], kills: top[1] } : null,
      first: iso(first),
      last: iso(last),
      signature,
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[player-dna] threw:", err);
    return null;
  }
});
