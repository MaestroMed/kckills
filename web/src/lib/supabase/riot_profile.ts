/**
 * Server-side helper: fetch the Riot link slice of a profile by summoner
 * name. Used by /player/[slug] to surface a "Riot stats" sidebar when a
 * KC player has linked their Riot account on kckills.
 *
 * Lookup is case-insensitive on `riot_summoner_name`. We deliberately
 * DON'T expose the `riot_puuid_hash` to the response shape — it's only
 * useful for backend dedupe and we want callers to forget it exists.
 */

import "server-only";
import { createServerSupabase, rethrowIfDynamic } from "./server";

export interface PublicRiotStats {
  summonerName: string;
  tag: string | null;
  rank: string | null;
  topChampions: Array<{
    champ_id: number;
    name: string;
    level: number;
    points: number;
  }>;
  linkedAt: string | null;
}

interface RawProfile {
  riot_summoner_name?: string | null;
  riot_tag?: string | null;
  riot_rank?: string | null;
  riot_top_champions?: unknown;
  riot_linked_at?: string | null;
}

function normalizeChampions(
  raw: unknown,
): PublicRiotStats["topChampions"] {
  if (!Array.isArray(raw)) return [];
  const out: PublicRiotStats["topChampions"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const champId = typeof c.champ_id === "number" ? c.champ_id : null;
    const name = typeof c.name === "string" ? c.name : null;
    const level = typeof c.level === "number" ? c.level : null;
    const points = typeof c.points === "number" ? c.points : null;
    if (champId == null || !name || level == null || points == null) continue;
    out.push({ champ_id: champId, name, level, points });
  }
  return out;
}

export async function getPublicRiotStatsBySummoner(
  summonerName: string,
): Promise<PublicRiotStats | null> {
  if (!summonerName || summonerName.trim().length === 0) return null;
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "riot_summoner_name, riot_tag, riot_rank, riot_top_champions, riot_linked_at",
      )
      .ilike("riot_summoner_name", summonerName)
      .not("riot_linked_at", "is", null)
      .limit(1);
    if (error) {
      console.warn(
        "[supabase/riot_profile] getPublicRiotStatsBySummoner error:",
        error.message,
      );
      return null;
    }
    const row = ((data ?? []) as RawProfile[])[0];
    if (!row || !row.riot_summoner_name) return null;
    return {
      summonerName: row.riot_summoner_name,
      tag: row.riot_tag ?? null,
      rank: row.riot_rank ?? null,
      topChampions: normalizeChampions(row.riot_top_champions),
      linkedAt: row.riot_linked_at ?? null,
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn(
      "[supabase/riot_profile] getPublicRiotStatsBySummoner threw:",
      err,
    );
    return null;
  }
}
