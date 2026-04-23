-- Migration 013 — Expand worker_jobs.kind whitelist for newer job kinds.
--
-- Migration 009 introduced worker_jobs with a strict CHECK constraint on
-- `kind`. PR3+ added two new kinds without updating the constraint :
--   * sentinel.boost     queued by match_planner (1h cadence) to bump
--                        sentinel + harvester to 30s during live KC matches.
--   * clip_qc.verify     queued by admin "QC this clip" UI + qc_sampler
--                        (random 2% sampling) to run Gemini timer drift
--                        verification on a published clip.
--
-- Without this migration, every insert of those two kinds fails with
-- a `worker_jobs_kind_check` violation. The admin UI silently 500s, and
-- the qc_sampler module fails its enqueue cycle.
--
-- This migration drops the old constraint and re-adds it with the full
-- list. Idempotent — `DROP CONSTRAINT IF EXISTS` handles re-runs.

ALTER TABLE worker_jobs
    DROP CONSTRAINT IF EXISTS worker_jobs_kind_check;

ALTER TABLE worker_jobs
    ADD CONSTRAINT worker_jobs_kind_check
    CHECK (kind IN (
        -- Original kinds (migration 009)
        'reanalyze_kill',
        'reclip_kill',
        'regen_og',
        'regen_audit_targets',
        'backfill_assists_game',
        'reanalyze_backlog',
        -- PR3 (match_planner integration)
        'sentinel.boost',
        -- PR4-B (admin clip QC)
        'clip_qc.verify'
    ));

COMMENT ON CONSTRAINT worker_jobs_kind_check ON worker_jobs IS
    'Whitelist of supported job kinds. Keep in sync with '
    'worker/modules/job_runner.py _dispatch() switch statement.';
