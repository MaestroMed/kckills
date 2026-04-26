-- Migration 036 — Self-healing release of stale pipeline_jobs leases.
--
-- Wave 6 hardening : the queue_health daemon (worker/modules/queue_health.py)
-- runs every 5 min and calls fn_release_stale_pipeline_locks() as the
-- first step of each cycle. If a worker crashes mid-claim and never
-- renews its lease, locked_until eventually slides into the past and
-- the row is "stuck" in 'claimed' even though no worker holds it.
--
-- The migration 024 fn_claim_pipeline_jobs() already re-claims expired
-- leases of types it scans for — but :
--   * It only re-claims for the types in the current claim() call. Stale
--     leases for OTHER types stay stuck until a claim() hits them.
--   * If attempts >= max_attempts, the re-claim is silently skipped
--     (the WHERE clause filters them out), so they never get DLQ'd
--     either — they're zombies.
--
-- This function flips ANY claimed row whose lease has expired (with a
-- safety floor of p_max_age_minutes to avoid racing the legitimate
-- worker holding the lease) back to 'pending'. Workers can then re-
-- claim normally — including failing→DLQ if they're truly broken.
--
-- Idempotent : runs as many times as you want, only acts on truly
-- expired leases. Safe to schedule via the worker daemon AND/OR
-- pg_cron / external scheduler.
--
-- SECURITY : SECURITY DEFINER so callers using the anon key can't
-- accidentally invoke it ; only service_role is GRANTed EXECUTE.

CREATE OR REPLACE FUNCTION fn_release_stale_pipeline_locks(
    p_max_age_minutes INT DEFAULT 60
)
RETURNS INT AS $$
DECLARE
    v_released INT := 0;
    v_cutoff TIMESTAMPTZ;
BEGIN
    -- Only consider leases that are truly past their deadline AND
    -- past the safety floor (p_max_age_minutes). The "OR" lets us
    -- catch both :
    --   1. locked_until < now() - safety_floor : a lease that expired
    --      AT LEAST safety_floor minutes ago (the conservative case).
    --   2. locked_until IS NULL but status='claimed' : a degenerate
    --      row from an old build that didn't set the lease at all.
    v_cutoff := now() - (p_max_age_minutes || ' minutes')::interval;

    WITH released AS (
        UPDATE pipeline_jobs
           SET status       = 'pending',
               locked_by    = NULL,
               locked_until = NULL,
               last_error   = COALESCE(last_error, '')
                              || CASE WHEN last_error IS NOT NULL
                                      THEN E'\n' ELSE '' END
                              || '[released-stale-lease at '
                              || now()::text || ']'
         WHERE status = 'claimed'
           AND (
                 locked_until IS NULL
                 OR locked_until < v_cutoff
               )
        RETURNING id
    )
    SELECT COUNT(*) INTO v_released FROM released;

    RETURN v_released;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Lock down execute to service_role only. Anon / authenticated callers
-- have no business releasing queue locks.
REVOKE ALL ON FUNCTION fn_release_stale_pipeline_locks(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_release_stale_pipeline_locks(INT) TO service_role;

COMMENT ON FUNCTION fn_release_stale_pipeline_locks(INT) IS
    'Release pipeline_jobs rows stuck in status=claimed with expired '
    'leases. Returns the count released. Called every 5 min by '
    'worker/modules/queue_health.py. Idempotent.';
