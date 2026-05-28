-- Migration 075 (Wave 35 #12) — pipeline_jobs autovacuum hardening
--
-- POSTMORTEM CONTEXT
-- ══════════════════
-- The Wave 35 #6 "plein régime" cadence (clipper parallel=12, transitioner
-- enqueuing 500 clip.create jobs every 180s) created an unbounded-producer /
-- bounded-consumer runaway. pipeline_jobs ballooned past 20K live rows +
-- heavy dead-tuple churn. On the Supabase free-tier SHARED compute instance
-- this saturated I/O : fn_claim_pipeline_jobs degraded to sequential scans
-- over a bloated heap, hitting statement_timeout (57014) in a cascade that
-- effectively DoS'd the database.
--
-- Recovery required : kill the worker, paced-purge ~7K succeeded jobs, and
-- a manual ANALYZE (the SQL Editor wraps statements in a transaction so
-- VACUUM / VACUUM FULL fail with 25001 — only ANALYZE and ALTER TABLE are
-- transaction-safe there). Post-ANALYZE the planner reverted to index scans
-- on the partial claim indexes and the timeouts cleared.
--
-- WHAT THIS MIGRATION LOCKS IN
-- ════════════════════════════
-- The autovacuum tuning that was applied manually during recovery, so it
-- survives a DB rebuild instead of being a lost one-off. Aggressive
-- autovacuum on the hot queue table keeps dead tuples reclaimed-for-reuse
-- (caps physical growth) so the claim RPC stays on index scans.
--
-- NOTE : autovacuum (non-FULL) makes dead space reusable but does NOT
-- shrink the on-disk file. The ~126 MB physical bloat from the incident
-- requires a one-off `VACUUM FULL pipeline_jobs` via a DIRECT psql
-- connection (not the SQL Editor). Deferred — db_total was 324/500 MB at
-- recovery, comfortable headroom. Run it opportunistically to reclaim
-- ~115 MB if storage pressure returns.
--
-- The STRUCTURAL fix (not in this migration) lives in the worker code :
-- services/job_queue.should_throttle_enqueue() — producers now skip a
-- cycle when pending >= KCKILLS_MAX_PENDING_PER_TYPE. Bounded producer ⇒
-- bounded queue ⇒ claim RPC stays fast (Little's Law). This migration is
-- the DB-side belt to that code-side braces.

BEGIN;

-- Hot queue table : vacuum at 2% dead rows (vs 20% default) and analyze
-- often so the planner's row estimates never drift far from reality —
-- stale stats were the proximate cause of the seq-scan degradation.
ALTER TABLE pipeline_jobs SET (
    autovacuum_vacuum_scale_factor  = 0.02,
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_vacuum_cost_delay    = 2
);

-- pipeline_runs : 32 MB and churns on every (sampled) module cycle.
-- Same treatment so it doesn't become the next bloat source.
ALTER TABLE pipeline_runs SET (
    autovacuum_vacuum_scale_factor  = 0.05,
    autovacuum_analyze_scale_factor = 0.05
);

COMMIT;

-- ─── Operator one-offs (run manually, NOT part of this migration) ─────
-- Stats refresh after a large purge (transaction-safe, SQL Editor OK) :
--   ANALYZE pipeline_jobs; ANALYZE kills; ANALYZE game_events;
--
-- Physical reclaim of incident bloat (DIRECT psql connection ONLY —
-- fails in SQL Editor with 25001) :
--   VACUUM (FULL, ANALYZE) pipeline_jobs;
--
-- Verify storage headroom vs the 500 MB free-tier cap :
--   SELECT pg_size_pretty(pg_database_size(current_database()));
