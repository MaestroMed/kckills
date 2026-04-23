-- Migration 015 — Premium re-analysis tracking (PR12)
--
-- The kills.ai_description column was filled by Gemini 2.5 Flash-Lite
-- on the first analyzer pass. PR12 introduces a premium tier (Pro 2.5
-- by default) and a re-analysis script that upgrades existing rows.
-- We need a column to track which kills have been re-analyzed so the
-- script doesn't redundantly re-bill us for clips it already upgraded.

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS reanalyzed_at TIMESTAMPTZ;

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS reanalyzed_model TEXT;

-- Partial index : tiny, only indexes rows that have been upgraded.
-- Used by the re-analysis script's "skip already done" filter and by
-- admin queries (e.g. "show me Pro 2.5 descriptions for editorial").
CREATE INDEX IF NOT EXISTS idx_kills_reanalyzed
    ON kills(reanalyzed_at DESC)
    WHERE reanalyzed_at IS NOT NULL;

COMMENT ON COLUMN kills.reanalyzed_at IS
    'Set by scripts/reanalyze_with_premium.py when a clip''s description '
    'has been upgraded from the initial Flash-Lite output to a premium '
    'model (Pro 2.5 / Pro 3.1 Preview / etc.). NULL = original analyzer '
    'output, never re-analyzed.';

COMMENT ON COLUMN kills.reanalyzed_model IS
    'Which model produced the current ai_description if reanalyzed_at '
    'IS NOT NULL. Audit trail for the premium-tier work.';
