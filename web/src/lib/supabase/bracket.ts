/**
 * /bracket — server-only data layer.
 *
 * Wave 30o split : types + pure layout helpers moved to
 * `./bracket-types` so client components (BracketView) can import them
 * without dragging `"server-only"` + cookies() into the browser bundle.
 *
 * Migration 063 exposes four read-side RPCs we wrap here :
 *   - fn_get_current_bracket()           → active monthly tournament
 *   - fn_get_bracket_by_slug(slug)       → archived tournament
 *   - fn_get_past_winners(limit)         → champions gallery footer
 *
 * The vote RPC (fn_record_bracket_vote) is called CLIENT-side from
 * BracketView — same pattern as VS roulette / face-off — so this file
 * only handles SSR reads. Browser callers use `createClient()` directly.
 *
 * Every helper degrades to a "neutral" return value on failure (null
 * tournament, empty match list) — /bracket must never 500.
 */

import "server-only";
import { cache } from "react";

import { createAnonSupabase, rethrowIfDynamic } from "./server";
import type {
  BracketBundle,
  BracketMatch,
  BracketTournament,
  PastWinner,
} from "./bracket-types";

// ════════════════════════════════════════════════════════════════════
// Re-exports — keep existing server callers (`@/lib/supabase/bracket`)
// working without changing every import. Client code should import
// directly from `./bracket-types`.
// ════════════════════════════════════════════════════════════════════

export type {
  BracketBundle,
  BracketMatch,
  BracketTournament,
  PastWinner,
} from "./bracket-types";

export {
  roundsForSize,
  roundLabel,
  currentRound,
  openMatchCount,
  nextCloseAt,
} from "./bracket-types";

// ════════════════════════════════════════════════════════════════════
// Raw row shapes — what supabase-js gives us before normalisation
// ════════════════════════════════════════════════════════════════════

interface RawBracketTournament {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  champion_kill_id?: string | null;
  poster_url?: string | null;
  bracket_size?: number | null;
  created_at?: string | null;
}

interface RawBracketMatch {
  id?: string | null;
  round?: number | null;
  match_index?: number | null;
  kill_a_id?: string | null;
  kill_b_id?: string | null;
  votes_a?: number | null;
  votes_b?: number | null;
  winner_kill_id?: string | null;
  opens_at?: string | null;
  closes_at?: string | null;
  kill_a_killer_champion?: string | null;
  kill_a_victim_champion?: string | null;
  kill_a_killer_name?: string | null;
  kill_a_thumbnail?: string | null;
  kill_a_clip_vertical?: string | null;
  kill_a_clip_vertical_low?: string | null;
  kill_a_ai_description?: string | null;
  kill_a_multi_kill?: string | null;
  kill_a_first_blood?: boolean | null;
  kill_a_highlight_score?: number | null;
  kill_a_avg_rating?: number | null;
  kill_b_killer_champion?: string | null;
  kill_b_victim_champion?: string | null;
  kill_b_killer_name?: string | null;
  kill_b_thumbnail?: string | null;
  kill_b_clip_vertical?: string | null;
  kill_b_clip_vertical_low?: string | null;
  kill_b_ai_description?: string | null;
  kill_b_multi_kill?: string | null;
  kill_b_first_blood?: boolean | null;
  kill_b_highlight_score?: number | null;
  kill_b_avg_rating?: number | null;
}

function normalizeTournament(raw: RawBracketTournament | null): BracketTournament | null {
  if (!raw || !raw.id) return null;
  const status = raw.status === "closed" || raw.status === "archived" ? raw.status : "open";
  return {
    id: String(raw.id),
    slug: String(raw.slug ?? ""),
    name: String(raw.name ?? ""),
    start_date: String(raw.start_date ?? ""),
    end_date: String(raw.end_date ?? ""),
    status,
    champion_kill_id: raw.champion_kill_id ?? null,
    poster_url: raw.poster_url ?? null,
    bracket_size: Number(raw.bracket_size ?? 64),
    created_at: String(raw.created_at ?? ""),
  };
}

