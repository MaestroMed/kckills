-- Migration 024 — Job queue (pipeline_jobs)
--
-- Replaces the polling-based "every X minutes scan kills WHERE status=Y"
-- model with explicit job records. Each pipeline step now :
--   1. Claims a batch of jobs (lease lock)
--   2. Processes them
--   3. Writes the result (success / failure)
--   4. Enqueues the next step's jobs
--
-- This unlocks :
--   * Replay : just re-enqueue a row
--   * Retry with backoff : run_after column
--   * Lease locks : multiple workers safe
--   * Priority : high-priority jobs jump the line
--   * Audit : every step is a row, not a side effect

CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Job identity
    type            TEXT NOT NULL CHECK (type IN (
                        -- Discovery
                        'match.discover',
                        'live_stats.harvest',
                        'vod.reconcile',
                        'vod.offset_find',
                        'channel.discover',
                        'channel.reconcile',
                        -- Clipping
                        'clip.create',
                        'clip.reclip',
                        'hls.package',
                        -- Analysis
                        'clip.analyze',
                        'og.generate',
                        'embedding.compute',
                        -- QC
                        'qc.verify',
                        'qc.reanalyze',
                        -- Publication
                        'event.map',
                        'publish.check',
                        'publish.retract',
                        -- Editorial
                        'feature.pin',
                        'feature.unpin',
                        'kotw.auto_pick',
                        -- Moderation
                        'comment.moderate',
                        -- Maintenance
                        'cache.flush',
                        'health.heartbeat',
                        'cleanup.expired'
                    )),
    entity_type     TEXT,                     -- 'kill' | 'game' | 'match' | 'channel_video' | 'comment' | NULL
    entity_id       TEXT,                     -- UUID or external_id
    -- Lifecycle
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending',     -- waiting to be claimed
                        'claimed',     -- worker has lease
                        'succeeded',
                        'failed',      -- exhausted attempts
                        'cancelled'
                    )),
    priority        INT NOT NULL DEFAULT 50,  -- higher = sooner. Editorial=80, live=70, backfill=20.
    attempts        INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 3,
    -- Scheduling
    run_after       TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by       TEXT,                     -- worker_id (e.g. 'orchestrator-clipper-PID29480')
    locked_until    TIMESTAMPTZ,              -- lease expiry — re-claimable past this
    -- Payload + result
    payload         JSONB NOT NULL DEFAULT '{}',
    last_error      TEXT,
    result          JSONB,
    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ
);

-- Indexes for the claim path : pull the highest-priority due-now pending
-- job, oldest first within a priority band.
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_claim
    ON pipeline_jobs(status, run_after, priority DESC, created_at)
    WHERE status = 'pending';

-- Find expired leases to re-claim
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_expired_lease
    ON pipeline_jobs(locked_until)
    WHERE status = 'claimed';

-- Per-entity lookup for "what jobs touched this kill?"
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_entity
    ON pipeline_jobs(entity_type, entity_id, created_at DESC);

-- Per-type metrics (success rate, avg latency) — used by /admin/pipeline.
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_type_status_finished
    ON pipeline_jobs(type, status, finished_at DESC);

-- Idempotency : at most one ACTIVE job per (type, entity_type, entity_id).
-- "Active" = pending or claimed. Once finished/failed, a new job can land.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_jobs_active_unique
    ON pipeline_jobs(type, entity_type, entity_id)
    WHERE status IN ('pending', 'claimed');

-- Auto-bump updated_at
CREATE OR REPLACE FUNCTION fn_pipeline_jobs_touch_updated()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    IF NEW.status = 'claimed' AND OLD.status != 'claimed' THEN
        NEW.claimed_at := now();
    END IF;
    IF NEW.status IN ('succeeded', 'failed', 'cancelled') AND OLD.status NOT IN ('succeeded', 'failed', 'cancelled') THEN
        NEW.finished_at := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pipeline_jobs_touch ON pipeline_jobs;
CREATE TRIGGER trg_pipeline_jobs_touch
    BEFORE UPDATE ON pipeline_jobs
    FOR EACH ROW
    EXECUTE FUNCTION fn_pipeline_jobs_touch_updated();

-- ─── Atomic claim function — lease locking without races ──────────────
-- Pulls up to N due jobs, marks them claimed, returns the rows.
-- Workers MUST renew the lease within `lease_seconds` or another
-- worker reclaims after the deadline.
CREATE OR REPLACE FUNCTION fn_claim_pipeline_jobs(
    p_worker_id     TEXT,
    p_types         TEXT[],
    p_batch_size    INT DEFAULT 5,
    p_lease_seconds INT DEFAULT 300
)
RETURNS SETOF pipeline_jobs AS $$
DECLARE
    v_lease_until TIMESTAMPTZ := now() + (p_lease_seconds || ' seconds')::interval;
BEGIN
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
       OR (
        -- Re-claim expired leases too (worker died mid-job).
        status = 'claimed'
        AND locked_until < now()
        AND type = ANY(p_types)
        AND attempts < max_attempts
     )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- RLS — admin-only via service role (workers use service key).
-- No public read : leaking the queue would let attackers infer pipeline
-- internals. Admin UI accesses via /api/admin/pipeline endpoints (server-side).
ALTER TABLE pipeline_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE pipeline_jobs IS
    'Job queue replacing polling-based scans. Each row = 1 step in the kill pipeline. '
    'Workers claim via fn_claim_pipeline_jobs() with lease locking.';
