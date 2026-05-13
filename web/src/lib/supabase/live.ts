/**
 * Live-match helpers — surface the currently-running KC match and the
 * freshly-published kills that belong to it.
 *
 * Used by :
 *   - /api/live/state   — REST shim consumed by <LiveHotNow /> + /live page
 *   - /live             — dedicated live-feed page (server shell)
 *
 * Why a dedicated helper rather than reusing supabase/kills.ts ?
 *   * the live polling cadence wants the LATEST kills for ONE specific
 *     match (matchId scoping + event_epoch DESC), not the highlight-score
 *     leaderboard the global feed serves.
 *   * the match-detection logic ("which match is live right now ?")
 *     belongs next to the kill helpers so the route handler is a thin
 *     shim — no business logic in the API layer.
 *
 * NEVER imported from a client component (server-only).
 */

import "server-only";
import { createAnonSupabase, createServerSupabase, rethrowIfDynamic } from "./server";

/**
 * Minimal shape of a live match, scoped to what the banner + /live
 * page need to render. Avoids the full Match join from match.ts so
 * the polling endpoint stays cheap on egress.
 */
export interface LiveMatchRow {
  id: string;
  external_id: string;
  scheduled_at: string | null;
  state: string | null;
  format: string | null;
  stage: string | null;
  team_blue_id: string | null;
  team_red_id: string | null;
  blue: LiveMatchTeam | null;
  red: LiveMatchTeam | null;
  /** Convenience flag — true when KC is on either side. The live banner
   *  only fires for KC matches by design, but the helper itself is team-
   *  agnostic so we can reuse it for other tracked teams later. */
  has_kc: boolean;
  /** The KC-vs-opponent matchup label used in the banner header. NULL
   *  when neither side is tagged as tracked, which shouldn't happen in
   *  the live window (the sentinel only writes matches that involve a
   *  tracked team) but we degrade gracefully if it does. */
  matchup_label: string | null;
}

export interface LiveMatchTeam {
  id: string;
  name: string;
  code: string;
  slug: string;
  logo_url: string | null;
  is_tracked: boolean;
}

/**
 * Pared-down kill row for live polling — only the fields the banner
 * + /live feed actually render. Keeps the per-poll payload under
 * ~1 KB even with 3-5 kills attached, so a 10s cadence over 90 min
 * stays well under the Supabase free-tier egress budget.
 */
export interface LiveKillRow {
  id: string;
  game_id: string;
  game_number: number | null;
  event_epoch: number | null;
  game_time_seconds: number | null;
  killer_player_id: string | null;
  killer_champion: string | null;
  victim_champion: string | null;
  tracked_team_involvement: string | null;
  multi_kill: string | null;
  is_first_blood: boolean;
  highlight_score: number | null;
  ai_description: string | null;
  ai_description_fr: string | null;
  thumbnail_url: string | null;
  clip_url_vertical: string | null;
  clip_url_vertical_low: string | null;
  clip_url_horizontal: string | null;
  created_at: string;
}

// ───────────────────────────────────────────────────────────────────
// Match detection
// ───────────────────────────────────────────────────────────────────

/**
 * Window around `now` we consider a "candidate live match". When the
 * worker is healthy, matches.state flips to 'live' as soon as the
 * broadcast starts (sentinel maps lolesports inProgress → live). But the
 * sentinel polls every 5 min and might lag — so we also accept a match
 * whose `scheduled_at` is within ±4h AND state is still 'upcoming'/'live'.
 *
 * The +4h tail covers BO5 grand finals that run long. The -1h head
 * covers early-bird streams (open standings shows, pre-match panels).
 */
const LIVE_WINDOW_LEAD_MS = 60 * 60 * 1000;       // 1 hour before scheduled
const LIVE_WINDOW_TRAIL_MS = 4 * 60 * 60 * 1000;  // 4 hours after scheduled

