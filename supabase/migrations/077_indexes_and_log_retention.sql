-- Migration 077 (Wave 35 SOTA audit) — missing indexes + log-table retention
--
-- From the DB audit agent (2026-05-28), ranked HIGH:
--
-- 1. kills(status, updated_at) — job_dispatcher._scan_status, clipper, and
--    watchdog all run `kills WHERE status=X ORDER BY updated_at ASC LIMIT N`.
--    The only matching index is idx_kills_status (equality only, partial
--    WHERE status!='published'), so Postgres sorts thousands of rows by
--    updated_at UNINDEXED → the dispatcher-scan timeouts seen during the
--    incident. Composite index fixes it.
--
-- 2. game_events retract path — event_publisher._fetch_retractable scans
--    `is_publishable=false AND published_at IS NOT NULL` with no index
--    (idx_game_events_publishable_pending only covers true/NULL). Low
--    volume today but an uncapped scan that grows with the catalogue.
--
-- 3. pipeline_runs (85k+ rows, ~5k/day, ZERO retention) and
--    dead_letter_jobs (7k+, climbing) are the real storage growth leaders
--    — NOT pipeline_jobs. Migration 053 prunes only pipeline_jobs, and its
--    `status IN (...,'dead_letter',...)` clause is dead code ('dead_letter'
--    is not a pipeline_jobs.status; the DLQ is a separate table). Add prune
--    functions for both; wire them into the existing weekly maintenance task.
--
-- All statements here are transaction-safe (plain CREATE INDEX takes a
-- brief write lock — fine at these table sizes; CONCURRENTLY is impossible
-- in the Supabase SQL Editor's implicit transaction).

BEGIN;

-- ── 1. Dispatcher / clipper / watchdog scan index ──────────────────
CREATE INDEX IF NOT EXISTS idx_kills_status_updated
    ON kills (status, updated_at ASC)
    WHERE status <> 'published';

-- ── 2. event_publisher retract scan index ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_game_events_retract
    ON game_events (updated_at DESC)
    WHERE is_publishable = FALSE AND published_at IS NOT NULL;

-- ── 3a. pipeline_runs retention (14 days — v_pipeline_health reads ≤1h) ──
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started
    ON pipeline_runs (started_at);

CREATE OR REPLACE FUNCTION fn_prune_pipeline_runs(p_keep_days INT DEFAULT 14)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE deleted BIGINT;
BEGIN
    IF p_keep_days < 1 THEN
        RAISE EXCEPTION 'p_keep_days must be >= 1 (got %)', p_keep_days;
    END IF;
    DELETE FROM pipeline_runs
     WHERE started_at < now() - make_interval(days => p_keep_days);
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END;
$$;
GRANT EXECUTE ON FUNCTION fn_prune_pipeline_runs(INT) TO authenticated;

-- ── 3b. dead_letter_jobs retention (90 days, keep unresolved for triage) ──
CREATE OR REPLACE FUNCTION fn_prune_dead_letter_jobs(p_keep_days INT DEFAULT 90)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE deleted BIGINT;
BEGIN
    IF p_keep_days < 7 THEN
        RAISE EXCEPTION 'p_keep_days must be >= 7 (got %)', p_keep_days;
    END IF;
    DELETE FROM dead_letter_jobs
     WHERE failed_at < now() - make_interval(days => p_keep_days)
       AND resolution_status <> 'pending';
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END;
$$;
GRANT EXECUTE ON FUNCTION fn_prune_dead_letter_jobs(INT) TO authenticated;

COMMIT;

-- ── Operator : wire into the weekly maintenance task alongside ─────────
--   SELECT fn_prune_pipeline_jobs(14);   -- already scheduled
--   SELECT fn_prune_pipeline_runs(14);   -- NEW
--   SELECT fn_prune_dead_letter_jobs(90);-- NEW
-- (worker/scripts/prune_pipeline_jobs.py is the existing wrapper — extend it.)