function normalizeMatch(raw: RawBracketMatch): BracketMatch {
  return {
    id: String(raw.id ?? ""),
    round: Number(raw.round ?? 1),
    match_index: Number(raw.match_index ?? 0),
    kill_a_id: raw.kill_a_id ?? null,
    kill_b_id: raw.kill_b_id ?? null,
    votes_a: Number(raw.votes_a ?? 0),
    votes_b: Number(raw.votes_b ?? 0),
    winner_kill_id: raw.winner_kill_id ?? null,
    opens_at: String(raw.opens_at ?? ""),
    closes_at: String(raw.closes_at ?? ""),
    kill_a_killer_champion: raw.kill_a_killer_champion ?? null,
    kill_a_victim_champion: raw.kill_a_victim_champion ?? null,
    kill_a_killer_name: raw.kill_a_killer_name ?? null,
    kill_a_thumbnail: raw.kill_a_thumbnail ?? null,
    kill_a_clip_vertical: raw.kill_a_clip_vertical ?? null,
    kill_a_clip_vertical_low: raw.kill_a_clip_vertical_low ?? null,
    kill_a_ai_description: raw.kill_a_ai_description ?? null,
    kill_a_multi_kill: raw.kill_a_multi_kill ?? null,
    kill_a_first_blood: Boolean(raw.kill_a_first_blood),
    kill_a_highlight_score: typeof raw.kill_a_highlight_score === "number" ? raw.kill_a_highlight_score : null,
    kill_a_avg_rating: typeof raw.kill_a_avg_rating === "number" ? raw.kill_a_avg_rating : null,
    kill_b_killer_champion: raw.kill_b_killer_champion ?? null,
    kill_b_victim_champion: raw.kill_b_victim_champion ?? null,
    kill_b_killer_name: raw.kill_b_killer_name ?? null,
    kill_b_thumbnail: raw.kill_b_thumbnail ?? null,
    kill_b_clip_vertical: raw.kill_b_clip_vertical ?? null,
    kill_b_clip_vertical_low: raw.kill_b_clip_vertical_low ?? null,
    kill_b_ai_description: raw.kill_b_ai_description ?? null,
    kill_b_multi_kill: raw.kill_b_multi_kill ?? null,
    kill_b_first_blood: Boolean(raw.kill_b_first_blood),
    kill_b_highlight_score: typeof raw.kill_b_highlight_score === "number" ? raw.kill_b_highlight_score : null,
    kill_b_avg_rating: typeof raw.kill_b_avg_rating === "number" ? raw.kill_b_avg_rating : null,
  };
}

// ════════════════════════════════════════════════════════════════════
// getCurrentBracket — the active (or most-recent-closed) tournament
// ════════════════════════════════════════════════════════════════════

export const getCurrentBracket = cache(async function getCurrentBracket(): Promise<BracketBundle> {
  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb.rpc("fn_get_current_bracket");
    if (error) {
      console.warn("[bracket] getCurrentBracket rpc error:", error.message);
      return { tournament: null, matches: [] };
    }
    const rows = Array.isArray(data) ? data : [];
    const row = rows[0] as { tournament?: RawBracketTournament | null; matches?: RawBracketMatch[] | null } | undefined;
    if (!row) return { tournament: null, matches: [] };
    return {
      tournament: normalizeTournament(row.tournament ?? null),
      matches: Array.isArray(row.matches) ? row.matches.map(normalizeMatch) : [],
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[bracket] getCurrentBracket threw:", err);
    return { tournament: null, matches: [] };
  }
});

// ════════════════════════════════════════════════════════════════════
// getBracketBySlug — historical / archive view
// ════════════════════════════════════════════════════════════════════

export const getBracketBySlug = cache(async function getBracketBySlug(
  slug: string,
): Promise<BracketBundle> {
  if (!slug || slug.trim().length === 0) {
    return { tournament: null, matches: [] };
  }
  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb.rpc("fn_get_bracket_by_slug", {
      p_slug: slug,
    });
    if (error) {
      console.warn("[bracket] getBracketBySlug rpc error:", error.message);
      return { tournament: null, matches: [] };
    }
    const rows = Array.isArray(data) ? data : [];
    const row = rows[0] as { tournament?: RawBracketTournament | null; matches?: RawBracketMatch[] | null } | undefined;
    if (!row) return { tournament: null, matches: [] };
    return {
      tournament: normalizeTournament(row.tournament ?? null),
      matches: Array.isArray(row.matches) ? row.matches.map(normalizeMatch) : [],
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[bracket] getBracketBySlug threw:", err);
    return { tournament: null, matches: [] };
  }
});

// ════════════════════════════════════════════════════════════════════
// getPastWinners — gallery of champions for the footer
// ════════════════════════════════════════════════════════════════════

interface RawPastWinner {
  tournament_id?: string | null;
  slug?: string | null;
  name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  poster_url?: string | null;
  bracket_size?: number | null;
  champion_kill_id?: string | null;
  champion_killer_champion?: string | null;
  champion_victim_champion?: string | null;
  champion_killer_name?: string | null;
  champion_thumbnail?: string | null;
  champion_multi_kill?: string | null;
  champion_first_blood?: boolean | null;
}

export const getPastWinners = cache(async function getPastWinners(
  limit = 12,
): Promise<PastWinner[]> {
  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb.rpc("fn_get_past_winners", {
      p_limit: limit,
    });
    if (error) {
      console.warn("[bracket] getPastWinners rpc error:", error.message);
      return [];
    }
    const rows = (data ?? []) as RawPastWinner[];
    return rows.map((r) => ({
      tournament_id: String(r.tournament_id ?? ""),
      slug: String(r.slug ?? ""),
      name: String(r.name ?? ""),
      start_date: String(r.start_date ?? ""),
      end_date: String(r.end_date ?? ""),
      status: String(r.status ?? "closed"),
      poster_url: r.poster_url ?? null,
      bracket_size: Number(r.bracket_size ?? 64),
      champion_kill_id: r.champion_kill_id ?? null,
      champion_killer_champion: r.champion_killer_champion ?? null,
      champion_victim_champion: r.champion_victim_champion ?? null,
      champion_killer_name: r.champion_killer_name ?? null,
      champion_thumbnail: r.champion_thumbnail ?? null,
      champion_multi_kill: r.champion_multi_kill ?? null,
      champion_first_blood: Boolean(r.champion_first_blood),
    }));
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[bracket] getPastWinners threw:", err);
    return [];
  }
});
