/**
 * Teams loader — server-side reads of the `teams` catalog from Supabase.
 *
 * Used by the `/api/teams` route and the new generic `/team/[slug]` page.
 *
 * Env-gated visibility :
 *   * `NEXT_PUBLIC_LOLTOK_PUBLIC=false` (default, KC pilot mode) →
 *     only `is_tracked = true` teams are returned. KC home stays focused.
 *   * `NEXT_PUBLIC_LOLTOK_PUBLIC=true` (LoLTok mode) → every team in
 *     the catalog is returned, sorted by league → name.
 *
 * Anonymous-only access — the `teams` table has a public read RLS policy
 * (no PII). We use `createAnonSupabase` because this loader runs from
 * route handlers + server components that may not have a request scope
 * (sitemap, generateStaticParams).
 *
 * Returned shape is intentionally narrow (slug, code, name, region,
 * league, logo_url) so the wire payload stays small — the frontend's
 * TeamSelector + LeagueNav only need those columns.
 */

import "server-only";
import { cache } from "react";
import { createAnonSupabase, rethrowIfDynamic } from "./supabase/server";

export interface TeamRow {
  /** Unique URL-safe slug — used as the route param for `/team/[slug]`. */
  slug: string;
  /** Short uppercase code ("KC", "G2", "FNC") — used in chips and badges. */
  code: string;
  /** Full display name ("Karmine Corp", "G2 Esports"). */
  name: string;
  /** ISO region label ("EMEA", "Americas", "Korea", …) — may be null
   *  for legacy rows that were imported before the region column got
   *  populated. The UI degrades to "—" when null. */
  region: string | null;
  /** League slug ("lec", "lcs", "lck", "lpl", "lfl"…) — derived from
   *  the leagues join when the migration 043 FK is wired. NULL on
   *  legacy rows where we don't yet know the league. */
  league: string | null;
  /** R2 / lolesports CDN logo URL. NULL when the worker hasn't fetched
   *  it yet — the UI falls back to the team code badge. */
  logo_url: string | null;
  /** True if the team is in the active tracked set (KC pilot mode
   *  surfaces only these). The full LoLTok mode returns every team
   *  regardless. */
  is_tracked: boolean;
}

/**
 * Read the `NEXT_PUBLIC_LOLTOK_PUBLIC` env at module load time. This
 * is exposed to the client bundle so server + client agree on whether
 * LoLTok navigation is on. Defaults to `false` (KC pilot mode).
 */
export function isLoltokPublic(): boolean {
  return process.env.NEXT_PUBLIC_LOLTOK_PUBLIC === "true";
}

/**
 * Fetch the full team list. React-cached so multiple components in the
 * same render pass dedupe their Supabase reads.
 */
export const getTeams = cache(async function getTeams(): Promise<TeamRow[]> {
  try {
    const supabase = createAnonSupabase();
    // Build the raw query. We ALWAYS select the full set of fields ;
    // the env gate is applied client-side after the fetch so we don't
    // have two divergent code paths.
    //
    // The teams table schema (db/schema.sql) carries `slug`, `code` (KC
    // pilot variant uses `short_name`, harmonised below), `name`,
    // `logo_url`, `region`, `is_tracked`. The 001 LoLTok migration adds
    // `code` directly. We accept either column name to stay compatible
    // across the two schema heads.
    const { data, error } = await supabase
      .from("teams")
      .select("slug, code, name, region, logo_url, is_tracked, league_id, leagues(slug)")
      .order("name", { ascending: true });

    if (error) {
      // Fallback : the join on `leagues` may fail on schemas where the
      // FK isn't wired yet (KC pilot DB, prior to migration 043 having
      // run). Retry without the join so the page still renders.
      const retry = await supabase
        .from("teams")
        .select("slug, code, name, region, logo_url, is_tracked")
        .order("name", { ascending: true });
      if (retry.error) {
        console.warn("[teams-loader] getTeams error:", retry.error.message);
        return [];
      }
      return normalizeTeams(retry.data ?? []);
    }
    return normalizeTeams(data ?? []);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[teams-loader] getTeams threw:", err);
    return [];
  }
});

