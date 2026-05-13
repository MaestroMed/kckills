/**
 * Server + client loaders for the AI Quote Extractor surface.
 *
 * Everything in this file maps to one of the SECURITY DEFINER RPCs
 * declared in migration 065_kill_quotes.sql. The RPCs run with locked
 * search_path so we can safely call them from the anon client — no
 * direct table SELECT is needed.
 *
 * Pattern mirrors lib/supabase/face-off.ts :
 *   * `cache()` for per-render dedup on Server Components
 *   * `rethrowIfDynamic()` in every catch so the dynamic-rendering
 *     sentinel propagates correctly when called from inside cookies()
 *     scope
 *   * Anon Supabase client for build-time / sitemap callers
 */

import "server-only";

import { cache } from "react";
import { createAnonSupabase, createServerSupabase, rethrowIfDynamic } from "./server";

// ─── Shared row shapes ────────────────────────────────────────────────

/**
 * Row shape returned by fn_top_quotes. Lots of optional nulls because
 * we surface this verbatim into <QuoteCard /> which decides what to
 * render based on presence.
 */
export interface TopQuoteRow {
  id: string;
  kill_id: string;
  quote_text: string;
  quote_start_ms: number;
  quote_end_ms: number;
  caster_name: string | null;
  language: string | null;
  energy_level: number | null;
  is_memetic: boolean;
  upvotes: number;
  extracted_at: string | null;
  killer_champion: string | null;
  victim_champion: string | null;
  clip_url_vertical: string | null;
  thumbnail_url: string | null;
  multi_kill: string | null;
  is_first_blood: boolean;
  match_date: string | null;
}

/** fn_search_quotes — same as TopQuoteRow minus extracted_at/language,
 *  plus a relevance `rank` (ts_rank from the GIN index). */
export interface SearchQuoteRow {
  id: string;
  kill_id: string;
  quote_text: string;
  quote_start_ms: number;
  quote_end_ms: number;
  caster_name: string | null;
  energy_level: number | null;
  upvotes: number;
  killer_champion: string | null;
  victim_champion: string | null;
  clip_url_vertical: string | null;
  thumbnail_url: string | null;
  multi_kill: string | null;
  is_first_blood: boolean;
  rank: number;
}

/** fn_quotes_for_kill — minimal payload for the per-kill panel. */
export interface KillQuoteRow {
  id: string;
  quote_text: string;
  quote_start_ms: number;
  quote_end_ms: number;
  caster_name: string | null;
  language: string | null;
  energy_level: number | null;
  is_memetic: boolean;
  upvotes: number;
  ai_confidence: number | null;
}

/** fn_quotes_stats — sidebar counters. */
export interface QuotesStatsRow {
  total_quotes: number;
  total_kills: number;
  top_caster: string | null;
  top_caster_quotes: number;
}

// ─── Loaders ──────────────────────────────────────────────────────────

/**
 * getTopQuotes — paginated /quotes feed.
 *
 * Sort order (server-side) :
 *   energy_level DESC NULLS LAST, upvotes DESC, extracted_at DESC.
 *
 * `minEnergy` filter is the main UX lever : default 1 (everything),
 * bump to 3 for "hype only" view.
 */
export const getTopQuotes = cache(async function getTopQuotes(
  limit = 24,
  minEnergy = 1,
  opts: { buildTime?: boolean } = {},
): Promise<TopQuoteRow[]> {
  try {
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();
    const { data, error } = await supabase.rpc("fn_top_quotes", {
      p_limit: limit,
      p_min_energy: minEnergy,
    });
    if (error) {
      console.warn("[quotes] getTopQuotes rpc error:", error.message);
      return [];
    }
    return ((data as TopQuoteRow[] | null) ?? []).map(normalizeTop);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[quotes] getTopQuotes threw:", err);
    return [];
  }
});

/**
 * searchQuotes — French full-text search via fn_search_quotes.
 *
 * Returns an empty array on an empty/whitespace query so the
 * "search field is empty" branch of the UI doesn't need a separate
 * code path.
 */
export const searchQuotes = cache(async function searchQuotes(
  query: string,
  limit = 50,
  opts: { buildTime?: boolean } = {},
): Promise<SearchQuoteRow[]> {
  const trimmed = (query ?? "").trim();
  if (trimmed.length === 0) return [];
  try {
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();
    const { data, error } = await supabase.rpc("fn_search_quotes", {
      p_query: trimmed,
      p_limit: limit,
    });
    if (error) {
      console.warn("[quotes] searchQuotes rpc error:", error.message);
      return [];
    }
    return ((data as SearchQuoteRow[] | null) ?? []).map(normalizeSearch);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[quotes] searchQuotes threw:", err);
    return [];
  }
});

/**
 * getQuotesForKill — all visible quotes attached to a single kill,
 * sorted by quote_start_ms (chronological inside the clip).
 */
export const getQuotesForKill = cache(async function getQuotesForKill(
  killId: string,
  opts: { buildTime?: boolean } = {},
): Promise<KillQuoteRow[]> {
  if (!killId) return [];
  try {
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();
    const { data, error } = await supabase.rpc("fn_quotes_for_kill", {
      p_kill_id: killId,
    });
    if (error) {
      console.warn("[quotes] getQuotesForKill rpc error:", error.message);
      return [];
    }
    return ((data as KillQuoteRow[] | null) ?? []).map(normalizeKillQuote);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[quotes] getQuotesForKill threw:", err);
    return [];
  }
});

