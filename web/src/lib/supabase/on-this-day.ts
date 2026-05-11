/**
 * "On This Day" — kills from the same calendar date in past years.
 *
 * Calls the Postgres RPC `fn_on_this_day(p_month, p_day, p_exclude_year,
 * p_limit)` defined in migration 060. The RPC joins kills→games→matches
 * and filters on `matches.scheduled_at` so the date is the actual match
 * date, not the worker's ingestion timestamp.
 *
 * Wave 28 (2026-05-11).
 */

import "server-only";
import { cache } from "react";
import { createAnonSupabase, rethrowIfDynamic } from "./server";

export type OnThisDayKill = {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  killer_ign: string | null;
  victim_ign: string | null;
  clip_url_vertical: string | null;
  clip_url_vertical_low: string | null;
  thumbnail_url: string | null;
  highlight_score: number | null;
  avg_rating: number | null;
  rating_count: number | null;
  multi_kill: string | null;
  is_first_blood: boolean | null;
  tracked_team_involvement: string | null;
  ai_description: string | null;
  match_date: string;          // ISO timestamptz
  years_ago: number;            // computed by the RPC (current_year - match_year)
  match_stage: string | null;
};

/** Fetch up to `limit` published kills that happened on (month, day) in
 *  past years (current year excluded). Returns [] on any failure.
 *
 *  Cached per-request so the homepage server component can call it from
 *  multiple sections without N round-trips.
 */
export const getOnThisDayKills = cache(async (
  month: number,
  day: number,
  limit = 12,
): Promise<OnThisDayKill[]> => {
  // Defensive : the RPC short-circuits on invalid month/day but we want
  // to fail loud locally so dev errors surface.
  if (month < 1 || month > 12 || day < 1 || day > 31) return [];

  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb
      .rpc("fn_on_this_day", {
        p_month: month,
        p_day: day,
        p_exclude_year: 0,        // use the SQL default = current year
        p_limit: limit,
      });
    if (error) {
      // Don't throw on the homepage RSC — degrade silently.
      // eslint-disable-next-line no-console
      console.warn("[on-this-day] rpc error", error.message);
      return [];
    }
    return (data ?? []) as OnThisDayKill[];
  } catch (e) {
    rethrowIfDynamic(e);
    // eslint-disable-next-line no-console
    console.warn("[on-this-day] exception", e);
    return [];
  }
});

/** Returns (month, day) for today in UTC. The homepage's "today" is
 *  UTC-locked so every visitor sees the same On-This-Day card regardless
 *  of timezone — a French fan and a Korean fan both see Caliste's
 *  2025-05-11 penta on May 11.
 */
export function getTodayMonthDay(): { month: number; day: number } {
  const now = new Date();
  return {
    month: now.getUTCMonth() + 1,  // getUTCMonth is 0-indexed
    day:   now.getUTCDate(),
  };
}