/**
 * Get a single team by slug. Returns null on miss.
 *
 * Always returns the row regardless of `NEXT_PUBLIC_LOLTOK_PUBLIC` —
 * we don't want a deep-link to break in pilot mode if someone shares a
 * `/team/g2-esports` URL. The HTTP route handler can still 404 on env
 * mismatch, but the loader stays permissive.
 */
export const getTeamBySlug = cache(async function getTeamBySlug(
  slug: string,
): Promise<TeamRow | null> {
  try {
    const supabase = createAnonSupabase();
    const { data, error } = await supabase
      .from("teams")
      .select("slug, code, name, region, logo_url, is_tracked, league_id, leagues(slug)")
      .eq("slug", slug)
      .maybeSingle();
    if (error) {
      const retry = await supabase
        .from("teams")
        .select("slug, code, name, region, logo_url, is_tracked")
        .eq("slug", slug)
        .maybeSingle();
      if (retry.error) {
        console.warn("[teams-loader] getTeamBySlug error:", retry.error.message);
        return null;
      }
      const arr = normalizeTeams(retry.data ? [retry.data] : []);
      return arr[0] ?? null;
    }
    const arr = normalizeTeams(data ? [data] : []);
    return arr[0] ?? null;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[teams-loader] getTeamBySlug threw:", err);
    return null;
  }
});

/**
 * Get teams filtered by league slug. Used by `/league/[slug]` page.
 *
 * Returns an empty array on miss (unknown league) or when the league
 * column hasn't been backfilled yet on the matching rows.
 */
export const getTeamsByLeague = cache(async function getTeamsByLeague(
  leagueSlug: string,
): Promise<TeamRow[]> {
  const all = await getTeams();
  return all.filter((t) => t.league === leagueSlug);
});

/**
 * Apply the `NEXT_PUBLIC_LOLTOK_PUBLIC` env filter. In KC pilot mode
 * we keep only `is_tracked` teams ; otherwise everything goes through.
 */
export function filterTeamsForPublic(teams: TeamRow[]): TeamRow[] {
  if (isLoltokPublic()) return teams;
  return teams.filter((t) => t.is_tracked);
}

// ─── Team-scoped kills + matches ──────────────────────────────────────

/**
 * Compact projection of a kill row for the generic team page. We keep
 * this narrow on purpose — the team page only needs enough to render
 * the recent-kills strip, NOT the full /scroll feed shape.
 *
 * NB : we intentionally don't reuse PublishedKillRow here because that
 * type pulls in 30+ fields the team page never reads, which would
 * inflate the wire payload + bundle size. If the team page ever grows
 * to need full kill detail, switch to PublishedKillRow at that point.
 */
export interface TeamKillCard {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  thumbnail_url: string | null;
  clip_url_vertical: string | null;
  highlight_score: number | null;
  ai_description_fr: string | null;
  ai_description: string | null;
  created_at: string;
  match_external_id: string | null;
}

interface RawKillCard {
  id?: string | null;
  killer_champion?: string | null;
  victim_champion?: string | null;
  thumbnail_url?: string | null;
  clip_url_vertical?: string | null;
  highlight_score?: number | null;
  ai_description_fr?: string | null;
  ai_description?: string | null;
  created_at?: string | null;
  games?:
    | { matches?: { external_id?: string | null } | { external_id?: string | null }[] | null }
    | { matches?: { external_id?: string | null } | { external_id?: string | null }[] | null }[]
    | null;
}

/**
 * Recent published kills involving the given team (as either side).
 *
 * Why not extend `getKillsForGrid` ? — that loader is owned by the
 * shared kills module and KC-flavoured (KC's `tracked_team_involvement`
 * column is the source of truth for the pilot). The generic team page
 * needs to reason about ANY team, so we filter via the
 * `games.matches.team_blue_id` / `team_red_id` join instead.
 *
 * Strategy :
 *   1. Resolve team slug → team UUID via the teams table (cached).
 *   2. Query `kills` with two joins to `matches` filtered on either
 *      blue OR red being this team's id, plus the standard published-
 *      visible-clip predicates.
 *
 * Returns `[]` on any error so the page degrades to "no kills yet"
 * rather than 500-ing.
 */
