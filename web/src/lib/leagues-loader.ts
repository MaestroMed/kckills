/**
 * Leagues loader — server-side reads of the `leagues` catalog (migration 043).
 *
 * Used by the `/api/leagues` route, the `<LeagueNav />` chip strip, and
 * the `/league/[slug]` hub page.
 *
 * Env-gated visibility :
 *   * `NEXT_PUBLIC_LOLTOK_PUBLIC=false` (default, KC pilot mode) → only
 *     leagues marked `active = true` AND in the worker's tracked set are
 *     returned. In practice that's just the LEC for the pilot.
 *   * `NEXT_PUBLIC_LOLTOK_PUBLIC=true` (LoLTok mode) → every active
 *     league is returned, ordered by priority (LEC=10 first, then LCS,
 *     LCK, LPL, LFL, regional ERLs, internationals).
 *
 * Schema reference (supabase/migrations/043_leagues_table.sql) :
 *   leagues(slug, name, short_name, region, lolesports_league_id,
 *           leaguepedia_name, golgg_tournament_pattern, priority,
 *           active, created_at, updated_at)
 *
 * Anonymous access — no PII, public catalog. We use createAnonSupabase
 * to stay safe in build-time / generateStaticParams contexts.
 */

import "server-only";
import { cache } from "react";
import { createAnonSupabase, rethrowIfDynamic } from "./supabase/server";

export interface LeagueRow {
  /** Short canonical key — `lec`, `lcs`, `lck`, `lpl`, `lfl`, `worlds`. */
  slug: string;
  /** Full display name — "LoL EMEA Championship". */
  name: string;
  /** Compact UI label — "LEC", used in chips and badges. */
  short_name: string;
  /** Continental region — "EMEA" / "Americas" / "Korea" / "China". */
  region: string;
  /** Lower = higher visual priority. KC home league (LEC) is `10`. */
  priority: number;
  /** Soft-disable flag from the catalog. Inactive leagues are filtered
   *  out of the nav unless an admin override is set. */
  active: boolean;
}

/**
 * Hard-coded fallback — used when the `leagues` table doesn't exist yet
 * (migration 043 hasn't run on this DB) so the API route still answers
 * gracefully. Mirrors the canonical priority ordering documented in
 * 043_leagues_table.sql so the navbar is identical pre/post migration.
 *
 * KC pilot mode (NEXT_PUBLIC_LOLTOK_PUBLIC=false) only ships LEC, which
 * matches the byte-identical-to-today contract in the agent brief.
 */
const FALLBACK_LEAGUES: LeagueRow[] = [
  { slug: "lec",  name: "LoL EMEA Championship", short_name: "LEC", region: "EMEA",     priority: 10, active: true },
  { slug: "lcs",  name: "LoL Championship Series", short_name: "LCS", region: "Americas", priority: 20, active: true },
  { slug: "lck",  name: "LoL Champions Korea",   short_name: "LCK", region: "Korea",    priority: 30, active: true },
  { slug: "lpl",  name: "LoL Pro League",        short_name: "LPL", region: "China",    priority: 40, active: true },
  { slug: "lfl",  name: "La Ligue Française",    short_name: "LFL", region: "EMEA",     priority: 50, active: true },
];

/**
 * Read the `NEXT_PUBLIC_LOLTOK_PUBLIC` env at module load time. Mirrors
 * the helper in teams-loader.ts so callers can centralise the gate.
 */
export function isLoltokPublic(): boolean {
  return process.env.NEXT_PUBLIC_LOLTOK_PUBLIC === "true";
}

/**
 * Fetch every active league. Falls back to the hardcoded constant when
 * the table doesn't exist (KC pilot DB pre-migration 043) so the UI
 * never breaks during the rollout window.
 */
export const getLeagues = cache(async function getLeagues(): Promise<LeagueRow[]> {
  try {
    const supabase = createAnonSupabase();
    const { data, error } = await supabase
      .from("leagues")
      .select("slug, name, short_name, region, priority, active")
      .eq("active", true)
      .order("priority", { ascending: true });
    if (error) {
      // Likely cause : migration 043 hasn't run on this DB.
      // Fail soft so the navbar still renders the canonical big-five.
      console.warn("[leagues-loader] getLeagues error, using fallback:", error.message);
      return FALLBACK_LEAGUES;
    }
    if (!data || data.length === 0) {
      return FALLBACK_LEAGUES;
    }
    return data.map((r) => ({
      slug: String(r.slug ?? ""),
      name: String(r.name ?? ""),
      short_name: String(r.short_name ?? r.slug ?? ""),
      region: String(r.region ?? ""),
      priority: Number(r.priority ?? 100),
      active: Boolean(r.active),
    }));
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[leagues-loader] getLeagues threw, using fallback:", err);
    return FALLBACK_LEAGUES;
  }
});

/**
 * Get a single league by slug. Returns null on miss.
 */
export const getLeagueBySlug = cache(async function getLeagueBySlug(
  slug: string,
): Promise<LeagueRow | null> {
  const all = await getLeagues();
  return all.find((l) => l.slug === slug) ?? null;
});

/**
 * Apply the env gate. KC pilot mode keeps only LEC (the home league),
 * keeping the public surface identical to today.
 */
export function filterLeaguesForPublic(leagues: LeagueRow[]): LeagueRow[] {
  if (isLoltokPublic()) return leagues;
  return leagues.filter((l) => l.slug === "lec");
}
