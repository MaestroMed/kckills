-- Migration 078 (Wave 35 SOTA audit) — bound fn_claim_pipeline_jobs
--
-- THE root cause of the DB-saturation incident, flagged INDEPENDENTLY by
-- the DB-audit agent AND the worker-audit agent.
--
-- The migration-024 version :
--   UPDATE pipeline_jobs ... WHERE id IN (
--       SELECT ... WHERE status='pending' ... LIMIT n FOR UPDATE SKIP LOCKED
--   ) OR (status='claimed' AND locked_until < now() AND type = ANY(p_types))
--
-- has two defects :
--   (a) The OR-branch is NOT bounded by LIMIT and NOT scoped to the picked
--       ids → one claim re-grabs EVERY expired job of those types at once
--       (thundering herd, blows past p_batch_size).
--   (b) The planner cannot use a single index for `id IN (...) OR (...)`,
--       so for job types with ZERO pending rows it falls back to a FULL
--       HEAP SCAN of pipeline_jobs — on the bloated table + shared free-tier
--       compute, that hit statement_timeout (57014) repeatedly
--       (worker.backfill / comment.moderate claims were the visible victims).
--
-- FIX : two SEPARATE bounded UPDATEs in the function body.
--   Leg 1 — fresh pending (hot path), bounded, uses idx_pipeline_jobs_claim
--           (partial WHERE status='pending').
--   Leg 2 — expired-lease reclaim, ONLY for the remaining batch budget,
--           bounded, uses idx_pipeline_jobs_expired_lease (partial WHERE
--           status='claimed'). Runs only if leg 1 didn't fill the batch.
--
-- Both legs are plain `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
-- LOCKED)` — the standard safe queue-claim pattern. No UNION+FOR UPDATE
-- (Postgres forbids that). Total claimed ≤ p_batch_size (kills the herd).
-- For empty types both legs are bounded index lookups on empty partials =
-- sub-ms, never a heap scan (kills the 57014).
--
-- Signature + RETURNS SETOF pipeline_jobs are UNCHANGED → the worker's
-- job_queue.claim() PostgREST RPC call is byte-compatible. Pure CREATE OR
-- REPLACE, no data change, instantly revertible by re-applying 024's body.
--
-- POST-APPLY CHECK (operator or agent): call once with an empty type to
-- confirm no error + fast return:
--   SELECT * FROM fn_claim_pipeline_jobs('verify', ARRAY['__none__'], 1, 60);

BEGIN;

CREATE OR REPLACE FUNCTION fn_claim_pipeline_jobs(
    p_worker_id     TEXT,
    p_types         TEXT[],
    p_batch_size    INT DEFAULT 5,
    p_lease_seconds INT DEFAULT 300
)
RETURNS SETOF pipeline_jobs AS $$
DECLARE
    v_lease_until TIMESTAMPTZ := now() + (p_lease_seconds || ' seconds')::interval;
    v_claimed     INT := 0;
    v_got         INT := 0;
BEGIN
    -- ── Leg 1 : fresh pending jobs (hot path) ──────────────────────
    RETURN QUERY
    UPDATE pipeline_jobs
       SET status       = 'claimed',
           locked_by    = p_worker_id,
           locked_until = v_lease_until,
           attempts     = attempts + 1
     WHERE id IN (
        SELECT id FROM pipeline_jobs
         WHERE status = 'pending'
           AND run_after <= now()
           AND type = ANY(p_types)
         ORDER BY priority DESC, created_at ASC
         LIMIT p_batch_size
         FOR UPDATE SKIP LOCKED
     )
    RETURNING *;

    GET DIAGNOSTICS v_got = ROW_COUNT;
    v_claimed := v_got;

    -- ── Leg 2 : reclaim expired leases, only for remaining budget ──
    IF v_claimed < p_batch_size THEN
        RETURN QUERY
        UPDATE pipeline_jobs
           SET status       = 'claimed',
               locked_by    = p_worker_id,
               locked_until = v_lease_until,
               attempts     = attempts + 1
         WHERE id IN (
            SELECT id FROM pipeline_jobs
             WHERE status = 'claimed'
               AND locked_until < now()
               AND type = ANY(p_types)
               AND attempts < max_attempts
             ORDER BY locked_until ASC
             LIMIT (p_batch_size - v_claimed)
             FOR UPDATE SKIP LOCKED
         )
        RETURNING *;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMIT;
