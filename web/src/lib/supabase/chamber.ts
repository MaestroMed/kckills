/**
 * La Chambre des Souffrances — data layer.
 *
 * The inverse of the feed : KC's DEATHS — every published, QC-visible clip
 * where the tracked team was the VICTIM (`tracked_team_involvement =
 * 'team_victim'`).
 *
 * Refonte du 29/09/2026 : la descente suit le TYPE de souffrance au lieu
 * d'un classement global (qui ne gardait que des multi-kills : 605 doubles
 * subis suffisaient à remplir tous les cercles, le Seuil commençait déjà par
 * des doubles). Douze morts par cercle, les pires en tête (la première est
 * le « coup de grâce » du cercle) :
 *   I       morts simples les plus spectaculaires
 *   II      premiers sangs encaissés
 *   III-V   doubles subis
 *   VI-IX   triples subis
 *   X       l'Enfer : pentakills et quadras subis
 * Cinq petites requêtes (~130 lignes au total, egress minimal) au lieu de
 * mille lignes pour en garder 240.
 *
 * Server-only, reads anonymously (RLS "Public kills" covers published rows).
 */

import "server-only";
import { cache } from "react";
import { createCachedAnonSupabase, rethrowIfDynamic } from "./server";

export interface ChamberClip {
  id: string;
  killerChampion: string | null;
  victimChampion: string | null;
  victimPlayerId: string | null;
  thumbnailUrl: string | null;
  clipUrl: string | null;
  clipUrlLow: string | null;
  highlightScore: number | null;
  multiKill: string | null;
  isFirstBlood: boolean;
  description: string | null;
  /** Contexte du match : adversaire, étape, date, numéro de game. */
  opponent: string | null;
  stage: string | null;
  playedAt: string | null;
  gameNumber: number | null;
  /** Composite brutality score — orders the clips inside a circle. */
  severity: number;
}

export interface ChamberCircle {
  /** 1 (the threshold) → 10 (l'Enfer). */
  depth: number;
  name: string;
  /** Short French subtitle for the circle card. */
  tagline: string;
  /** Ce qu'on y subit (« Doubles subis »…). */
  kind: string;
  clips: ChamberClip[];
}

/** Circle names, shallow → deepest. Index 0 = depth 1. */
const CIRCLES: readonly { name: string; tagline: string; kind: string }[] = [
  { name: "Le Seuil", tagline: "Là où tout commence à déraper", kind: "Morts isolées" },
  { name: "Le Frisson", tagline: "La première goutte de sueur froide", kind: "Premiers sangs encaissés" },
  { name: "L'Inquiétude", tagline: "Quelque chose ne tourne pas rond", kind: "Doubles subis" },
  { name: "La Pression", tagline: "L'étau se resserre", kind: "Doubles subis" },
  { name: "La Spirale", tagline: "On ne remonte plus la pente", kind: "Doubles subis" },
  { name: "Le Naufrage", tagline: "Le navire prend l'eau de toutes parts", kind: "Triples subis" },
  { name: "La Débâcle", tagline: "Les lignes cèdent une à une", kind: "Triples subis" },
  { name: "Le Massacre", tagline: "Plus rien ne tient debout", kind: "Triples subis" },
  { name: "L'Effondrement", tagline: "Le silence avant la fin", kind: "Triples subis" },
  { name: "L'Enfer", tagline: "Karmine Corp, effacée de la carte", kind: "Pentakill et quadras subis" },
];

const PER_CIRCLE = 12;

function multiWeight(mk: string | null): number {
  switch (mk) {
    case "penta":
      return 1000;
    case "quadra":
      return 600;
    case "triple":
      return 300;
    case "double":
      return 120;
    default:
      return 0;
  }
}

function severityOf(c: { multiKill: string | null; isFirstBlood: boolean; highlightScore: number | null }): number {
  return multiWeight(c.multiKill) + (c.isFirstBlood ? 40 : 0) + (c.highlightScore ?? 0) * 8;
}

const SELECT = `
  id,
  killer_champion,
  victim_champion,
  victim_player_id,
  thumbnail_url,
  clip_url_vertical,
  clip_url_vertical_low,
  highlight_score,
  multi_kill,
  is_first_blood,
  ai_description,
  ai_description_fr,
  games!inner (
    game_number,
    matches!inner (
      scheduled_at,
      stage,
      team_blue:teams!matches_team_blue_id_fkey ( code ),
      team_red:teams!matches_team_red_id_fkey ( code )
    )
  )
`.trim();

const PUBLISHED = "publication_status.eq.published,and(publication_status.is.null,status.eq.published)";

