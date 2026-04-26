-- Migration 043 — Leagues table (PR-loltok / multi-league sentinel)
--
-- KCKills today only follows the LEC. The LoLTok ground-up rewrite must
-- support every Riot pro circuit (LCS, LCK, LPL, LFL, EMEA Masters,
-- Worlds, MSI, First Stand, regional ERLs…). Hardcoding league_id all
-- over the worker (config.LEC_LEAGUE_ID, sentinel.run, backfill_history)
-- doesn't scale.
--
-- This migration introduces a `leagues` catalog table that the worker
-- (sentinel + backfills + future ingest scripts) reads at boot to know
-- which competitions to scan. Each row maps :
--
--   slug            → "lec", "lcs", "lck", "lpl", "lfl"…
--                     short canonical key used by KCKILLS_TRACKED_LEAGUES
--                     env var (CSV) and by API URLs.
--   name            → "LoL EMEA Championship" (full display name)
--   short_name      → "LEC" (compact label for UI badges)
--   region          → "EMEA" / "Americas" / "Korea" / "China" / "Vietnam"…
--   lolesports_league_id → numeric id used by getSchedule(leagueId=…)
--                          (returned by getLeagues — see seed script).
--   leaguepedia_name → page-name on Leaguepedia for the wiki Cargo
--                      fallback (e.g. "LEC", "LCS_2026_Spring").
--   golgg_tournament_pattern → URL slug template for gol.gg scrapes
--                              (Agent BD owns the scraper itself, this
--                              is just the per-league input).
--   priority        → integer ; lower = higher priority. Used by the
--                     sentinel loop and the dashboards to order leagues.
--                     LEC = 10 (KC home), LCS = 20, LCK = 30…
--   active          → soft-disable a league without dropping the row.
--                     The sentinel skips inactive leagues unless the
--                     KCKILLS_TRACKED_LEAGUES env var explicitly names
--                     one (operator override).
--
-- Backwards-compat contract :
--   * `KCKILLS_TRACKED_LEAGUES` env defaults to "lec" → byte-identical
--     behavior to today's pilot.
--   * `matches.league_id UUID NULL` is added but back-fill is OPTIONAL —
--     existing rows stay NULL ; the frontend already infers the league
--     from the tournament link, so NULL is harmless.
--   * The migration is idempotent (`IF NOT EXISTS` everywhere).

-- ─── 1. Catalog table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS leagues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    region TEXT NOT NULL,
    lolesports_league_id TEXT UNIQUE,
    leaguepedia_name TEXT,
    golgg_tournament_pattern TEXT,
    priority INT NOT NULL DEFAULT 100,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The sentinel loop reads (priority, active) on every cycle ; a
-- composite index keeps that scan O(log n) even at 50+ leagues.
CREATE INDEX IF NOT EXISTS idx_leagues_priority
    ON leagues(priority, active);

-- Fast lookup by slug for league_config.get_league_by_slug() — the
-- sentinel resolves N slugs from KCKILLS_TRACKED_LEAGUES on every cycle.
CREATE INDEX IF NOT EXISTS idx_leagues_slug
    ON leagues(slug);

COMMENT ON TABLE leagues IS
    'Catalog of pro LoL leagues the worker can ingest. Sentinel + '
    'backfills query this table at boot to drive the per-league '
    'getSchedule loop. Defaults to scanning only "lec" via the '
    'KCKILLS_TRACKED_LEAGUES env var ; set to "*" to scan every '
    'active league.';
COMMENT ON COLUMN leagues.slug IS
    'Short canonical key (lec, lcs, lck, lpl, lfl, emea_masters, '
    'worlds, msi, first_stand…). Used by KCKILLS_TRACKED_LEAGUES env.';
COMMENT ON COLUMN leagues.lolesports_league_id IS
    'Numeric league id passed to esports-api.lolesports.com getSchedule '
    '(?leagueId=…). Looked up via getLeagues — see worker/scripts/'
    'seed_leagues.py.';
COMMENT ON COLUMN leagues.priority IS
    'Lower = higher priority. Sentinel loop orders by this column so '
    'the home league (LEC=10) is always polled first. Range 1-1000.';
COMMENT ON COLUMN leagues.active IS
    'Soft-disable flag. Inactive leagues are skipped by the sentinel '
    'unless KCKILLS_TRACKED_LEAGUES explicitly names them.';

-- ─── 2. Optional FK from matches → leagues ─────────────────
-- New rows can carry the league reference for cheap UI filtering.
-- Old rows stay NULL (the frontend derives league via the tournament
-- link today) so this is non-breaking.
ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS league_id UUID REFERENCES leagues(id);

CREATE INDEX IF NOT EXISTS idx_matches_league
    ON matches(league_id, scheduled_at DESC)
 WHERE league_id IS NOT NULL;

COMMENT ON COLUMN matches.league_id IS
    'FK → leagues.id (NULL for legacy rows pre-migration 043). The '
    'sentinel started populating this column at PR-loltok BB ; back-'
    'fill is optional because the frontend already infers the league '
    'via tournament_id → tournaments.league_id.';
