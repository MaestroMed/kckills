-- ═══════════════════════════════════════════════════════════════
-- 082 — player_champion_stats
-- Per-player × per-champion aggregates (games / winrate / KDA) for KC.
--
-- WHY: game_participants is empty (the worker never populated it), so the
-- site had no way to show "Yike is 90% WR on Vi". Rather than hand-set
-- constants, this table is backfilled from Leaguepedia Cargo (public pro
-- data) by worker/scripts/backfill_player_champion_stats.py and read live
-- by the frontend (e.g. the Vi showcase).
--
-- `scope` lets us store both career ('all') and a season slice ('y2026').
-- Public SELECT via RLS so the anon client can read it; writes go through
-- the service role (worker), which bypasses RLS.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS player_champion_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Leaguepedia canonical player page (e.g. 'Yike'). This is the join key
    -- to the source; player_id is a best-effort link to our own players row.
    player_link TEXT NOT NULL,
    player_id UUID REFERENCES players(id),
    champion TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'all',     -- 'all' (career) | 'y2026' (>= 2026-01-01)
    games INT NOT NULL DEFAULT 0,
    wins INT NOT NULL DEFAULT 0,
    losses INT NOT NULL DEFAULT 0,
    kills INT DEFAULT 0,
    deaths INT DEFAULT 0,
    assists INT DEFAULT 0,
    winrate NUMERIC(5,1),                  -- 0.0 .. 100.0
    kda NUMERIC(6,2),
    source TEXT DEFAULT 'leaguepedia',
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (player_link, champion, scope)
);

ALTER TABLE player_champion_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public champion stats" ON player_champion_stats;
CREATE POLICY "Public champion stats"
    ON player_champion_stats FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_pcs_player
    ON player_champion_stats (player_link, scope, games DESC);
CREATE INDEX IF NOT EXISTS idx_pcs_champ
    ON player_champion_stats (champion, scope, winrate DESC NULLS LAST);
