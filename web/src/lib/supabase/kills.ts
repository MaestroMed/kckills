/**
 * Server-side loader for published kill clips from Supabase.
 *
 * Runs only in RSC / route handlers (never imported from client components).
 * Reads anonymously — the RLS policy `"Public kills"` allows SELECT whenever
 * `status = 'published'`, so no service role key is needed.
 *
 * Every kill returned here has a real MP4 on R2 (clip_url_*), a Gemini
 * highlight score, and a French hyped AI description. It is the data layer
 * that makes /scroll go from "splash-art placeholder" to "real TikTok feed".
 */

import "server-only";
import { cache } from "react";
import { createAnonSupabase, createServerSupabase, rethrowIfDynamic } from "./server";

export type LanePhase = "early" | "mid" | "late";
export type FightType =
  | "solo_kill"
  | "pick"
  | "gank"
  | "skirmish_2v2"
  | "skirmish_3v3"
  | "teamfight_4v4"
  | "teamfight_5v5";
export type ObjectiveContext =
  | "none"
  | "dragon"
  | "baron"
  | "herald"
  | "atakhan"
  | "tower"
  | "inhibitor"
  | "nexus";
export type MatchupLane = "top" | "jungle" | "mid" | "bot" | "support" | "cross_map";
export type ChampionClass =
  | "assassin"
  | "bruiser"
  | "mage"
  | "marksman"
  | "tank"
  | "enchanter"
  | "skirmisher";
export type MinuteBucket =
  | "0-5"
  | "5-10"
  | "10-15"
  | "15-20"
  | "20-25"
  | "25-30"
  | "30-35"
  | "35+";

export interface PublishedKillRow {
  id: string;
  killer_player_id: string | null;
  killer_champion: string | null;
  victim_champion: string | null;
  game_time_seconds: number | null;
  highlight_score: number | null;
  avg_rating: number | null;
  rating_count: number;
  clip_url_horizontal: string | null;
  clip_url_vertical: string | null;
  clip_url_vertical_low: string | null;
  /** HLS master playlist URL (migration 007). NULL until the worker's
   *  hls_packager has processed this clip. The Phase 4 player consumes
   *  this first; if NULL it falls back to clip_url_vertical MP4. */
  hls_master_url: string | null;
  thumbnail_url: string | null;
  og_image_url: string | null;
  ai_description: string | null;
  ai_description_fr: string | null;
  ai_description_en: string | null;
  ai_description_ko: string | null;
  ai_description_es: string | null;
  ai_tags: string[];
  multi_kill: string | null;
  is_first_blood: boolean;
  tracked_team_involvement: string | null;
  kill_visible: boolean | null;
  lane_phase: LanePhase | null;
  fight_type: FightType | null;
  objective_context: ObjectiveContext | null;
  matchup_lane: MatchupLane | null;
  champion_class: ChampionClass | null;
  game_minute_bucket: MinuteBucket | null;
  impression_count: number;
  comment_count: number;
  created_at: string;
  /** Source of this kill row :
   *   - 'livestats' : Riot live stats feed (real-time, current season)
   *   - 'gol_gg'    : gol.gg historical scrape (2021–2026 backfill)
   *   - other       : legacy
   *
   * UI uses this to decide whether to render the data-only card variant
   * (no clip player, just stats) vs the full clip card. The /scroll
   * feed filters on clip_url_vertical NOT NULL so data-only kills never
   * leak into the TikTok-style scroll surface. */
  data_source: string | null;
  /** Status of the kill in the pipeline. 'published' = passed every
   *  QC gate. 'raw' = imported but never processed. UI consumers
   *  show data-only kills when status != 'published' but the row is
   *  trusted (e.g. data_source='gol_gg'). */
  status: string | null;
  games: {
    external_id: string;
    game_number: number;
    matches: {
      id: string;
      external_id: string;
      scheduled_at: string | null;
      stage: string | null;
      format: string | null;
    } | null;
  } | null;
}

