/**
 * similar-kills-cached.ts — Wave 35 #3 (2026-05-28)
 *
 * Cached wrapper around fn_similar_kills RPC. The base query was the
 * #3 consumer of Supabase compute (~16% of total) because it runs an
 * HNSW vector search on every /kill/[id] page render.
 *
 * Caching strategy :
 *   * unstable_cache keyed by killId — cross-request cache hit means
 *     subsequent visits to the same /kill/[id] reuse the result.
 *   * 1-hour TTL — embeddings are stable (a clip's embedding doesn't
 *     change once computed by worker/modules/embedder.py) and the
 *     similar list only shifts when a new neighbor gets published.
 *   * Uses createAnonSupabase (no cookies) so the cache key stays
 *     stable across visitors. RLS still applies (Public kills policy).
 *   * Tag-based invalidation : revalidateTag('similar-kills') if we
 *     ever need to flush (e.g. after a massive backfill).
 *
 * Returns the carousel-ready shape with explicit `null`s for missing
 * fields — same as the previous inline fetcher in SimilarClipsCarousel.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { createAnonSupabase } from "./server";

export interface SimilarKill {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  thumbnail_url: string | null;
  highlight_score: number | null;
  ai_description_preview: string | null;
  similarity: number;
}

async function fetchSimilarUncached(killId: string): Promise<SimilarKill[]> {
  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb.rpc("fn_similar_kills", {
      target_id: killId,
      match_count: 6,
    });
    if (error) {
      console.warn("[similar-kills] rpc error:", error.message);
      return [];
    }
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ""),
      killer_champion: (row.killer_champion as string) ?? null,
      victim_champion: (row.victim_champion as string) ?? null,
      thumbnail_url: (row.thumbnail_url as string) ?? null,
      highlight_score:
        row.highlight_score == null ? null : Number(row.highlight_score),
      ai_description_preview:
        (row.ai_description_preview as string) ?? null,
      similarity: Number(row.similarity ?? 0),
    }));
  } catch (err) {
    console.warn("[similar-kills] threw:", err);
    return [];
  }
}

export const SIMILAR_KILLS_TAG = "similar-kills" as const;

/**
 * Fetch similar kills for a given killId, cached across requests for
 * 1 hour. Use revalidateTag('similar-kills') to invalidate.
 *
 * Key derivation : ['similar-kills', killId] — unstable_cache merges
 * keyParts with callback arguments automatically.
 */
export const getCachedSimilarKills = unstable_cache(
  async (killId: string): Promise<SimilarKill[]> => fetchSimilarUncached(killId),
  ["similar-kills"],
  { revalidate: 3600, tags: [SIMILAR_KILLS_TAG] },
);
