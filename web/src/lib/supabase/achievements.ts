/**
 * Server + client loaders for the Achievements / Badge surface.
 *
 * Mirrors the pattern in lib/supabase/quotes.ts :
 *   * `cache()` for per-render dedup on Server Components
 *   * `rethrowIfDynamic()` in every catch so cookies-based render bubbles
 *     correctly through to Next's dynamic-detection sentinel
 *   * `createAnonSupabase()` (build-time / sitemap) vs
 *     `createServerSupabase()` (request scope with session cookie)
 *
 * The legacy `profiles.badges JSONB` column from migration 001 is left
 * intact ; the BadgeChip on /settings still reads it. Everything in this
 * file is the NEW system (`user_achievements` + `session_achievements`).
 */

import "server-only";

import { cache } from "react";

import { createAnonSupabase, createServerSupabase, rethrowIfDynamic } from "./server";

// ════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════

export type AchievementRarity = "common" | "rare" | "epic" | "legendary";

export type AchievementCategory =
  | "engagement"
  | "curator"
  | "social"
  | "collector"
  | "predictor"
  | "community";

/** One row of the user-facing catalogue. `earned_at` is `null` when the
 *  badge is still locked. `progress` is the snapshot of counters used to
 *  draw the progress bar — see fn_user_achievement_stats for the keys. */
export interface AchievementRow {
  slug: string;
  name: string;
  description: string;
  icon: string;
  rarity: AchievementRarity;
  category: AchievementCategory;
  points: number;
  criteria: Record<string, unknown>;
  earned_at: string | null;
  progress: AchievementProgress | null;
}

/** Snapshot of every counter the evaluator might check. Lined up
 *  one-to-one with the RETURNS TABLE of fn_user_achievement_stats. */
export interface AchievementProgress {
  ratings_count?: number;
  ratings_5star_count?: number;
  comments_count?: number;
  vs_battles_count?: number;
  face_off_votes_count?: number;
  bracket_votes_count?: number;
  compilations_count?: number;
  bcc_punches_count?: number;
  bcc_tomatoes_count?: number;
  bcc_ahou_plays_count?: number;
  shares_count?: number;
  distinct_eras_visited?: number;
  distinct_visit_days?: number;
  completed_clip_views?: number;
  first_hour_votes_count?: number;
  bcc_unlocked?: boolean;
  completed_bracket?: boolean;
  /** Set by fn_award_achievement for direct awards. */
  awarded?: boolean;
}

/** Row shape returned by fn_global_recent_unlocks. `display_name` may
 *  be null for anonymous sessions — UI falls back to "Un membre BCC". */
export interface RecentUnlockRow {
  slug: string;
  name: string;
  icon: string;
  rarity: AchievementRarity;
  earned_at: string;
  display_name: string | null;
}

/** Single-call result of evaluating a user — used by client actions
 *  that fire-and-forget after a successful rating/comment/vote. */
export interface AchievementUnlock {
  slug: string;
  name: string;
  rarity: AchievementRarity;
  points: number;
}

/** Aggregated stats for the sidebar "Mon score" widget. */
export interface UserPointsSummary {
  total_points: number;
  earned_count: number;
  total_count: number;
  /** Bronze / Silver / Gold / Platinum / Diamond. */
  tier: "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond";
  /** Points needed to reach the next tier ; 0 when already diamond. */
  points_to_next: number;
}

const TIERS: Array<{ name: UserPointsSummary["tier"]; threshold: number }> = [
  { name: "Bronze",   threshold: 0 },
  { name: "Silver",   threshold: 50 },
  { name: "Gold",     threshold: 200 },
  { name: "Platinum", threshold: 500 },
  { name: "Diamond",  threshold: 1000 },
];

/** Walk the tier ladder and return the current tier + remaining points. */
export function computeTier(points: number): UserPointsSummary {
  // Same shape as UserPointsSummary minus the totals — caller fills.
  let tier: UserPointsSummary["tier"] = "Bronze";
  let next: number = TIERS[1]!.threshold;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (points >= TIERS[i]!.threshold) {
      tier = TIERS[i]!.name;
      next = i === TIERS.length - 1 ? 0 : TIERS[i + 1]!.threshold - points;
      break;
    }
  }
  return {
    total_points: points,
    earned_count: 0,
    total_count: 0,
    tier,
    points_to_next: Math.max(0, next),
  };
}

// ════════════════════════════════════════════════════════════════════
// Public read — anonymous-safe catalogue + per-user state
// ════════════════════════════════════════════════════════════════════