// hls_master_url is populated by the worker's hls_packager (TBD ship).
// Until that runs, the column stays NULL on all rows and the FeedPlayerPool
// transparently falls back to clip_url_vertical (MP4) — zero regression.
const KILL_SELECT = `
  id,
  killer_player_id,
  killer_champion,
  victim_champion,
  game_time_seconds,
  highlight_score,
  avg_rating,
  rating_count,
  clip_url_horizontal,
  clip_url_vertical,
  clip_url_vertical_low,
  hls_master_url,
  thumbnail_url,
  og_image_url,
  ai_description,
  ai_description_fr,
  ai_description_en,
  ai_description_ko,
  ai_description_es,
  ai_tags,
  multi_kill,
  is_first_blood,
  tracked_team_involvement,
  kill_visible,
  lane_phase,
  fight_type,
  objective_context,
  matchup_lane,
  champion_class,
  game_minute_bucket,
  impression_count,
  comment_count,
  created_at,
  data_source,
  status,
  games!inner (
    external_id,
    game_number,
    matches!inner (
      id,
      external_id,
      scheduled_at,
      stage,
      format
    )
  )
`.trim();

/**
 * Raw row shape returned by the SELECT clause above. Mirrors the
 * Supabase response one-to-one BEFORE normalisation. Defining this in
 * code (instead of `Record<string, unknown>`) means a Supabase schema
 * change makes us a TS error here, not a silent runtime null cascade
 * downstream.
 *
 * Joined relations come back as object | array depending on the
 * supabase-js version, hence the union types on `games` and
 * `matches`. Normalize collapses both.
 */
interface RawKillSelect {
  id?: string | null;
  killer_player_id?: string | null;
  killer_champion?: string | null;
  victim_champion?: string | null;
  game_time_seconds?: number | null;
  highlight_score?: number | null;
  avg_rating?: number | null;
  rating_count?: number | null;
  clip_url_horizontal?: string | null;
  clip_url_vertical?: string | null;
  clip_url_vertical_low?: string | null;
  hls_master_url?: string | null;
  thumbnail_url?: string | null;
  og_image_url?: string | null;
  ai_description?: string | null;
  ai_description_fr?: string | null;
  ai_description_en?: string | null;
  ai_description_ko?: string | null;
  ai_description_es?: string | null;
  ai_tags?: string[] | null;
  multi_kill?: string | null;
  is_first_blood?: boolean | null;
  tracked_team_involvement?: string | null;
  kill_visible?: boolean | null;
  lane_phase?: LanePhase | null;
  fight_type?: FightType | null;
  objective_context?: ObjectiveContext | null;
  matchup_lane?: MatchupLane | null;
  champion_class?: ChampionClass | null;
  game_minute_bucket?: MinuteBucket | null;
  impression_count?: number | null;
  comment_count?: number | null;
  created_at?: string | null;
  data_source?: string | null;
  status?: string | null;
  games?: RawGameSelect | RawGameSelect[] | null;
}

interface RawGameSelect {
  external_id?: string | null;
  game_number?: number | null;
  matches?: RawMatchSelect | RawMatchSelect[] | null;
}

interface RawMatchSelect {
  id?: string | null;
  external_id?: string | null;
  scheduled_at?: string | null;
  stage?: string | null;
  format?: string | null;
}

