-- Migration 053 — pipeline_jobs retention (delete completed/failed > 30d)
-- Wave 17 (2026-05-07) — addresses W13 from architecture-audit-2026-05-07.
--
-- Why
-- ────
-- pipeline_jobs grows ~500-1000 rows/day from clip.create + clip.analyze
-- + og.generate + embedding.compute + event.map + publish.check
-- pipelines (50 kills/day × 6 stages × ~3 retries on average). Without
-- retention the table reaches ~200K rows/year, ~90 MB. Free-tier still
-- fits but query plans degrade as `WHERE status='claimed'` has to
-- iterate over 90 % terminated rows that have no business being
-- considered.
--
-- This migration introduces :
--
--   1. A `fn_prune_pipeline_jobs(p_keep_days)` SECURITY DEFINER that
--      deletes terminal-state rows (succeeded / failed / dead_letter /
--      cancelled) older than p_keep_days. Returns count deleted.
--   2. A partial index on `created_at` filtered to terminal states so
--      the cleanup query is index-only.
--
-- Schedule
-- ────────
-- Run weekly via the existing Windows scheduled task pattern (see
-- worker/scripts/prune_pipeline_jobs.py for the wrapper) OR via
-- pg_cron if the operator upgrades the Supabase tier.
--
-- Idempotency
-- ───────────
-- CREATE OR REPLACE + IF NOT EXISTS. Safe to re-run.
--
-- Rollback
-- ────────
-- DROP FUNCTION fn_prune_pipeline_jobs ; DROP INDEX idx_pipeline_jobs_terminal_old ;

BEGIN;

-- Partial index : only the rows the cleanup will see. Tiny on disk
-- because terminal old rows are a small fraction of the table at any
-- given time once the cleanup runs weekly.
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_terminal_old
  ON pipeline_jobs (created_at)
  WHERE status IN ('succeeded', 'failed', 'dead_letter', 'cancelled');

CREATE OR REPLACE FUNCTION fn_prune_pipeline_jobs(p_keep_days INT DEFAULT 30)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cutoff TIMESTAMPTZ;
  deleted BIGINT;
BEGIN
  IF p_keep_days < 7 THEN
    RAISE EXCEPTION 'p_keep_days must be >= 7 (got %)', p_keep_days;
  END IF;

  cutoff := now() - make_interval(days => p_keep_days);

  DELETE FROM pipeline_jobs
   WHERE created_at < cutoff
     AND status IN ('succeeded', 'failed', 'dead_letter', 'cancelled');

  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_prune_pipeline_jobs(INT) TO authenticated;
-- service-role can call too via direct REST ; this grant is for
-- admin UI calls authenticated as a Discord-OAuth user.

COMMIT;

-- ─── Operator usage ────────────────────────────────────────────────
-- Manual prune (dry-run via dry-pretend) :
--   SELECT count(*) FROM pipeline_jobs
--    WHERE created_at < now() - interval '30 days'
--      AND status IN ('succeeded', 'failed', 'dead_letter', 'cancelled');
--
-- Real prune :
--   SELECT fn_prune_pipeline_jobs(30);
--
-- Schedule weekly :
--   See worker/scripts/prune_pipeline_jobs.py + the install-zombie-cron.ps1
--   pattern (Wave 17.3).