/**
 * Pull the catalogue + earned state for the current viewer.
 *
 * Resolution :
 *   1. If the request scope has an authed user, RPC with their user_id.
 *   2. Otherwise pass the session_hash from the caller (cookie / header).
 *   3. With neither, return the unfiltered catalogue (all locked).
 *
 * Anon `sessionHash` is optional — the page server-component reads it
 * from the same cookie the rest of the app uses (kc_session_id) ; if the
 * cookie isn't set yet the catalogue still renders with all badges
 * locked, the client-side toast component will set the cookie on first
 * interaction.
 */
export const getUserAchievements = cache(async function getUserAchievements(
  sessionHash: string | null,
  opts: { buildTime?: boolean } = {},
): Promise<AchievementRow[]> {
  try {
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();

    let userId: string | null = null;
    if (!opts.buildTime) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        userId = user?.id ?? null;
      } catch {
        // anon — keep going with sessionHash only
      }
    }

    const { data, error } = await supabase.rpc("fn_user_achievements", {
      p_user_id:      userId,
      p_session_hash: sessionHash && sessionHash.length >= 16 ? sessionHash : null,
    });
    if (error) {
      console.warn("[achievements] getUserAchievements rpc error:", error.message);
      return [];
    }
    return ((data as AchievementRow[] | null) ?? []).map(normalizeRow);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[achievements] getUserAchievements threw:", err);
    return [];
  }
});

/**
 * Build the "Mon score" sidebar payload. Computed in TS rather than SQL
 * because the tier ladder is a product decision we want to iterate on
 * without a migration each time.
 */
export const getUserPointsSummary = cache(async function getUserPointsSummary(
  sessionHash: string | null,
): Promise<UserPointsSummary> {
  const rows = await getUserAchievements(sessionHash);
  let earned = 0;
  let points = 0;
  for (const row of rows) {
    if (row.earned_at) {
      earned += 1;
      points += row.points;
    }
  }
  const base = computeTier(points);
  return {
    ...base,
    earned_count: earned,
    total_count: rows.length,
  };
});

/**
 * Community feed : last N unlocks across all users + sessions.
 * Public RPC — no auth required.
 */
export const getRecentUnlocks = cache(async function getRecentUnlocks(
  limit = 10,
  opts: { buildTime?: boolean } = {},
): Promise<RecentUnlockRow[]> {
  try {
    const supabase = opts.buildTime
      ? createAnonSupabase()
      : await createServerSupabase();
    const { data, error } = await supabase.rpc("fn_global_recent_unlocks", {
      p_limit: Math.max(1, Math.min(limit, 50)),
    });
    if (error) {
      console.warn("[achievements] getRecentUnlocks rpc error:", error.message);
      return [];
    }
    return ((data as RecentUnlockRow[] | null) ?? []).map(normalizeUnlock);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[achievements] getRecentUnlocks threw:", err);
    return [];
  }
});

// ════════════════════════════════════════════════════════════════════
// Client-callable RPCs (fire-and-forget after key actions)
// ════════════════════════════════════════════════════════════════════

/**
 * Fires after rating / comment / vote / share — asks Supabase to
 * re-check criteria for the caller and award any newly-earned badges.
 *
 * Authed call : passes user_id. Anon call : passes session_hash (the
 * caller is responsible for generating + persisting the 16-char hex).
 *
 * Returns the list of slugs that were newly earned during this call so
 * the client can pop the toast.
 */
export async function evaluateAchievements(
  opts: { userId?: string | null; sessionHash?: string | null } = {},
): Promise<AchievementUnlock[]> {
  const { userId, sessionHash } = opts;
  try {
    const supabase = await createServerSupabase();
    let rpc: string;
    let body: Record<string, string | null>;
    if (userId) {
      rpc = "fn_evaluate_user_achievements";
      body = { p_user_id: userId };
    } else if (sessionHash && sessionHash.length >= 16) {
      rpc = "fn_evaluate_session_achievements";
      body = { p_session_hash: sessionHash };
    } else {
      return [];
    }
    const { data, error } = await supabase.rpc(rpc, body);
    if (error) {
      console.warn("[achievements] evaluate rpc error:", error.message);
      return [];
    }
    return ((data as AchievementUnlock[] | null) ?? []).map(normalizeUnlock);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[achievements] evaluate threw:", err);
    return [];
  }
}

/**
 * Direct admin / event-triggered award (bypasses criteria evaluation).
 * Used by the konami-code handler and any future "give X to user Y" flow.
 */
