/**
 * Compilation Builder — data helpers (server-side only).
 *
 * Wraps the SECURITY DEFINER RPCs from migration 062 so the page +
 * route handler stay free of inline string queries. Mirrors the
 * conventions used by ./kills.ts :
 *   • `server-only` import for SSR-only safety
 *   • React `cache()` per-render dedup
 *   • `rethrowIfDynamic` in every catch so cookies()/headers() opt-in
 *     to dynamic rendering still works
 *
 * The RPCs themselves do the heavy lifting (validation, short_code
 * collision retry, rate limit) — this module only marshals JSON.
 */

import "server-only";

import { cache } from "react";

import { createAnonSupabase, createServerSupabase, rethrowIfDynamic } from "./server";

export type CompilationStatus = "pending" | "rendering" | "done" | "failed";

/** Common record returned by every read RPC. */
export interface CompilationRow {
  id: string;
  shortCode: string;
  title: string;
  description: string | null;
  killIds: string[];
  introText: string | null;
  outroText: string | null;
  status: CompilationStatus;
  outputUrl: string | null;
  outputDurationSeconds: number | null;
  renderError: string | null;
  viewCount: number;
  /** Stable 12-hex prefix of SHA-256(session_hash). Used to derive a
   *  BCC-style alias (visitorNameFromHash) without exposing the raw id. */
  authorHash: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

/** Trimmed shape for "my compilations" — no intro/outro/author_hash
 *  because the list view doesn't need them. */
export interface MyCompilationRow {
  id: string;
  shortCode: string;
  title: string;
  description: string | null;
  killIds: string[];
  status: CompilationStatus;
  outputUrl: string | null;
  outputDurationSeconds: number | null;
  renderError: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

interface RawCompilationRow {
  id?: string | null;
  short_code?: string | null;
  title?: string | null;
  description?: string | null;
  kill_ids?: string[] | null;
  intro_text?: string | null;
  outro_text?: string | null;
  status?: string | null;
  output_url?: string | null;
  output_duration_seconds?: number | null;
  render_error?: string | null;
  view_count?: number | null;
  author_hash?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  published_at?: string | null;
}

function asStatus(s: string | null | undefined): CompilationStatus {
  if (s === "pending" || s === "rendering" || s === "done" || s === "failed") return s;
  return "pending";
}

function normalize(row: RawCompilationRow): CompilationRow {
  return {
    id: String(row.id ?? ""),
    shortCode: String(row.short_code ?? ""),
    title: String(row.title ?? ""),
    description: row.description ?? null,
    killIds: Array.isArray(row.kill_ids) ? row.kill_ids : [],
    introText: row.intro_text ?? null,
    outroText: row.outro_text ?? null,
    status: asStatus(row.status),
    outputUrl: row.output_url ?? null,
    outputDurationSeconds: row.output_duration_seconds ?? null,
    renderError: row.render_error ?? null,
    viewCount: Number(row.view_count ?? 0),
    authorHash: row.author_hash ?? null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    publishedAt: row.published_at ?? null,
  };
}

function normalizeMy(row: RawCompilationRow): MyCompilationRow {
  return {
    id: String(row.id ?? ""),
    shortCode: String(row.short_code ?? ""),
    title: String(row.title ?? ""),
    description: row.description ?? null,
    killIds: Array.isArray(row.kill_ids) ? row.kill_ids : [],
    status: asStatus(row.status),
    outputUrl: row.output_url ?? null,
    outputDurationSeconds: row.output_duration_seconds ?? null,
    renderError: row.render_error ?? null,
    viewCount: Number(row.view_count ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    publishedAt: row.published_at ?? null,
  };
}

/**
 * Public read by short_code. Used by /c/[shortCode] and by the
 * builder's success screen while polling for render completion.
 *
 * `buildTime: true` swaps the cookie-bound client for the anon-only
 * one so this can be called from generateStaticParams without
 * crashing on cookies().
 */
export const getCompilationByShortCode = cache(
  async function getCompilationByShortCode(
    shortCode: string,
    opts: { buildTime?: boolean } = {},
  ): Promise<CompilationRow | null> {
    if (!shortCode || !/^[0-9A-Za-z]{6,12}$/.test(shortCode)) return null;
    try {
      const sb = opts.buildTime
        ? createAnonSupabase()
        : await createServerSupabase();
      const { data, error } = await sb.rpc("fn_get_compilation_by_short_code", {
        p_short_code: shortCode,
      });
      if (error) {
        console.warn("[supabase/compilations] getCompilationByShortCode error:", error.message);
        return null;
      }
      const rows = (data ?? []) as RawCompilationRow[];
      if (rows.length === 0) return null;
      return normalize(rows[0]);
    } catch (err) {
      rethrowIfDynamic(err);
      console.warn("[supabase/compilations] getCompilationByShortCode threw:", err);
      return null;
    }
  },
);

/**
 * Recent compilations for a session. Returns owner-visible rows
 * (pending / rendering / done / failed) so the "Mes compilations"
 * link can show in-flight renders too.
 *
 * Session-bound, so we must NOT cache across sessions — but React's
 * cache() is per-render so it's safe : every render passes a fresh
 * sessionHash.
 */
export const getMyCompilations = cache(async function getMyCompilations(
  sessionHash: string,
  limit = 20,
): Promise<MyCompilationRow[]> {
  if (!sessionHash || sessionHash.length < 16) return [];
  try {
    const sb = await createServerSupabase();
    const { data, error } = await sb.rpc("fn_my_compilations", {
      p_session_hash: sessionHash,
      p_limit: Math.max(1, Math.min(limit, 100)),
    });
    if (error) {
      console.warn("[supabase/compilations] getMyCompilations error:", error.message);
      return [];
    }
    return ((data ?? []) as RawCompilationRow[]).map(normalizeMy);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/compilations] getMyCompilations threw:", err);
    return [];
  }
});

/**
 * Trigger fn_record_compilation_view from the public viewer.
 * Fire-and-forget : returns the new count when available, 0 otherwise.
 * Failure to bump never breaks the page render.
 */
export async function recordCompilationView(
  shortCode: string,
): Promise<number> {
  if (!shortCode || !/^[0-9A-Za-z]{6,12}$/.test(shortCode)) return 0;
  try {
    const sb = await createServerSupabase();
    const { data, error } = await sb.rpc("fn_record_compilation_view", {
      p_short_code: shortCode,
    });
    if (error) return 0;
    return typeof data === "number" ? data : 0;
  } catch (err) {
    rethrowIfDynamic(err);
    return 0;
  }
}

/**
 * Lightweight projection of a kill used by the compilation viewer's
 * "chapter markers" list AND the builder's clip picker / reorder
 * ribbon. Wraps the raw kills.ts row in something the client can
 * trivially serialize.
 */
export interface CompilationKillSummary {
  id: string;
  killerChampion: string | null;
  victimChampion: string | null;
  killerName: string | null;
  victimName: string | null;
  thumbnailUrl: string | null;
  clipUrlVertical: string | null;
  clipUrlVerticalLow: string | null;
  clipUrlHorizontal: string | null;
  multiKill: string | null;
  isFirstBlood: boolean;
  highlightScore: number | null;
  avgRating: number | null;
  ratingCount: number;
  aiDescription: string | null;
  aiTags: string[];
  matchDate: string | null;
  matchStage: string | null;
}

/**
 * Fetch the lightweight summary for a fixed set of kill IDs in the
 * input order. Used by /c/<shortCode> to render the chapter list.
 *
 * Why a dedicated helper instead of getPublishedKills() : we want to
 * preserve the order chosen by the author, and we want a *minimal*
 * projection (no manifest, no game/match joins beyond what we need).
 */
export const getKillsForCompilation = cache(
  async function getKillsForCompilation(
    killIds: readonly string[],
    opts: { buildTime?: boolean } = {},
  ): Promise<CompilationKillSummary[]> {
    if (killIds.length === 0) return [];
    try {
      const sb = opts.buildTime
        ? createAnonSupabase()
        : await createServerSupabase();
      const { data, error } = await sb
        .from("kills")
        .select(
          `
          id,
          killer_champion,
          victim_champion,
          thumbnail_url,
          clip_url_vertical,
          clip_url_vertical_low,
          clip_url_horizontal,
          multi_kill,
          is_first_blood,
          highlight_score,
          avg_rating,
          rating_count,
          ai_description,
          ai_tags,
          killer:players!killer_player_id ( ign ),
          victim:players!victim_player_id ( ign ),
          games (
            game_number,
            matches ( scheduled_at, stage )
          )
        `,
        )
        .in("id", [...killIds]);
      if (error) {
        console.warn("[supabase/compilations] getKillsForCompilation error:", error.message);
        return [];
      }
      type RawKillRel = { ign?: string | null } | { ign?: string | null }[] | null;
      type RawKillRow = {
        id: string;
        killer_champion: string | null;
        victim_champion: string | null;
        thumbnail_url: string | null;
        clip_url_vertical: string | null;
        clip_url_vertical_low: string | null;
        clip_url_horizontal: string | null;
        multi_kill: string | null;
        is_first_blood: boolean | null;
        highlight_score: number | null;
        avg_rating: number | null;
        rating_count: number | null;
        ai_description: string | null;
        ai_tags: string[] | null;
        killer: RawKillRel;
        victim: RawKillRel;
        games:
          | {
              game_number?: number | null;
              matches:
                | {
                    scheduled_at?: string | null;
                    stage?: string | null;
                  }
                | { scheduled_at?: string | null; stage?: string | null }[]
                | null;
            }
          | {
              game_number?: number | null;
              matches:
                | {
                    scheduled_at?: string | null;
                    stage?: string | null;
                  }
                | { scheduled_at?: string | null; stage?: string | null }[]
                | null;
            }[]
          | null;
      };
      const rows = (data ?? []) as RawKillRow[];
      const byId = new Map<string, CompilationKillSummary>();
      for (const row of rows) {
        const killerRel = Array.isArray(row.killer) ? row.killer[0] : row.killer;
        const victimRel = Array.isArray(row.victim) ? row.victim[0] : row.victim;
        const games = Array.isArray(row.games) ? row.games[0] : row.games;
        const matches = games
          ? Array.isArray(games.matches)
            ? games.matches[0]
            : games.matches
          : null;
        byId.set(row.id, {
          id: row.id,
          killerChampion: row.killer_champion ?? null,
          victimChampion: row.victim_champion ?? null,
          killerName: killerRel?.ign ?? null,
          victimName: victimRel?.ign ?? null,
          thumbnailUrl: row.thumbnail_url ?? null,
          clipUrlVertical: row.clip_url_vertical ?? null,
          clipUrlVerticalLow: row.clip_url_vertical_low ?? null,
          clipUrlHorizontal: row.clip_url_horizontal ?? null,
          multiKill: row.multi_kill ?? null,
          isFirstBlood: Boolean(row.is_first_blood),
          highlightScore: row.highlight_score ?? null,
          avgRating: row.avg_rating ?? null,
          ratingCount: Number(row.rating_count ?? 0),
          aiDescription: row.ai_description ?? null,
          aiTags: Array.isArray(row.ai_tags) ? row.ai_tags : [],
          matchDate: matches?.scheduled_at ?? null,
          matchStage: matches?.stage ?? null,
        });
      }
      // Preserve the caller's input ordering — supabase doesn't.
      return killIds
        .map((id) => byId.get(id))
        .filter((k): k is CompilationKillSummary => Boolean(k));
    } catch (err) {
      rethrowIfDynamic(err);
      console.warn("[supabase/compilations] getKillsForCompilation threw:", err);
      return [];
    }
  },
);