type One<T> = T | T[] | null | undefined;
const one = <T,>(x: One<T>): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

interface RawChamberRow {
  id?: string | null;
  killer_champion?: string | null;
  victim_champion?: string | null;
  victim_player_id?: string | null;
  thumbnail_url?: string | null;
  clip_url_vertical?: string | null;
  clip_url_vertical_low?: string | null;
  highlight_score?: number | null;
  multi_kill?: string | null;
  is_first_blood?: boolean | null;
  ai_description?: string | null;
  ai_description_fr?: string | null;
  games?: One<{
    game_number?: number | null;
    matches?: One<{
      scheduled_at?: string | null;
      stage?: string | null;
      team_blue?: One<{ code?: string | null }>;
      team_red?: One<{ code?: string | null }>;
    }>;
  }>;
}

function normalize(row: RawChamberRow): ChamberClip {
  const multiKill = row.multi_kill ?? null;
  const isFirstBlood = row.is_first_blood ?? false;
  const highlightScore = row.highlight_score ?? null;
  const game = one(row.games);
  const match = one(game?.matches);
  const codes = [one(match?.team_blue)?.code, one(match?.team_red)?.code].filter(Boolean) as string[];
  return {
    id: String(row.id ?? ""),
    killerChampion: row.killer_champion ?? null,
    victimChampion: row.victim_champion ?? null,
    victimPlayerId: row.victim_player_id ?? null,
    thumbnailUrl: row.thumbnail_url ?? null,
    clipUrl: row.clip_url_vertical ?? null,
    clipUrlLow: row.clip_url_vertical_low ?? null,
    highlightScore,
    multiKill,
    isFirstBlood,
    description: row.ai_description_fr ?? row.ai_description ?? null,
    opponent: codes.find((c) => c !== "KC") ?? null,
    stage: match?.stage ?? null,
    playedAt: match?.scheduled_at ?? null,
    gameNumber: game?.game_number ?? null,
    severity: severityOf({ multiKill, isFirstBlood, highlightScore }),
  };
}

/** Load the descent : ten circles of twelve deaths, shallow → deep. */
export const getChamberCircles = cache(async function getChamberCircles(): Promise<ChamberCircle[]> {
  try {
    const supabase = createCachedAnonSupabase();
    const deaths = () =>
      supabase
        .from("kills")
        .select(SELECT)
        .or(PUBLISHED)
        .eq("kill_visible", true)
        .eq("tracked_team_involvement", "team_victim")
        .not("clip_url_vertical", "is", null)
        .not("thumbnail_url", "is", null)
        .order("highlight_score", { ascending: false, nullsFirst: false });

    const [hell, triples, doubles, bloods, singles] = await Promise.all([
      deaths().in("multi_kill", ["penta", "quadra"]).limit(PER_CIRCLE),
      deaths().eq("multi_kill", "triple").limit(PER_CIRCLE * 4),
      deaths().eq("multi_kill", "double").limit(PER_CIRCLE * 3),
      deaths().is("multi_kill", null).eq("is_first_blood", true).limit(PER_CIRCLE),
      deaths().is("multi_kill", null).eq("is_first_blood", false).limit(PER_CIRCLE),
    ]);
    for (const [label, res] of Object.entries({ hell, triples, doubles, bloods, singles })) {
      if (res.error) console.warn(`[chamber] ${label} error:`, res.error.message);
    }

    const rows = (res: { data: unknown[] | null }) =>
      ((res.data ?? []) as RawChamberRow[]).map(normalize).filter((c) => c.id && c.clipUrl);
    const chunks = (list: ChamberClip[], n: number) =>
      Array.from({ length: n }, (_, i) => list.slice(i * PER_CIRCLE, (i + 1) * PER_CIRCLE));

    // Les plus violents au plus profond : dans chaque famille, le haut du
    // classement descend dans le cercle le plus bas.
    const dbl = chunks(rows(doubles), 3).reverse(); // III, IV, V
    const tri = chunks(rows(triples), 4).reverse(); // VI … IX
    const byDepth: ChamberClip[][] = [rows(singles), rows(bloods), ...dbl, ...tri, rows(hell)];

    const circles: ChamberCircle[] = [];
    byDepth.forEach((clips, i) => {
      if (clips.length === 0) return;
      circles.push({
        depth: i + 1,
        ...CIRCLES[i],
        clips: [...clips].sort((a, b) => b.severity - a.severity),
      });
    });
    return circles;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[chamber] getChamberCircles threw:", err);
    return [];
  }
});