/**
 * Returns the currently-live KC match, or null if none is running.
 *
 * Detection logic (in priority order) :
 *   1. matches.state === 'live'                — sentinel saw inProgress
 *   2. matches.state IN ('live','upcoming') AND
 *      scheduled_at BETWEEN now-1h AND now+4h  — sentinel lag fallback
 *
 * Returns null if zero candidate rows match. The helper is opt-in dynamic
 * (uses cookies-aware client by default) so it can read auth context if
 * RLS ever scopes matches per-team, but that's not currently required.
 *
 * Caller is responsible for caching — the helper itself does NOT memoise.
 * The /api/live/state route sets `revalidate = 10` so a busy match has at
 * most 6 reads/min hitting Supabase.
 */
export async function getCurrentLiveMatch(opts: {
  buildTime?: boolean;
  trackedTeamCode?: string;
} = {}): Promise<LiveMatchRow | null> {
  const trackedCode = (opts.trackedTeamCode ?? "KC").toUpperCase();
  try {
    const sb = opts.buildTime ? createAnonSupabase() : await createServerSupabase();

    const now = new Date();
    const lowerBound = new Date(now.getTime() - LIVE_WINDOW_TRAIL_MS).toISOString();
    const upperBound = new Date(now.getTime() + LIVE_WINDOW_LEAD_MS).toISOString();

    // First try : strict state='live'. Almost always hits when the
    // sentinel is healthy. Limit 5 in case multiple LEC matches are
    // running back-to-back — we'll filter to KC after the team join.
    const strict = await sb
      .from("matches")
      .select(
        "id, external_id, scheduled_at, state, format, stage, team_blue_id, team_red_id",
      )
      .eq("state", "live")
      .order("scheduled_at", { ascending: false })
      .limit(5);

    if (strict.error) {
      console.warn("[supabase/live] getCurrentLiveMatch strict error:", strict.error.message);
    }

    let candidates = (strict.data ?? []) as Array<{
      id: string;
      external_id: string;
      scheduled_at: string | null;
      state: string | null;
      format: string | null;
      stage: string | null;
      team_blue_id: string | null;
      team_red_id: string | null;
    }>;

    // Fallback : sentinel lag. If nothing's strictly 'live', accept any
    // match scheduled within the window. This covers the gap between
    // broadcast start and the next sentinel cycle.
    if (candidates.length === 0) {
      const fallback = await sb
        .from("matches")
        .select(
          "id, external_id, scheduled_at, state, format, stage, team_blue_id, team_red_id",
        )
        .in("state", ["live", "upcoming"])
        .gte("scheduled_at", lowerBound)
        .lte("scheduled_at", upperBound)
        .order("scheduled_at", { ascending: false })
        .limit(5);
      if (fallback.error) {
        console.warn(
          "[supabase/live] getCurrentLiveMatch fallback error:",
          fallback.error.message,
        );
      }
      candidates = (fallback.data ?? []) as typeof candidates;
    }

    if (candidates.length === 0) return null;

    // Resolve every team referenced so we can pick the row that involves
    // the tracked team. Single batched query keeps egress flat regardless
    // of candidate count.
    const teamIds = new Set<string>();
    for (const c of candidates) {
      if (c.team_blue_id) teamIds.add(c.team_blue_id);
      if (c.team_red_id) teamIds.add(c.team_red_id);
    }
    if (teamIds.size === 0) return null;
    const { data: teamRows, error: teamErr } = await sb
      .from("teams")
      .select("id, name, code, slug, logo_url, is_tracked")
      .in("id", Array.from(teamIds));
    if (teamErr) {
      console.warn("[supabase/live] getCurrentLiveMatch teams error:", teamErr.message);
      return null;
    }
    const teamById = new Map<string, LiveMatchTeam>();
    for (const t of (teamRows ?? []) as Array<{
      id: string;
      name: string;
      code: string;
      slug: string;
      logo_url: string | null;
      is_tracked: boolean | null;
    }>) {
      teamById.set(t.id, {
        id: t.id,
        name: t.name,
        code: t.code,
        slug: t.slug,
        logo_url: t.logo_url ?? null,
        is_tracked: Boolean(t.is_tracked),
      });
    }

    // Pick the first candidate that involves the tracked team. Sorted by
    // scheduled_at DESC so back-to-back matches favour the freshest.
    for (const c of candidates) {
      const blue = c.team_blue_id ? teamById.get(c.team_blue_id) ?? null : null;
      const red = c.team_red_id ? teamById.get(c.team_red_id) ?? null : null;
      const hasKc =
        (blue && blue.code.toUpperCase() === trackedCode) ||
        (red && red.code.toUpperCase() === trackedCode);
      if (!hasKc) continue;
      const kcSide = blue?.code.toUpperCase() === trackedCode ? blue : red;
      const oppSide = blue?.code.toUpperCase() === trackedCode ? red : blue;
      const matchupLabel = kcSide && oppSide ? `${kcSide.code} vs ${oppSide.code}` : null;
      return {
        id: c.id,
        external_id: c.external_id,
        scheduled_at: c.scheduled_at,
        state: c.state,
        format: c.format,
        stage: c.stage,
        team_blue_id: c.team_blue_id,
        team_red_id: c.team_red_id,
        blue,
        red,
        has_kc: true,
        matchup_label: matchupLabel,
      };
    }

    return null;
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/live] getCurrentLiveMatch threw:", err);
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────
// Recent kills for a live match
// ───────────────────────────────────────────────────────────────────

/**
 * Recently-published kills attached to a given match.
 *
 *   * `matchId` — the matches.id UUID (NOT external_id).
 *   * `sinceIso` — optional lower bound on event_epoch (as ISO). When
 *     present we return only kills strictly newer than this timestamp ;
 *     used by the LiveHotNow polling loop to fetch deltas only.
 *   * `limit` — defaults to 12, hard cap 50.
 *
 * Returns kills where publication_status='published' (with PR23 legacy
 * fallback on `status`), ordered by event_epoch DESC so the latest
 * kill is element [0]. Same selection criteria as the global feed
 * (kill_visible=true, has clip + thumbnail) so the banner only ever
 * surfaces playable rows.
 */
export async function getRecentLiveKills(
  matchId: string,
  opts: {
    sinceIso?: string;
    limit?: number;
    buildTime?: boolean;
  } = {},
): Promise<LiveKillRow[]> {
  const limit = Math.min(opts.limit ?? 12, 50);
  try {
    const sb = opts.buildTime ? createAnonSupabase() : await createServerSupabase();

    // Resolve the set of game ids that belong to this match. Doing this
    // in one round-trip (vs nested join) lets us index the kills query
    // on game_id, which is the primary kill access path.
    const { data: gameRows, error: gameErr } = await sb
      .from("games")
      .select("id, game_number")
      .eq("match_id", matchId);
    if (gameErr) {
      console.warn("[supabase/live] getRecentLiveKills games error:", gameErr.message);
      return [];
    }
    const games = (gameRows ?? []) as Array<{ id: string; game_number: number | null }>;
    if (games.length === 0) return [];

    const gameById = new Map<string, number | null>();
    for (const g of games) gameById.set(g.id, g.game_number);
    const gameIds = games.map((g) => g.id);

    let q = sb
      .from("kills")
      .select(
        [
          "id",
          "game_id",
          "event_epoch",
          "game_time_seconds",
          "killer_player_id",
          "killer_champion",
          "victim_champion",
          "tracked_team_involvement",
          "multi_kill",
          "is_first_blood",
          "highlight_score",
          "ai_description",
          "ai_description_fr",
          "thumbnail_url",
          "clip_url_vertical",
          "clip_url_vertical_low",
          "clip_url_horizontal",
          "created_at",
        ].join(", "),
      )
      .in("game_id", gameIds)
      .or(
        "publication_status.eq.published," +
          "and(publication_status.is.null,status.eq.published)",
      )
      .eq("kill_visible", true)
      .not("clip_url_vertical", "is", null)
      .not("thumbnail_url", "is", null)
      .order("event_epoch", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (opts.sinceIso) {
      // event_epoch is stored as BIGINT (seconds since unix epoch in the
      // worker pipeline). Convert the ISO bound to that scale so the
      // delta query matches. If event_epoch is NULL on legacy rows we
      // still include them because created_at carries the worker-import
      // timestamp.
      const sinceEpoch = Math.floor(new Date(opts.sinceIso).getTime() / 1000);
      if (Number.isFinite(sinceEpoch)) {
        q = q.gt("event_epoch", sinceEpoch);
      }
    }

    const { data, error } = await q;
    if (error) {
      console.warn("[supabase/live] getRecentLiveKills error:", error.message);
      return [];
    }

    // supabase-js returns Array<{ error: true } & ...> in the type for `select`
    // with complex column lists ; cast through `unknown` to reshape into
    // the row dict we actually consume at runtime.
    const rows = ((data ?? []) as unknown) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id ?? ""),
      game_id: String(row.game_id ?? ""),
      game_number: gameById.get(String(row.game_id ?? "")) ?? null,
      event_epoch: (row.event_epoch as number | null) ?? null,
      game_time_seconds: (row.game_time_seconds as number | null) ?? null,
      killer_player_id: (row.killer_player_id as string | null) ?? null,
      killer_champion: (row.killer_champion as string | null) ?? null,
      victim_champion: (row.victim_champion as string | null) ?? null,
      tracked_team_involvement:
        (row.tracked_team_involvement as string | null) ?? null,
      multi_kill: (row.multi_kill as string | null) ?? null,
      is_first_blood: Boolean(row.is_first_blood),
      highlight_score: (row.highlight_score as number | null) ?? null,
      ai_description: (row.ai_description as string | null) ?? null,
      ai_description_fr: (row.ai_description_fr as string | null) ?? null,
      thumbnail_url: (row.thumbnail_url as string | null) ?? null,
      clip_url_vertical: (row.clip_url_vertical as string | null) ?? null,
      clip_url_vertical_low: (row.clip_url_vertical_low as string | null) ?? null,
      clip_url_horizontal: (row.clip_url_horizontal as string | null) ?? null,
      created_at: String(row.created_at ?? ""),
    }));
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/live] getRecentLiveKills threw:", err);
    return [];
  }
}

