/**
 * Achievement / Badge — client-safe types, constants, and pure helpers.
 *
 * Split off `achievements.ts` (Wave 30o) because the parent file imports
 * `"server-only"` + `./server` (cookies()) — which poisons every client
 * component that just wants the catalogue types. This file has ZERO
 * runtime dependencies (no react cache, no supabase-js, no next/headers)
 * so it bundles cleanly into both the server and client targets.
 *
 * Anything that needs DB access lives in `achievements.ts` (server-only).
 * Anything that's a pure shape, lookup table, or arithmetic helper lives
 * here.
 */

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
// Display constants — safe to import from client components
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

// ════════════════════════════════════════════════════════════════════
// Pure progress helpers
// ════════════════════════════════════════════════════════════════════

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