function normalize(row: RawKillSelect): PublishedKillRow {
  // Joined relations come back as object | array depending on the
  // supabase-js version — collapse both cases so downstream code
  // doesn't branch.
  const games = Array.isArray(row.games) ? row.games[0] ?? null : row.games ?? null;
  let gamesNormalized: PublishedKillRow["games"] = null;
  if (games) {
    const matches = Array.isArray(games.matches) ? games.matches[0] ?? null : games.matches ?? null;
    gamesNormalized = {
      external_id: String(games.external_id ?? ""),
      game_number: Number(games.game_number ?? 1),
      matches: matches
        ? {
            id: String(matches.id ?? ""),
            external_id: String(matches.external_id ?? ""),
            scheduled_at: matches.scheduled_at ?? null,
            stage: matches.stage ?? null,
            format: matches.format ?? null,
          }
        : null,
    };
  }
  return {
    id: String(row.id ?? ""),
    killer_player_id: row.killer_player_id ?? null,
    killer_champion: row.killer_champion ?? null,
    victim_champion: row.victim_champion ?? null,
    game_time_seconds: row.game_time_seconds ?? null,
    highlight_score: row.highlight_score ?? null,
    avg_rating: row.avg_rating ?? null,
    rating_count: Number(row.rating_count ?? 0),
    clip_url_horizontal: row.clip_url_horizontal ?? null,
    clip_url_vertical: row.clip_url_vertical ?? null,
    clip_url_vertical_low: row.clip_url_vertical_low ?? null,
    hls_master_url: row.hls_master_url ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    og_image_url: row.og_image_url ?? null,
    ai_description: row.ai_description ?? null,
    ai_description_fr: row.ai_description_fr ?? null,
    ai_description_en: row.ai_description_en ?? null,
    ai_description_ko: row.ai_description_ko ?? null,
    ai_description_es: row.ai_description_es ?? null,
    ai_tags: Array.isArray(row.ai_tags) ? row.ai_tags : [],
    multi_kill: row.multi_kill ?? null,
    is_first_blood: Boolean(row.is_first_blood),
    tracked_team_involvement: row.tracked_team_involvement ?? null,
    kill_visible: row.kill_visible ?? null,
    lane_phase: row.lane_phase ?? null,
    fight_type: row.fight_type ?? null,
    objective_context: row.objective_context ?? null,
    matchup_lane: row.matchup_lane ?? null,
    champion_class: row.champion_class ?? null,
    game_minute_bucket: row.game_minute_bucket ?? null,
    impression_count: Number(row.impression_count ?? 0),
    comment_count: Number(row.comment_count ?? 0),
    created_at: String(row.created_at ?? ""),
    data_source: row.data_source ?? null,
    status: row.status ?? null,
    games: gamesNormalized,
  };
}

/**
 * Get the published kill feed sorted by highlight score.
 *
 * `buildTime: true` swaps the cookie-bound server client for an
 * anon-only client, so this can be safely called from
 * generateStaticParams + sitemap.ts (which run outside any request
 * scope and would otherwise crash on `cookies()`). The data returned
 * is identical — the kills RLS policy is `Public kills` (status =
 * published), so no auth is needed.
 */
/**
 * React-cached fetch — `cache()` dedupes identical (limit, buildTime)
 * calls within a single render pass. The homepage alone hits Supabase
 * 5×/render via KillOfTheWeek, HomeRecentClips, HomeRareCards,
 * TaggingInsights and the page itself; without this dedup we'd burn
 * ~5 separate egress reads per visitor for largely overlapping data.
 *
 * Different limit values still hit the network independently — that's
 * intentional, callers ask for tighter slices for a reason.
 */
export const getPublishedKills = cache(async function getPublishedKills(
  limit = 50,
  opts: { buildTime?: boolean } = {},
): Promise<PublishedKillRow[]> {
  try {
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();
    const { data, error } = await supabase
      .from("kills")
      .select(KILL_SELECT)
      .eq("status", "published")
      .eq("kill_visible", true)            // Gemini QC must have confirmed the kill is in-frame
      .not("clip_url_vertical", "is", null) // real MP4 on R2
      .not("thumbnail_url", "is", null)     // poster frame so the player isn't black on load
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[supabase/kills] getPublishedKills error:", error.message);
      return [];
    }
    return (data ?? []).map((row) => normalize(row as unknown as RawKillSelect));
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getPublishedKills threw:", err);
    return [];
  }
});