export const getRecentKillsForTeam = cache(async function getRecentKillsForTeam(
  teamSlug: string,
  limit: number = 24,
): Promise<TeamKillCard[]> {
  try {
    const supabase = createAnonSupabase();

    // Resolve slug → id via a one-shot select. We can't use
    // getTeamBySlug here because that returns the projected row
    // shape (no internal id).
    const { data: teamRow, error: teamErr } = await supabase
      .from("teams")
      .select("id")
      .eq("slug", teamSlug)
      .maybeSingle();
    if (teamErr || !teamRow?.id) {
      if (teamErr) console.warn("[teams-loader] team resolve error:", teamErr.message);
      return [];
    }
    const teamId = teamRow.id as string;

    // Two parallel queries (one per side) — supabase-js doesn't
    // support OR filters across nested join columns directly.
    const SELECT = `
      id,
      killer_champion,
      victim_champion,
      thumbnail_url,
      clip_url_vertical,
      highlight_score,
      ai_description_fr,
      ai_description,
      created_at,
      games!inner (
        matches!inner (
          external_id,
          team_blue_id,
          team_red_id
        )
      )
    `.trim();

    const [blueRes, redRes] = await Promise.all([
      supabase
        .from("kills")
        .select(SELECT)
        .or(
          "publication_status.eq.published," +
            "and(publication_status.is.null,status.eq.published)",
        )
        .eq("kill_visible", true)
        .not("clip_url_vertical", "is", null)
        .not("thumbnail_url", "is", null)
        .eq("games.matches.team_blue_id", teamId)
        .order("highlight_score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("kills")
        .select(SELECT)
        .or(
          "publication_status.eq.published," +
            "and(publication_status.is.null,status.eq.published)",
        )
        .eq("kill_visible", true)
        .not("clip_url_vertical", "is", null)
        .not("thumbnail_url", "is", null)
        .eq("games.matches.team_red_id", teamId)
        .order("highlight_score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    if (blueRes.error) console.warn("[teams-loader] team kills (blue) error:", blueRes.error.message);
    if (redRes.error) console.warn("[teams-loader] team kills (red) error:", redRes.error.message);

    const merged = new Map<string, TeamKillCard>();
    for (const raw of [...(blueRes.data ?? []), ...(redRes.data ?? [])]) {
      const card = projectKillCard(raw as RawKillCard);
      if (card && !merged.has(card.id)) merged.set(card.id, card);
    }

    return Array.from(merged.values())
      .sort((a, b) => {
        const sa = a.highlight_score ?? -1;
        const sb = b.highlight_score ?? -1;
        if (sb !== sa) return sb - sa;
        return (b.created_at || "").localeCompare(a.created_at || "");
      })
      .slice(0, limit);
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[teams-loader] getRecentKillsForTeam threw:", err);
    return [];
  }
});

function projectKillCard(row: RawKillCard): TeamKillCard | null {
  if (!row.id) return null;
  const games = Array.isArray(row.games) ? row.games[0] ?? null : row.games ?? null;
  let matchExtId: string | null = null;
  if (games) {
    const matches = Array.isArray(games.matches) ? games.matches[0] ?? null : games.matches ?? null;
    matchExtId = matches?.external_id ?? null;
  }
  return {
    id: String(row.id),
    killer_champion: row.killer_champion ?? null,
    victim_champion: row.victim_champion ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    clip_url_vertical: row.clip_url_vertical ?? null,
    highlight_score: row.highlight_score ?? null,
    ai_description_fr: row.ai_description_fr ?? null,
    ai_description: row.ai_description ?? null,
    created_at: String(row.created_at ?? ""),
    match_external_id: matchExtId,
  };
}

/**
 * Compact match row for league hub listings. Keeps the wire small —
 * just enough to render "KC vs G2 — 2026-04-05 — Spring".
 */
export interface LeagueMatchCard {
  external_id: string;
  scheduled_at: string | null;
  stage: string | null;
  format: string | null;
  team_blue: { code: string; name: string; slug: string } | null;
  team_red: { code: string; name: string; slug: string } | null;
  winner_code: string | null;
}

interface RawMatchCard {
  external_id?: string | null;
  scheduled_at?: string | null;
  stage?: string | null;
  format?: string | null;
  team_blue_id?: string | null;
  team_red_id?: string | null;
  winner_team_id?: string | null;
  league_id?: string | null;
}

/**
 * Recent matches for a league. The `matches.league_id` FK was added
 * in migration 043 ; legacy rows have NULL there. For backwards-
 * compat we ALSO accept matches where the tournament's league
 * matches via the slug — that's a follow-up wave (BB will backfill).
 *
 * Returns the most recent N matches across the league, sorted by
 * scheduled_at desc.
 */
export const getRecentMatchesForLeague = cache(async function getRecentMatchesForLeague(
  leagueSlug: string,
  limit: number = 24,
): Promise<LeagueMatchCard[]> {
  try {
    const supabase = createAnonSupabase();

    // Resolve league slug → id. Falls through to "no matches" when the
    // leagues table doesn't exist (migration 043 not run on this DB).
    const { data: leagueRow, error: leagueErr } = await supabase
      .from("leagues")
      .select("id")
      .eq("slug", leagueSlug)
      .maybeSingle();
    if (leagueErr || !leagueRow?.id) {
      if (leagueErr) console.warn("[teams-loader] league resolve error:", leagueErr.message);
      return [];
    }

    const { data, error } = await supabase
      .from("matches")
      .select(
        "external_id, scheduled_at, stage, format, team_blue_id, team_red_id, winner_team_id, league_id",
      )
      .eq("league_id", leagueRow.id)
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) {
      console.warn("[teams-loader] league matches error:", error.message);
      return [];
    }

    if (!data || data.length === 0) return [];

    // Pull all team rows referenced by these matches in one query so we
    // can build a code/name map without N+1 round-trips.
    const teamIds = new Set<string>();
    for (const m of data as RawMatchCard[]) {
      if (m.team_blue_id) teamIds.add(m.team_blue_id);
      if (m.team_red_id) teamIds.add(m.team_red_id);
    }
    const { data: teamRows } = await supabase
      .from("teams")
      .select("id, slug, code, name, short_name")
      .in("id", Array.from(teamIds));
    const teamLookup = new Map<string, { code: string; name: string; slug: string }>();
    for (const t of (teamRows ?? []) as { id: string; slug: string; code?: string | null; name: string; short_name?: string | null }[]) {
      teamLookup.set(t.id, {
        code: (t.code ?? t.short_name ?? t.slug.toUpperCase()).toString(),
        name: t.name,
        slug: t.slug,
      });
    }

    return (data as RawMatchCard[]).map((m) => {
      const blue = m.team_blue_id ? teamLookup.get(m.team_blue_id) ?? null : null;
      const red = m.team_red_id ? teamLookup.get(m.team_red_id) ?? null : null;
      const winner = m.winner_team_id ? teamLookup.get(m.winner_team_id) ?? null : null;
      return {
        external_id: String(m.external_id ?? ""),
        scheduled_at: m.scheduled_at ?? null,
        stage: m.stage ?? null,
        format: m.format ?? null,
        team_blue: blue,
        team_red: red,
        winner_code: winner?.code ?? null,
      } satisfies LeagueMatchCard;
    });
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[teams-loader] getRecentMatchesForLeague threw:", err);
    return [];
  }
});

// ─── Internals ────────────────────────────────────────────────────────

interface RawTeamRow {
  slug?: string | null;
  code?: string | null;
  short_name?: string | null;
  name?: string | null;
  region?: string | null;
  logo_url?: string | null;
  is_tracked?: boolean | null;
  league_id?: string | null;
  leagues?: { slug?: string | null } | { slug?: string | null }[] | null;
}

function normalizeTeams(rows: RawTeamRow[]): TeamRow[] {
  return rows
    .map((r) => {
      // Some pilot rows expose `short_name` instead of `code` ; harmonise.
      const code = (r.code ?? r.short_name ?? "").toString().trim();
      const slug = (r.slug ?? "").toString().trim();
      if (!slug) return null;
      const leagues = Array.isArray(r.leagues) ? r.leagues[0] ?? null : r.leagues ?? null;
      return {
        slug,
        code: code || slug.toUpperCase(),
        name: (r.name ?? code ?? slug).toString(),
        region: r.region ?? null,
        league: leagues?.slug ?? null,
        logo_url: r.logo_url ?? null,
        is_tracked: Boolean(r.is_tracked),
      } satisfies TeamRow;
    })
    .filter((x): x is TeamRow => x !== null);
}