export async function awardAchievement(
  slug: string,
  opts: { userId?: string | null; sessionHash?: string | null } = {},
): Promise<boolean> {
  if (!slug) return false;
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("fn_award_achievement", {
      p_user_id:      opts.userId ?? null,
      p_session_hash: opts.sessionHash ?? null,
      p_slug:         slug,
    });
    if (error) {
      console.warn("[achievements] award rpc error:", error.message);
      return false;
    }
    return Boolean(data);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[achievements] award threw:", err);
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════
// Display helpers (pure — safe to import from client components)
// ════════════════════════════════════════════════════════════════════

/** Hex color per rarity. Matches the migration's seed palette. */
export const RARITY_COLOR: Record<AchievementRarity, string> = {
  common:    "#A09B8C",
  rare:      "#0AC8B9",
  epic:      "#A855F7",
  legendary: "#C8AA6E",
};

/** Localised label per rarity. */
export const RARITY_LABEL: Record<AchievementRarity, string> = {
  common:    "Commun",
  rare:      "Rare",
  epic:      "Épique",
  legendary: "Légendaire",
};

/** Localised label per category. */
export const CATEGORY_LABEL: Record<AchievementCategory, string> = {
  engagement: "Engagement",
  curator:    "Curation",
  social:     "Social",
  collector:  "Collection",
  predictor:  "Prédicteur",
  community:  "Communauté",
};

/** Progress percent for one criterion. Returns null when the criterion
 *  is a boolean flag (bcc_unlocked, high_rating_on_top, etc.) since
 *  those don't have a meaningful 0-100% bar. */
export function computeProgressPercent(
  criteria: Record<string, unknown>,
  progress: AchievementProgress | null,
): number | null {
  if (!progress) return null;
  // Map each criterion key to the matching counter on progress.
  const mapping: Record<string, keyof AchievementProgress> = {
    min_ratings:          "ratings_count",
    min_comments:         "comments_count",
    min_vs_battles:       "vs_battles_count",
    min_face_off_votes:   "face_off_votes_count",
    min_bracket_votes:    "bracket_votes_count",
    min_compilations:     "compilations_count",
    min_punches:          "bcc_punches_count",
    min_tomatoes:         "bcc_tomatoes_count",
    min_ahou_plays:       "bcc_ahou_plays_count",
    min_shares:           "shares_count",
    distinct_visit_days:  "distinct_visit_days",
    distinct_eras_visited: "distinct_eras_visited",
    completed_clip_views: "completed_clip_views",
  };
  for (const [key, target] of Object.entries(mapping)) {
    if (!(key in criteria)) continue;
    const need = Number((criteria as Record<string, unknown>)[key] ?? 0);
    if (!need || need <= 0) continue;
    const have = Number(progress[target] ?? 0);
    return Math.max(0, Math.min(100, (have / need) * 100));
  }
  return null;
}

/** Numeric counter for the "X / Y" label below the progress bar. */
export function describeProgress(
  criteria: Record<string, unknown>,
  progress: AchievementProgress | null,
): { have: number; need: number } | null {
  if (!progress) return null;
  const mapping: Record<string, keyof AchievementProgress> = {
    min_ratings:          "ratings_count",
    min_comments:         "comments_count",
    min_vs_battles:       "vs_battles_count",
    min_face_off_votes:   "face_off_votes_count",
    min_bracket_votes:    "bracket_votes_count",
    min_compilations:     "compilations_count",
    min_punches:          "bcc_punches_count",
    min_tomatoes:         "bcc_tomatoes_count",
    min_ahou_plays:       "bcc_ahou_plays_count",
    min_shares:           "shares_count",
    distinct_visit_days:  "distinct_visit_days",
    distinct_eras_visited: "distinct_eras_visited",
    completed_clip_views: "completed_clip_views",
  };
  for (const [key, target] of Object.entries(mapping)) {
    if (!(key in criteria)) continue;
    const need = Number((criteria as Record<string, unknown>)[key] ?? 0);
    if (!need || need <= 0) continue;
    const have = Number(progress[target] ?? 0);
    return { have, need };
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
// Internal normalisers
// ════════════════════════════════════════════════════════════════════

function normalizeRow(row: AchievementRow): AchievementRow {
  return {
    slug:        String(row.slug ?? ""),
    name:        String(row.name ?? ""),
    description: String(row.description ?? ""),
    icon:        String(row.icon ?? "?"),
    rarity:      (row.rarity ?? "common") as AchievementRarity,
    category:    (row.category ?? "engagement") as AchievementCategory,
    points:      Number(row.points ?? 0),
    criteria:    (row.criteria ?? {}) as Record<string, unknown>,
    earned_at:   row.earned_at ?? null,
    progress:    (row.progress ?? null) as AchievementProgress | null,
  };
}

function normalizeUnlock<T extends { slug?: string; name?: string; rarity?: string }>(
  row: T,
): AchievementUnlock & T {
  return {
    ...row,
    slug:   String(row.slug ?? ""),
    name:   String(row.name ?? ""),
    rarity: (row.rarity ?? "common") as AchievementRarity,
    points: Number((row as unknown as { points?: number }).points ?? 0),
  } as AchievementUnlock & T;
}
