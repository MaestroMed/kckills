/**
 * La Chambre des Souffrances — data layer.
 *
 * The inverse of the feed : instead of KC's best kills, this loads KC's
 * worst DEATHS — every clip where the tracked team was the VICTIM
 * (`tracked_team_involvement = 'team_victim'`), published + clipped. It
 * scores each death by how brutal it was and buckets the worst ~150 into
 * 10 "circles" of increasing severity (circle 1 = a bad moment, circle 10
 * = getting penta'd). The route /chambre renders the descent.
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
  /** Composite brutality score — drives circle placement. */
  severity: number;
}

export interface ChamberCircle {
  /** 1 (the threshold) → 10 (l'Enfer, pentas subis). */
  depth: number;
  name: string;
  /** Short French subtitle for the circle card. */
  tagline: string;
  clips: ChamberClip[];
}

/** Circle names, shallow → deepest. Index 0 = depth 1. */
const CIRCLE_NAMES: readonly [string, string][] = [
  ["Le Seuil", "Là où tout commence à déraper"],
  ["Le Frisson", "La première goutte de sueur froide"],
  ["L'Inquiétude", "Quelque chose ne tourne pas rond"],
  ["La Pression", "L'étau se resserre"],
  ["La Spirale", "On ne remonte plus la pente"],
  ["Le Naufrage", "Le navire prend l'eau de toutes parts"],
  ["La Débâcle", "Les lignes cèdent une à une"],
  ["Le Massacre", "Plus rien ne tient debout"],
  ["L'Effondrement", "Le silence avant la fin"],
  ["L'Enfer", "Karmine Corp, effacée de la carte"],
];

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

function severityOf(c: {
  multiKill: string | null;
  isFirstBlood: boolean;
  highlightScore: number | null;
}): number {
  return (
    multiWeight(c.multiKill) +
    (c.isFirstBlood ? 40 : 0) +
    (c.highlightScore ?? 0) * 8
  );
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
  ai_description_fr
`.trim();

const PUBLISHED =
  "publication_status.eq.published,and(publication_status.is.null,status.eq.published)";

/** How many of the worst deaths make it into the descent (10 circles). */
const TOTAL = 150;
const CIRCLES = 10;

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
}

function normalize(row: RawChamberRow): ChamberClip {
  const multiKill = row.multi_kill ?? null;
  const isFirstBlood = row.is_first_blood ?? false;
  const highlightScore = row.highlight_score ?? null;
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
    severity: severityOf({ multiKill, isFirstBlood, highlightScore }),
  };
}

/**
 * Load the descent : the worst ~150 KC deaths, bucketed into 10 circles of
 * increasing severity. Two passes so the rare multi-kills (penta/quadra) are
 * always present regardless of their AI highlight score, then merged with the
 * highest-scored singles to fill the shallow circles.
 */
export const getChamberCircles = cache(async function getChamberCircles(): Promise<
  ChamberCircle[]
> {
  try {
    const supabase = createCachedAnonSupabase();

    const victimBase = () =>
      supabase
        .from("kills")
        .select(SELECT)
        .or(PUBLISHED)
        .eq("kill_visible", true)
        .eq("tracked_team_involvement", "team_victim")
        .not("clip_url_vertical", "is", null)
        .not("thumbnail_url", "is", null);

    const [multisRes, topRes] = await Promise.all([
      // Every multi-kill suffered — the core of the suffering.
      victimBase()
        .or("multi_kill.eq.penta,multi_kill.eq.quadra,multi_kill.eq.triple,multi_kill.eq.double")
        .limit(200),
      // The most spectacular single deaths to fill the shallow circles.
      victimBase()
        .order("highlight_score", { ascending: false, nullsFirst: false })
        .limit(200),
    ]);

    if (multisRes.error) {
      console.warn("[chamber] multis error:", multisRes.error.message);
    }
    if (topRes.error) {
      console.warn("[chamber] top error:", topRes.error.message);
    }

    // Merge + dedupe by id.
    const byId = new Map<string, ChamberClip>();
    for (const row of [...(multisRes.data ?? []), ...(topRes.data ?? [])]) {
      const clip = normalize(row as RawChamberRow);
      if (clip.id && clip.clipUrl) byId.set(clip.id, clip);
    }

    const sorted = [...byId.values()].sort((a, b) => b.severity - a.severity);
    const worst = sorted.slice(0, TOTAL);
    if (worst.length === 0) return [];

    // Chunk the severity-sorted list into 10 groups. Group 0 (the worst) is
    // the deepest circle (depth 10) ; the least-severe group is depth 1.
    const per = Math.ceil(worst.length / CIRCLES);
    const circles: ChamberCircle[] = [];
    for (let i = 0; i < CIRCLES; i++) {
      const group = worst.slice(i * per, (i + 1) * per);
      if (group.length === 0) continue;
      const depth = CIRCLES - i; // group 0 → depth 10
      const [name, tagline] = CIRCLE_NAMES[depth - 1];
      circles.push({ depth, name, tagline, clips: group });
    }
    // Return shallow → deep (depth 1 first) so the page renders the descent
    // top-to-bottom.
    return circles.sort((a, b) => a.depth - b.depth);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[chamber] getChamberCircles threw:", err);
    return [];
  }
});