/**
 * Like getPublishedKills() but ALSO includes data-only entries from
 * gol.gg historical scrapes. Use for /clips, /players, /matches grids
 * — surfaces 6 years of KC kill metadata even where we don't have a
 * playable clip on R2.
 *
 * NEVER use this for /scroll : the TikTok-style feed is clip-only.
 *
 * Selection logic :
 *   * status='published' AND clip_url_vertical NOT NULL  →  full kill
 *     (same as getPublishedKills)
 *   * data_source='gol_gg'                                →  data-only
 *     (always trusted ; gol.gg is post-game verified)
 *
 * The two sets are merged client-side. Sort key is highlight_score
 * desc (data-only kills with NULL highlight_score sink to the bottom).
 *
 * `kill_visible` is NOT enforced for the data-only branch — historical
 * gol.gg kills haven't been QC'd by Gemini, so requiring kill_visible=true
 * would zero them out. Trust the source instead.
 */
export const getKillsForGrid = cache(async function getKillsForGrid(
  limit = 200,
  opts: { buildTime?: boolean; killerChampion?: string; matchExternalId?: string } = {},
): Promise<PublishedKillRow[]> {
  try {
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();

    // Branch 1 : full clips (status=published with clip)
    let publishedQuery = supabase
      .from("kills")
      .select(KILL_SELECT)
      .eq("status", "published")
      .eq("kill_visible", true)
      .not("clip_url_vertical", "is", null)
      .not("thumbnail_url", "is", null)
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    // Branch 2 : data-only from gol.gg (any status — they're post-game verified)
    let dataOnlyQuery = supabase
      .from("kills")
      .select(KILL_SELECT)
      .eq("data_source", "gol_gg")
      .order("game_time_seconds", { ascending: true })
      .limit(limit);

    if (opts.killerChampion) {
      publishedQuery = publishedQuery.eq("killer_champion", opts.killerChampion);
      dataOnlyQuery = dataOnlyQuery.eq("killer_champion", opts.killerChampion);
    }
    if (opts.matchExternalId) {
      publishedQuery = publishedQuery.eq("games.matches.external_id", opts.matchExternalId);
      dataOnlyQuery = dataOnlyQuery.eq("games.matches.external_id", opts.matchExternalId);
    }

    const [publishedRes, dataOnlyRes] = await Promise.all([publishedQuery, dataOnlyQuery]);

    if (publishedRes.error) {
      console.warn("[supabase/kills] grid published query error:", publishedRes.error.message);
    }
    if (dataOnlyRes.error) {
      console.warn("[supabase/kills] grid data-only query error:", dataOnlyRes.error.message);
    }

    const published = (publishedRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );
    const dataOnly = (dataOnlyRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );

    // Dedupe — a kill may appear in both branches if it's both
    // status=published AND data_source=gol_gg. Keep the published one
    // (it has the clip URLs).
    const byId = new Map<string, PublishedKillRow>();
    for (const k of published) byId.set(k.id, k);
    for (const k of dataOnly) {
      if (!byId.has(k.id)) byId.set(k.id, k);
    }

    // Sort merged set by highlight_score desc (NULL last), then created_at desc.
    const merged = Array.from(byId.values()).sort((a, b) => {
      const sa = a.highlight_score ?? -1;
      const sb = b.highlight_score ?? -1;
      if (sb !== sa) return sb - sa;
      return (b.created_at || "").localeCompare(a.created_at || "");
    });

    return merged.slice(0, limit);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getKillsForGrid threw:", err);
    return [];
  }
});

/** Helper for UI : true if this kill should render as a data-only card
 *  (no clip player, just stats + thumbnail if any). */
export function isDataOnlyKill(k: PublishedKillRow): boolean {
  return !k.clip_url_vertical;
}

/** Get a single published kill by id. */
export async function getKillById(id: string): Promise<PublishedKillRow | null> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("kills")
      .select(KILL_SELECT)
      .eq("id", id)
      .eq("status", "published")
      .maybeSingle();
    if (error) {
      console.warn("[supabase/kills] getKillById error:", error.message);
      return null;
    }
    return data ? normalize(data as unknown as RawKillSelect) : null;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getKillById threw:", err);
    return null;
  }
}

