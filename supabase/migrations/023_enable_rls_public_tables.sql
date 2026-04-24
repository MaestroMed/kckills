-- Migration 023 — Enable RLS on public-readable tables
--
-- Supabase Advisor flagged these 4 tables as "RLS Disabled in Public" :
--   * teams
--   * players
--   * tournaments
--   * matches
--
-- All four are reference data : pro team names, player rosters, league
-- tournaments, scheduled matches. We WANT them readable by everyone
-- (the public site reads them anonymously). But without RLS, the anon
-- key can ALSO write — and the anon key is shipped in every browser
-- bundle, so anyone could DELETE every match row with a single curl.
--
-- This migration :
--   1. Enables RLS on each table.
--   2. Adds a single "Public read" policy : SELECT for all.
--   3. Writes are still allowed via the service_role key (worker only).
--
-- It does NOT add INSERT/UPDATE/DELETE policies because we never want
-- the public to write here. The service role bypasses RLS entirely so
-- the worker keeps doing its job.

-- ─── teams ──────────────────────────────────────────────────────────
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read teams" ON teams;
CREATE POLICY "Public read teams" ON teams
    FOR SELECT
    USING (true);

-- ─── players ────────────────────────────────────────────────────────
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read players" ON players;
CREATE POLICY "Public read players" ON players
    FOR SELECT
    USING (true);

-- ─── tournaments ────────────────────────────────────────────────────
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read tournaments" ON tournaments;
CREATE POLICY "Public read tournaments" ON tournaments
    FOR SELECT
    USING (true);

-- ─── matches ────────────────────────────────────────────────────────
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read matches" ON matches;
CREATE POLICY "Public read matches" ON matches
    FOR SELECT
    USING (true);

-- ─── games + game_participants — same problem, same fix ────────────
-- Advisor probably flagged these too in the "7 more issues".
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read games" ON games;
CREATE POLICY "Public read games" ON games
    FOR SELECT
    USING (true);

ALTER TABLE game_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read game_participants" ON game_participants;
CREATE POLICY "Public read game_participants" ON game_participants
    FOR SELECT
    USING (true);

-- ─── game_vod_sources — admin-curated, restrict writes ─────────────
ALTER TABLE game_vod_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read game_vod_sources" ON game_vod_sources;
CREATE POLICY "Public read game_vod_sources" ON game_vod_sources
    FOR SELECT
    USING (true);
