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

/**
 * Per-type entry inside `kills.assets_manifest` (migration 026).
 *
 * Built by `fn_refresh_kill_assets_manifest` on every kill_assets
 * insert/update/delete. The trigger projects `jsonb_object_agg(type, ...)`
 * so the JSON keys are the kill_assets.type enum values
 * (`horizontal`, `vertical`, `vertical_low`, `thumbnail`, `hls_master`,
 *  `og_image`, `preview_gif`).
 *
 * All numeric fields can be NULL when the worker probe_video() failed —
 * the consumer must tolerate it (UI degrades to default sizing).
 */
export interface KillAssetManifestEntry {
  url: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  size_bytes: number | null;
  version: number;
}

/**
 * Shape of the `kills.assets_manifest` JSONB column. Keys are asset
 * types; values describe the current (`is_current = TRUE`) URL for
 * that type. The frontend prefers this map for source-URL selection
 * (FeedPlayerPool.pickSrc), falling back to the legacy
 * clip_url_horizontal / clip_url_vertical columns when manifest is
 * absent on older rows.
 */
export type KillAssetsManifest = Partial<Record<
  | "horizontal"
  | "vertical"
  | "vertical_low"
  | "thumbnail"
  | "hls_master"
  | "og_image"
  | "preview_gif",
  KillAssetManifestEntry
>>;

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
  /**
   * Versioned kill_assets manifest (migration 026). Replaces the
   * hardcoded clip_url_* columns above as the source of truth for asset
   * URLs. NULL on rows clipped before the migration ran — consumers
   * must fall back to clip_url_horizontal / clip_url_vertical / etc.
   */
  assets_manifest: KillAssetsManifest | null;
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
  /** V42-V43 — best-thumbnail second offset within the clip. NULL
   *  on rows analysed before the migration. */
  best_thumbnail_seconds?: number | null;
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
   *  trusted (e.g. data_source='gol_gg').
   *
   *  PR23-arch : `status` is being split into 4 dimensions
   *  (pipeline_status / publication_status / qc_status / asset_status,
   *  see migration 027). Both sets are populated during the migration
   *  window via the `trg_sync_kill_status_split` trigger — the new
   *  fields below are the source of truth, `status` is back-compat. */
  status: string | null;
  /** PR23 split-status. Pipeline progression — independent of
   *  publication. NULL on rows from before migration 027 ran. */
  pipeline_status: string | null;
  /** PR23 split-status. Visibility on the public site.
   *  'published' / 'hidden' / 'draft' / 'publishable' / 'retracted'. */
  publication_status: string | null;
  /** PR23 split-status. Gemini QC verdict.
   *  'pending' / 'passed' / 'failed' / 'human_review'. */
  qc_status: string | null;
  /** PR23 split-status. R2 file readiness.
   *  'missing' / 'processing' / 'ready' / 'partial' / 'corrupted'. */
  asset_status: string | null;
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
  assets_manifest,
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
  best_thumbnail_seconds,
  created_at,
  data_source,
  status,
  pipeline_status,
  publication_status,
  qc_status,
  asset_status,
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
  assets_manifest?: KillAssetsManifest | null;
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
  pipeline_status?: string | null;
  publication_status?: string | null;
  qc_status?: string | null;
  asset_status?: string | null;
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
    assets_manifest: row.assets_manifest ?? null,
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
    pipeline_status: row.pipeline_status ?? null,
    publication_status: row.publication_status ?? null,
    qc_status: row.qc_status ?? null,
    asset_status: row.asset_status ?? null,
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
/**
 * getPublishedKcKillCount — HEAD-only count of KC offensive published kills.
 *
 * Wave 13e (2026-04-29) : the homepage used to call `getPublishedKills(500)`
 * just to compute `clipCount = filter(team_killer && visible).length` —
 * shipping ~1.25 MB of full kill rows per cache miss to count them. The
 * 2026-04-29 audit identified this as the single biggest egress driver.
 *
 * This helper hits the Supabase REST endpoint with `Prefer: count=exact`
 * and HEAD method — the response contains the count in the
 * `Content-Range` header without ever shipping rows. ~150 bytes vs 1.25 MB
 * = 8000× egress reduction on the hot path.
 *
 * Per-render `cache()` so React dedupes if the page calls it twice.
 */
