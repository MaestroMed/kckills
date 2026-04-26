-- Migration 035 — Add discord_posted_at to kills + index for unposted high-score scans
--
-- Companion to worker/modules/discord_autopost.py (PR-arch P2 — Phase 3
-- community feature per CLAUDE.md). The autopost daemon polls kills
-- every 60s for newly-published high-score clips and pushes them to a
-- configured Discord webhook. Once a kill is delivered we stamp this
-- column so it never gets re-posted on subsequent cycles.
--
-- The partial index keeps the daemon's per-cycle scan to a few rows
-- even when the kills table is in the millions — PostgreSQL can satisfy
-- the WHERE filter from the index alone, no heap scan needed.
--
-- Idempotent : ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Safe to re-run, safe to roll back (drop the column to revert).

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS discord_posted_at TIMESTAMPTZ;

COMMENT ON COLUMN kills.discord_posted_at IS
    'Timestamp of the auto-post to the Discord webhook (worker/modules/discord_autopost.py). '
    'NULL means the kill has not been pushed yet. The autopost daemon picks rows where '
    'status=published AND discord_posted_at IS NULL AND highlight_score >= DISCORD_AUTOPOST_MIN_SCORE '
    '(env var, default 8.0) and stamps this column on a 200 webhook response. Manual editorial '
    'pushes via /api/admin/editorial/discord do NOT touch this column — they intentionally allow '
    're-posting the same clip (e.g. teaser + recap).';

-- Partial index : the daemon only ever queries rows that match this
-- predicate, so PG can serve the entire scan from index pages. ORDER BY
-- highlight_score DESC NULLS LAST matches the daemon's prioritisation
-- (post the best clips first when a backlog accumulates).
CREATE INDEX IF NOT EXISTS idx_kills_discord_unposted
    ON kills (highlight_score DESC NULLS LAST)
    WHERE status = 'published' AND discord_posted_at IS NULL;

COMMENT ON INDEX idx_kills_discord_unposted IS
    'Hot path for worker/modules/discord_autopost.py — fast scan of unposted '
    'high-score kills sorted by highlight_score. Auto-fills discord_posted_at '
    'for kills above the configured threshold.';