/**
 * Get all kills for a given match, INCLUDING data-only gol.gg historical
 * kills. The match page renders both : full clip cards for kills that
 * went through the pipeline, stats-only cards for pre-2024 LFL/EUM kills
 * where we have the data but no clip. Sorted by game_time ascending so
 * the page reads chronologically.
 *
 * Selection logic mirrors getKillsForGrid :
 *   * status='published' AND kill_visible=true (Gemini QC passed)
 *   * OR data_source='gol_gg' (post-game verified, no QC needed)
 */
export async function getKillsByMatchExternalId(
  matchExternalId: string
): Promise<PublishedKillRow[]> {
  try {
    const supabase = await createServerSupabase();

    const [publishedRes, dataOnlyRes] = await Promise.all([
      supabase
        .from("kills")
        .select(KILL_SELECT)
        .eq("status", "published")
        .eq("kill_visible", true)
        .eq("games.matches.external_id", matchExternalId)
        .order("game_time_seconds", { ascending: true }),
      supabase
        .from("kills")
        .select(KILL_SELECT)
        .eq("data_source", "gol_gg")
        .eq("games.matches.external_id", matchExternalId)
        .order("game_time_seconds", { ascending: true }),
    ]);

    if (publishedRes.error) {
      console.warn("[supabase/kills] getKillsByMatchExternalId published error:", publishedRes.error.message);
    }
    if (dataOnlyRes.error) {
      console.warn("[supabase/kills] getKillsByMatchExternalId dataOnly error:", dataOnlyRes.error.message);
    }

    const published = (publishedRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );
    const dataOnly = (dataOnlyRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );

    // Dedupe by id, prefer published (has the clip URLs).
    const byId = new Map<string, PublishedKillRow>();
    for (const k of published) byId.set(k.id, k);
    for (const k of dataOnly) {
      if (!byId.has(k.id)) byId.set(k.id, k);
    }

    return Array.from(byId.values()).sort(
      (a, b) => (a.game_time_seconds ?? 0) - (b.game_time_seconds ?? 0),
    );
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getKillsByMatchExternalId threw:", err);
    return [];
  }
}

/**
 * Get kills where a given champion is the killer, INCLUDING data-only
 * gol.gg historical entries. Used by /player/[slug] champion-pool view.
 *
 * Same merge strategy as getKillsByMatchExternalId : both sources
 * combined client-side, deduped by id, sorted by highlight_score desc
 * (NULL last so data-only kills sink below scored ones).
 */
export async function getKillsByKillerChampion(
  championName: string,
  limit = 50
): Promise<PublishedKillRow[]> {
  try {
    const supabase = await createServerSupabase();

    const [publishedRes, dataOnlyRes] = await Promise.all([
      supabase
        .from("kills")
        .select(KILL_SELECT)
        .eq("status", "published")
        .eq("kill_visible", true)
        .eq("killer_champion", championName)
        .order("highlight_score", { ascending: false, nullsFirst: false })
        .limit(limit),
      supabase
        .from("kills")
        .select(KILL_SELECT)
        .eq("data_source", "gol_gg")
        .eq("killer_champion", championName)
        .order("game_time_seconds", { ascending: true })
        .limit(limit),
    ]);

    if (publishedRes.error) {
      console.warn("[supabase/kills] getKillsByKillerChampion published error:", publishedRes.error.message);
    }
    if (dataOnlyRes.error) {
      console.warn("[supabase/kills] getKillsByKillerChampion dataOnly error:", dataOnlyRes.error.message);
    }

    const published = (publishedRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );
    const dataOnly = (dataOnlyRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );

    const byId = new Map<string, PublishedKillRow>();
    for (const k of published) byId.set(k.id, k);
    for (const k of dataOnly) {
      if (!byId.has(k.id)) byId.set(k.id, k);
    }

    return Array.from(byId.values())
      .sort((a, b) => {
        const sa = a.highlight_score ?? -1;
        const sb = b.highlight_score ?? -1;
        if (sb !== sa) return sb - sa;
        return (b.created_at || "").localeCompare(a.created_at || "");
      })
      .slice(0, limit);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getKillsByKillerChampion threw:", err);
    return [];
  }
}