export const getPublishedKcKillCount = cache(
  async function getPublishedKcKillCount(
    opts: { buildTime?: boolean } = {},
  ): Promise<number> {
    try {
      const supabase = opts.buildTime
        ? createAnonSupabase()
        : await createServerSupabase();
      const { count, error } = await supabase
        .from("kills")
        .select("id", { count: "exact", head: true })
        .or(
          "publication_status.eq.published," +
            "and(publication_status.is.null,status.eq.published)",
        )
        .eq("kill_visible", true)
        .eq("tracked_team_involvement", "team_killer")
        .not("clip_url_vertical", "is", null)
        .not("thumbnail_url", "is", null);
      if (error) {
        console.warn(
          "[supabase/kills] getPublishedKcKillCount error:",
          error.message,
        );
        return 0;
      }
      return count ?? 0;
    } catch (err) {
      rethrowIfDynamic(err);
      console.warn(
        "[supabase/kills] getPublishedKcKillCount threw:",
        err,
      );
      return 0;
    }
  },
);

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
      // PR23 split-status : prefer publication_status when present.
      // Fallback to legacy `status` for rows from before migration 027
      // ran AND the trigger hasn't backfilled them yet (shouldn't
      // happen on fresh deploys, but the OR guards the migration
      // window).
      .or(
        "publication_status.eq.published," +
          "and(publication_status.is.null,status.eq.published)",
      )
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
 * getWeekendBestClips — top published clips during a date window.
 *
 * Used by `<HomeWeekendBestClips />` to surface the freshest, best-rated
 * clips of the current weekend (or last completed weekend if mid-week).
 *
 * Selection logic :
 *   1. Try the explicit weekend window first (created_at BETWEEN from AND to).
 *      Sort by combined-score : highlight_score + community_boost + multi_kill_bonus.
 *      Cap at `limit`.
 *   2. If the weekend window has FEWER than `limit/2` clips (typical mid-week
 *      drought OR worker hasn't processed weekend yet), fall back to the
 *      most recent published clips regardless of date — better to show
 *      *something* than an empty section. The component flags this fallback
 *      visually via the `isEmptyWindow` derived state.
 *
 * The community boost = `avg_rating * log2(rating_count + 1)` — caps the
 * influence of low-vote-count outliers (a 5-star average from 2 votes
 * shouldn't dethrone a 4.6-star with 200 votes). Same shape Hacker News
 * uses on submissions.
 *
 * The multi-kill bonus is multiplicative on top of `highlight_score` :
 *   * penta = ×1.6
 *   * quadra = ×1.4
 *   * triple = ×1.2
 *   * double / first_blood = ×1.05
 *   * none = ×1.0
 * This makes a 7.0-score quadra leapfrog an 8.5-score solo kill in
 * curation — exactly the editorial intent for a "best of weekend" rail.
 */
export const getWeekendBestClips = cache(async function getWeekendBestClips(
  opts: {
    fromIso: string;
    toIso: string;
    limit?: number;
    buildTime?: boolean;
  },
): Promise<PublishedKillRow[]> {
  const limit = opts.limit ?? 12;
  try {
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();

    // --- 1. Try the weekend window ---
    const { data: windowed, error } = await supabase
      .from("kills")
      .select(KILL_SELECT)
      .or(
        "publication_status.eq.published," +
          "and(publication_status.is.null,status.eq.published)",
      )
      .eq("kill_visible", true)
      .not("clip_url_vertical", "is", null)
      .not("thumbnail_url", "is", null)
      .gte("created_at", opts.fromIso)
      .lt("created_at", opts.toIso)
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .order("avg_rating", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit * 2); // grab extra so we can re-rank with the multi-kill bonus client-side

    if (error) {
      console.warn("[supabase/kills] getWeekendBestClips window error:", error.message);
    }

    let candidates = (windowed ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );

    // --- 2. Fallback to recent if the window is sparse ---
    // Half-empty section looks broken — fall back to the freshest available
    // clips so the rail always renders. The header text in the component
    // signals the fallback to the user via the era-empty derived state.
    if (candidates.length < Math.ceil(limit / 2)) {
      const fallback = await getPublishedKills(limit, { buildTime: opts.buildTime });
      // Merge — windowed first (date-prioritized), then fill with recent dedup
      const seen = new Set(candidates.map((k) => k.id));
      for (const k of fallback) {
        if (!seen.has(k.id)) {
          candidates.push(k);
          seen.add(k.id);
        }
        if (candidates.length >= limit * 2) break;
      }
    }

    // --- 3. Re-rank with multi-kill + community boost ---
    const scored = candidates.map((k) => {
      const base = k.highlight_score ?? 0;
      const community =
        (k.avg_rating ?? 0) * Math.log2((k.rating_count ?? 0) + 1);
      const multiBonus =
        k.multi_kill === "penta"
          ? 1.6
          : k.multi_kill === "quadra"
            ? 1.4
            : k.multi_kill === "triple"
              ? 1.2
              : k.multi_kill === "double" || k.is_first_blood
                ? 1.05
                : 1.0;
      const composite = (base + community * 0.5) * multiBonus;
      return { kill: k, composite };
    });

    scored.sort((a, b) => b.composite - a.composite);
    return scored.slice(0, limit).map((s) => s.kill);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getWeekendBestClips threw:", err);
    return [];
  }
});

/**
 * Like getPublishedKills() but expanded to ANY kill that has enough
 * metadata to render a card — published with a clip OR data-only.
 * Use for /clips, /players, /matches grids. Returns up to 6 years of
 * KC kills depending on `limit`.
 *
 * NEVER use this for /scroll : the TikTok-style feed is clip-only.
 *
 * Selection logic — merges THREE buckets, deduped by id :
 *
 *   1. status='published' AND clip_url_vertical NOT NULL
 *      → full clip card. Same as getPublishedKills.
 *
 *   2. data_source='gol_gg'    (ANY status)
 *      → data-only card from the 6-year gol.gg historical scrape.
 *        These never enter the clipping pipeline (we don't know
 *        their YouTube VOD), but the kill data is post-game verified.
 *
 *   3. status='clip_error' OR status='analyzed'  (livestats source)
 *      → data-only card. The harvester extracted the kill (we have
 *        killer + victim + game_time) but the clipping/QC failed.
 *        Better to surface them as stats than hide them entirely.
 *
 * `kill_visible` is enforced ONLY on bucket 1. Buckets 2 and 3 trust
 * the underlying source — gol.gg has post-game verified rosters,
 * livestats-extracted kills already passed the harvester's KC-side
 * detection.
 */
export const getKillsForGrid = cache(async function getKillsForGrid(
  limit = 200,
  opts: { buildTime?: boolean; killerChampion?: string; matchExternalId?: string } = {},
): Promise<PublishedKillRow[]> {
  try {
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();

    // Bucket 1 : full clip cards.
    // PR23 split-status : "published" check uses publication_status when
    // present, falls back to legacy `status` otherwise. The OR clause
    // is the migration-window safety net.
    let publishedQuery = supabase
      .from("kills")
      .select(KILL_SELECT)
      .or(
        "publication_status.eq.published," +
          "and(publication_status.is.null,status.eq.published)",
      )
      .eq("kill_visible", true)
      .not("clip_url_vertical", "is", null)
      .not("thumbnail_url", "is", null)
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    // Bucket 2 : gol.gg historical data-only
    let golggQuery = supabase
      .from("kills")
      .select(KILL_SELECT)
      .eq("data_source", "gol_gg")
      .order("game_time_seconds", { ascending: true })
      .limit(limit);

    // Bucket 3 : livestats-derived data-only (clipping failed or pending).
    // PR23 split-status : "data-only livestats" filter uses
    // pipeline_status='failed' when the new column is populated, falls
    // back to status='clip_error' otherwise. We also keep the legacy
    // 'analyzed' status case so kills that finished the pipeline but
    // never got published (e.g. publisher tick missed) still surface
    // as data-only cards.
    let livestatsDataOnlyQuery = supabase
      .from("kills")
      .select(KILL_SELECT)
      .or(
        "pipeline_status.eq.failed," +
          "and(pipeline_status.is.null,status.eq.clip_error)," +
          "and(pipeline_status.is.null,status.eq.analyzed)",
      )
      .eq("data_source", "livestats")
      .not("killer_champion", "is", null)
      .not("victim_champion", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (opts.killerChampion) {
      publishedQuery = publishedQuery.eq("killer_champion", opts.killerChampion);
      golggQuery = golggQuery.eq("killer_champion", opts.killerChampion);
      livestatsDataOnlyQuery = livestatsDataOnlyQuery.eq("killer_champion", opts.killerChampion);
    }
    if (opts.matchExternalId) {
      publishedQuery = publishedQuery.eq("games.matches.external_id", opts.matchExternalId);
      golggQuery = golggQuery.eq("games.matches.external_id", opts.matchExternalId);
      livestatsDataOnlyQuery = livestatsDataOnlyQuery.eq("games.matches.external_id", opts.matchExternalId);
    }

    const [publishedRes, golggRes, livestatsRes] = await Promise.all([
      publishedQuery,
      golggQuery,
      livestatsDataOnlyQuery,
    ]);

    if (publishedRes.error) {
      console.warn("[supabase/kills] grid published query error:", publishedRes.error.message);
    }
    if (golggRes.error) {
      console.warn("[supabase/kills] grid gol_gg query error:", golggRes.error.message);
    }
    if (livestatsRes.error) {
      console.warn("[supabase/kills] grid livestats data-only query error:", livestatsRes.error.message);
    }

    const published = (publishedRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );
    const golgg = (golggRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );
    const livestats = (livestatsRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );

    // Dedupe by id. Priority order : published (has clip) → gol_gg →
    // livestats data-only. Keep whichever appears first in that order.
    const byId = new Map<string, PublishedKillRow>();
    for (const k of published) byId.set(k.id, k);
    for (const k of golgg) {
      if (!byId.has(k.id)) byId.set(k.id, k);
    }
    for (const k of livestats) {
      if (!byId.has(k.id)) byId.set(k.id, k);
    }

    // Sort merged set : highlight_score desc (NULL last), then created_at desc.
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
export async function getKillById(
  id: string,
  opts: { buildTime?: boolean } = {},
): Promise<PublishedKillRow | null> {
  try {
    // 2026-04-26 cache fix : opt-in cookie-less anon client. Without
    // this, callers (KillOfTheWeek, /kill/[id]) opt the page into
    // dynamic rendering via cookies(), killing ISR.
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();
    const { data, error } = await supabase
      .from("kills")
      .select(KILL_SELECT)
      .eq("id", id)
      // PR23 split-status fallback (see getPublishedKills).
      .or(
        "publication_status.eq.published," +
          "and(publication_status.is.null,status.eq.published)",
      )
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
  matchExternalId: string,
  opts: { buildTime?: boolean } = {},
): Promise<PublishedKillRow[]> {
  try {
    // 2026-04-26 cache fix : opt-in cookie-less anon client. Without
    // this, /match/[slug] runs SSR for every visitor (cookies() in the
    // server client opts the page into dynamic rendering, killing the
    // `revalidate = 600` ISR setting).
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();

    const [publishedRes, golggRes, livestatsRes] = await Promise.all([
      supabase
        .from("kills")
        .select(KILL_SELECT)
        // PR23 split-status fallback (see getPublishedKills).
        .or(
          "publication_status.eq.published," +
            "and(publication_status.is.null,status.eq.published)",
        )
        .eq("kill_visible", true)
        .eq("games.matches.external_id", matchExternalId)
        .order("game_time_seconds", { ascending: true }),
      supabase
        .from("kills")
        .select(KILL_SELECT)
        .eq("data_source", "gol_gg")
        .eq("games.matches.external_id", matchExternalId)
        .order("game_time_seconds", { ascending: true }),
      // Bucket 3 : livestats kills that failed clipping or are pending.
      // PR23 split-status fallback (see getKillsForGrid).
      supabase
        .from("kills")
        .select(KILL_SELECT)
        .or(
          "pipeline_status.eq.failed," +
            "and(pipeline_status.is.null,status.eq.clip_error)," +
            "and(pipeline_status.is.null,status.eq.analyzed)",
        )
        .eq("data_source", "livestats")
        .eq("games.matches.external_id", matchExternalId)
        .not("killer_champion", "is", null)
        .order("game_time_seconds", { ascending: true }),
    ]);

    if (publishedRes.error) {
      console.warn("[supabase/kills] getKillsByMatchExternalId published error:", publishedRes.error.message);
    }
    if (golggRes.error) {
      console.warn("[supabase/kills] getKillsByMatchExternalId golgg error:", golggRes.error.message);
    }
    if (livestatsRes.error) {
      console.warn("[supabase/kills] getKillsByMatchExternalId livestats error:", livestatsRes.error.message);
    }

    const published = (publishedRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );
    const golgg = (golggRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );
    const livestats = (livestatsRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );

    // Dedupe by id, priority : published > gol_gg > livestats (the
    // first one wins — published always has the clip URLs).
    const byId = new Map<string, PublishedKillRow>();
    for (const k of published) byId.set(k.id, k);
    for (const k of golgg) if (!byId.has(k.id)) byId.set(k.id, k);
    for (const k of livestats) if (!byId.has(k.id)) byId.set(k.id, k);

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

    const [publishedRes, golggRes, livestatsRes] = await Promise.all([
      supabase
        .from("kills")
        .select(KILL_SELECT)
        // PR23 split-status fallback (see getPublishedKills).
        .or(
          "publication_status.eq.published," +
            "and(publication_status.is.null,status.eq.published)",
        )
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
      // Bucket 3 — same as getKillsForGrid : livestats kills stuck at
      // clip_error / analyzed get the data-only treatment so the player
      // profile shows them too.
      // PR23 split-status fallback.
      supabase
        .from("kills")
        .select(KILL_SELECT)
        .or(
          "pipeline_status.eq.failed," +
            "and(pipeline_status.is.null,status.eq.clip_error)," +
            "and(pipeline_status.is.null,status.eq.analyzed)",
        )
        .eq("data_source", "livestats")
        .eq("killer_champion", championName)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    if (publishedRes.error) {
      console.warn("[supabase/kills] getKillsByKillerChampion published error:", publishedRes.error.message);
    }
    if (golggRes.error) {
      console.warn("[supabase/kills] getKillsByKillerChampion golgg error:", golggRes.error.message);
    }
    if (livestatsRes.error) {
      console.warn("[supabase/kills] getKillsByKillerChampion livestats error:", livestatsRes.error.message);
    }

    const published = (publishedRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );
    const golgg = (golggRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );
    const livestats = (livestatsRes.data ?? []).map((row) =>
      normalize(row as unknown as RawKillSelect),
    );

    const byId = new Map<string, PublishedKillRow>();
    for (const k of published) byId.set(k.id, k);
    for (const k of golgg) if (!byId.has(k.id)) byId.set(k.id, k);
    for (const k of livestats) if (!byId.has(k.id)) byId.set(k.id, k);

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

/**
 * Filter spec for getKillsByEra. We accept the era's date window directly
 * (instead of just the era id) so callers don't have to import the eras
 * module here — keeps the supabase layer free of UI-side concerns.
 */
export interface KillsByEraOpts {
  /** ISO yyyy-mm-dd, inclusive — usually `era.dateStart`. */
  startDate: string;
  /** ISO yyyy-mm-dd, inclusive — usually `era.dateEnd`. */
  endDate: string;
  /** Hard cap on rows returned. Defaults to 60. */
  limit?: number;
  /** Build-time mode (sitemap, ISR pre-render) — uses anon client to
   *  avoid the cookies() crash outside a request scope. */
  buildTime?: boolean;
}

/**
 * Get published kill clips that happened during the given KC era.
 *
 * Filters by the MATCH date (`games.matches.scheduled_at`) — that's the
 * actual day the kill happened on the Riot stage, not when our worker
 * imported the row. Without this, freshly-backfilled gol.gg historical
 * kills (scraped in 2026) would always slot into the 2026 eras.
 *
 * Same selection criteria as getPublishedKills :
 *   * publication_status='published' (with PR23 legacy fallback on `status`)
 *   * kill_visible=true (Gemini QC has confirmed the kill is in-frame)
 *   * clip_url_vertical NOT NULL + thumbnail_url NOT NULL (real R2 asset)
 *
 * Sorted by highlight_score DESC NULLS LAST, then created_at DESC — same
 * ordering as the homepage feed so eras with high-quality clips bubble
 * the best plays to the top of the strip.
 *
 * Returns an empty array if no kills fall in the window (e.g. early LFL
 * eras where no clips have been backfilled yet) — never throws.
 */
export const getKillsByEra = cache(async function getKillsByEra(
  opts: KillsByEraOpts,
): Promise<PublishedKillRow[]> {
  const limit = opts.limit ?? 60;
  // Build a half-open ISO range from the era's calendar-day window.
  // dateEnd is inclusive at the date level, so we filter < (end + 1 day).
  const startISO = `${opts.startDate}T00:00:00Z`;
  // gte/lte on a date string compares lexicographically — appending the
  // end-of-day timestamp avoids dropping kills that happened on dateEnd.
  const endISO = `${opts.endDate}T23:59:59Z`;
  try {
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();
    const { data, error } = await supabase
      .from("kills")
      .select(KILL_SELECT)
      // PR23 split-status fallback (see getPublishedKills).
      .or(
        "publication_status.eq.published," +
          "and(publication_status.is.null,status.eq.published)",
      )
      .eq("kill_visible", true)
      .not("clip_url_vertical", "is", null)
      .not("thumbnail_url", "is", null)
      // Filter on the match date (when the kill actually happened on
      // stage), NOT on `kills.created_at` which is the worker import time.
      .gte("games.matches.scheduled_at", startISO)
      .lte("games.matches.scheduled_at", endISO)
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[supabase/kills] getKillsByEra error:", error.message);
      return [];
    }
    return (data ?? []).map((row) => normalize(row as unknown as RawKillSelect));
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/kills] getKillsByEra threw:", err);
    return [];
  }
});
