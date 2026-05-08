-- Migration 054 — user_events retention (delete > 90 days)
-- Wave 17 (2026-05-07) — addresses W14 from architecture-audit-2026-05-07.
--
-- Why
-- ────
-- user_events is the analytics ingestion table : page_view, scroll,
-- clip_play, comment_post, etc. Wave 11 added it ; growth is ~500
-- events/day at pilot scale, ~180K rows/year. Free-tier fits but
-- queries that aggregate "this week" / "today" performance KPIs have
-- to seq-scan past months of cold history once the table grows past
-- ~1M rows.
--
-- 90 days is a reasonable retention for behavioural analytics — long
-- enough for week-over-week trend comparisons + rare-cohort analysis,
-- short enough to bound the table at ~50K rows steady-state.
--
-- This migration introduces :
--
--   1. fn_prune_user_events(p_keep_days) SECURITY DEFINER that deletes
--      events older than p_keep_days. Returns count deleted.
--   2. Partial index on created_at filtered to "old enough to be a
--      candidate" so the prune query is index-only.
--
-- Aggregated KPIs that need history beyond 90 days should be denormalized
-- into a separate `kpi_daily` table (out of scope for this migration ;
-- backlog item Wave 18+).
--
-- Idempotency : CREATE OR REPLACE + IF NOT EXISTS. Safe to re-run.

BEGIN;

-- Index on created_at to support both the monthly prune DELETE and
-- the time-windowed analytics queries (today / this-week / this-month).
-- A WHERE-predicate partial index would be smaller but Postgres
-- requires IMMUTABLE functions in index predicates, and `now()` is
-- STABLE (transaction-scoped) — not eligible. Full index is fine :
-- created_at distribution is uniform-ish, the planner picks it for
-- range scans, and the size cost is negligible relative to the
-- table content.
CREATE INDEX IF NOT EXISTS idx_user_events_created_at
  ON user_events (created_at);

CREATE OR REPLACE FUNCTION fn_prune_user_events(p_keep_days INT DEFAULT 90)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cutoff TIMESTAMPTZ;
  deleted BIGINT;
BEGIN
  -- Hard floor : never delete < 30 days of events even if a typo says 7.
  -- The week-over-week dashboards rely on a full month of data.
  IF p_keep_days < 30 THEN
    RAISE EXCEPTION 'p_keep_days must be >= 30 (got %)', p_keep_days;
  END IF;

  cutoff := now() - make_interval(days => p_keep_days);

  DELETE FROM user_events
   WHERE created_at < cutoff;

  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_prune_user_events(INT) TO authenticated;

COMMIT;

-- ─── Operator usage ────────────────────────────────────────────────
-- Dry-pretend :
--   SELECT count(*) FROM user_events WHERE created_at < now() - interval '90 days';
--
-- Real prune :
--   SELECT fn_prune_user_events(90);
--
-- Schedule monthly via the install-zombie-cron pattern (Wave 17.3) or
-- pg_cron when the operator upgrades the Supabase tier.