/**
 * Compute the running "kills by team" score for a live match. Used by
 * /live to render the "KC 4 - 2 OPP" badge.
 *
 * Counts kills where tracked_team_involvement = 'team_killer' as the
 * tracked team's score, and 'team_victim' as the opponent's. Ignores
 * 'team_assist' rows (they'd double-count).
 *
 * Returns { kc: 0, opp: 0 } if the match has no kills yet.
 */
export async function getLiveMatchScore(
  matchId: string,
  opts: { buildTime?: boolean } = {},
): Promise<{ kc: number; opp: number }> {
  try {
    const sb = opts.buildTime ? createAnonSupabase() : await createServerSupabase();

    const { data: gameRows } = await sb
      .from("games")
      .select("id")
      .eq("match_id", matchId);
    const gameIds = ((gameRows ?? []) as Array<{ id: string }>).map((g) => g.id);
    if (gameIds.length === 0) return { kc: 0, opp: 0 };

    // Two HEAD count queries — ~150 bytes each, much cheaper than
    // pulling every kill row just to count them.
    const [kcRes, oppRes] = await Promise.all([
      sb
        .from("kills")
        .select("id", { count: "exact", head: true })
        .in("game_id", gameIds)
        .eq("tracked_team_involvement", "team_killer"),
      sb
        .from("kills")
        .select("id", { count: "exact", head: true })
        .in("game_id", gameIds)
        .eq("tracked_team_involvement", "team_victim"),
    ]);

    return {
      kc: kcRes.count ?? 0,
      opp: oppRes.count ?? 0,
    };
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/live] getLiveMatchScore threw:", err);
    return { kc: 0, opp: 0 };
  }
}