/**
 * getQuotesStats — single-row sidebar counters.
 */
export const getQuotesStats = cache(async function getQuotesStats(
  opts: { buildTime?: boolean } = {},
): Promise<QuotesStatsRow> {
  try {
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();
    const { data, error } = await supabase.rpc("fn_quotes_stats");
    if (error) {
      console.warn("[quotes] getQuotesStats rpc error:", error.message);
      return EMPTY_STATS;
    }
    const rows = (data as QuotesStatsRow[] | null) ?? [];
    if (rows.length === 0) return EMPTY_STATS;
    return {
      total_quotes: Number(rows[0].total_quotes ?? 0),
      total_kills: Number(rows[0].total_kills ?? 0),
      top_caster: rows[0].top_caster ?? null,
      top_caster_quotes: Number(rows[0].top_caster_quotes ?? 0),
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[quotes] getQuotesStats threw:", err);
    return EMPTY_STATS;
  }
});

/**
 * recordQuoteUpvote — fire-and-forget. The RPC is idempotent on
 * (quote_id, session_hash) so multiple calls from the same browser
 * never inflate the count.
 *
 * Returns the new count + a flag indicating whether the vote was
 * "fresh" (false = the session had already voted). The UI uses this
 * to flip the heart from outlined to filled without an extra
 * round-trip.
 */
export async function recordQuoteUpvote(
  quoteId: string,
  sessionHash: string,
): Promise<{ upvotes: number; alreadyVoted: boolean }> {
  if (!quoteId || !sessionHash) {
    return { upvotes: 0, alreadyVoted: true };
  }
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("fn_record_quote_upvote", {
      p_quote_id: quoteId,
      p_session_hash: sessionHash,
    });
    if (error) {
      console.warn("[quotes] recordQuoteUpvote rpc error:", error.message);
      return { upvotes: 0, alreadyVoted: true };
    }
    const rows = (data as Array<{ upvotes: number; already_voted: boolean }> | null) ?? [];
    if (rows.length === 0) return { upvotes: 0, alreadyVoted: true };
    return {
      upvotes: Number(rows[0].upvotes ?? 0),
      alreadyVoted: Boolean(rows[0].already_voted),
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[quotes] recordQuoteUpvote threw:", err);
    return { upvotes: 0, alreadyVoted: true };
  }
}

// ─── Normalizers ──────────────────────────────────────────────────────

const EMPTY_STATS: QuotesStatsRow = {
  total_quotes: 0,
  total_kills: 0,
  top_caster: null,
  top_caster_quotes: 0,
};

function normalizeTop(row: TopQuoteRow): TopQuoteRow {
  return {
    id: String(row.id ?? ""),
    kill_id: String(row.kill_id ?? ""),
    quote_text: String(row.quote_text ?? ""),
    quote_start_ms: Number(row.quote_start_ms ?? 0),
    quote_end_ms: Number(row.quote_end_ms ?? 0),
    caster_name: row.caster_name ?? null,
    language: row.language ?? null,
    energy_level: row.energy_level ?? null,
    is_memetic: Boolean(row.is_memetic),
    upvotes: Number(row.upvotes ?? 0),
    extracted_at: row.extracted_at ?? null,
    killer_champion: row.killer_champion ?? null,
    victim_champion: row.victim_champion ?? null,
    clip_url_vertical: row.clip_url_vertical ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    multi_kill: row.multi_kill ?? null,
    is_first_blood: Boolean(row.is_first_blood),
    match_date: row.match_date ?? null,
  };
}

function normalizeSearch(row: SearchQuoteRow): SearchQuoteRow {
  return {
    id: String(row.id ?? ""),
    kill_id: String(row.kill_id ?? ""),
    quote_text: String(row.quote_text ?? ""),
    quote_start_ms: Number(row.quote_start_ms ?? 0),
    quote_end_ms: Number(row.quote_end_ms ?? 0),
    caster_name: row.caster_name ?? null,
    energy_level: row.energy_level ?? null,
    upvotes: Number(row.upvotes ?? 0),
    killer_champion: row.killer_champion ?? null,
    victim_champion: row.victim_champion ?? null,
    clip_url_vertical: row.clip_url_vertical ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    multi_kill: row.multi_kill ?? null,
    is_first_blood: Boolean(row.is_first_blood),
    rank: Number(row.rank ?? 0),
  };
}

function normalizeKillQuote(row: KillQuoteRow): KillQuoteRow {
  return {
    id: String(row.id ?? ""),
    quote_text: String(row.quote_text ?? ""),
    quote_start_ms: Number(row.quote_start_ms ?? 0),
    quote_end_ms: Number(row.quote_end_ms ?? 0),
    caster_name: row.caster_name ?? null,
    language: row.language ?? null,
    energy_level: row.energy_level ?? null,
    is_memetic: Boolean(row.is_memetic),
    upvotes: Number(row.upvotes ?? 0),
    ai_confidence: row.ai_confidence ?? null,
  };
}
