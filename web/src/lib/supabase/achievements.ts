/**
 * Server-only loaders for the Achievements / Badge surface.
 *
 * Wave 30o split : all pure types, constants, and helper functions moved
 * to `./achievements-types` so client components can import them without
 * dragging `"server-only"` + `next/headers` into the browser bundle.
 *
 * This file keeps ONLY the cookies-aware fetchers + RPC wrappers :
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
import type {
  AchievementProgress,
  AchievementRarity,
  AchievementRow,
  AchievementUnlock,
  RecentUnlockRow,
  UserPointsSummary,
} from "./achievements-types";
import { computeTier } from "./achievements-types";

// ════════════════════════════════════════════════════════════════════
// Re-exports — keep existing server callers ("@/lib/supabase/achievements")
// working without changing every import. New code should prefer importing
// types/constants/helpers directly from "./achievements-types".
// ════════════════════════════════════════════════════════════════════

export type {
  AchievementRarity,
  AchievementCategory,
  AchievementRow,
  AchievementProgress,
  RecentUnlockRow,
  AchievementUnlock,
  UserPointsSummary,
} from "./achievements-types";

export {
  RARITY_COLOR,
  RARITY_LABEL,
  CATEGORY_LABEL,
  computeTier,
  computeProgressPercent,
  describeProgress,
} from "./achievements-types";

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
// Internal normalisers
// ════════════════════════════════════════════════════════════════════

function normalizeRow(row: AchievementRow): AchievementRow {
  return {
    slug:        String(row.slug ?? ""),
    name:        String(row.name ?? ""),
    description: String(row.description ?? ""),
    icon:        String(row.icon ?? "?"),
    rarity:      (row.rarity ?? "common") as AchievementRarity,
    category:    (row.category ?? "engagement") as AchievementRow["category"],
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
