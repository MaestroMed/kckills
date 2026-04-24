-- Migration 025 — Observability (pipeline_runs + dead_letter_jobs)
--
-- Two tables that turn the pipeline from "look at logs" → "look at the
-- admin dashboard" :
--
--   pipeline_runs     — one row per module invocation (start, end,
--                       items processed, errors). Powers the
--                       /admin/pipeline page.
--
--   dead_letter_jobs  — failures that exhausted their retries land here
--                       for human triage instead of disappearing into
--                       logs. Cleanly separates "transient blip"
--                       (retry path) from "permanent failure" (DLQ).

-- ─── pipeline_runs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_name     TEXT NOT NULL,         -- 'clipper', 'analyzer', etc.
    worker_id       TEXT,                  -- 'orchestrator-clipper-PID29480' (helps split-brain debug)
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ,
    duration_ms     INT GENERATED ALWAYS AS (
                        EXTRACT(EPOCH FROM (ended_at - started_at))::int * 1000
                    ) STORED,
    status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
                        'running', 'succeeded', 'failed', 'cancelled', 'timeout'
                    )),
    items_scanned   INT NOT NULL DEFAULT 0,
    items_processed INT NOT NULL DEFAULT 0,
    items_failed    INT NOT NULL DEFAULT 0,
    items_skipped   INT NOT NULL DEFAULT 0,
    error_summary   TEXT,                  -- truncated error string if status=failed
    metadata        JSONB NOT NULL DEFAULT '{}'  -- module-specific stats
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_module_recent
    ON pipeline_runs(module_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_failed
    ON pipeline_runs(status, started_at DESC)
    WHERE status = 'failed';

-- Auto-purge runs older than 30 days (cron via pg_cron or app-side).
COMMENT ON TABLE pipeline_runs IS
    'One row per module invocation. ~17 modules × 12-720 runs/day = ~5k rows/day. '
    'Auto-purge after 30 days expected.';

-- ─── dead_letter_jobs ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dead_letter_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Reference to the original pipeline_jobs row (nullable in case
    -- we DLQ a non-job failure too).
    original_job_id UUID REFERENCES pipeline_jobs(id) ON DELETE SET NULL,
    -- Snapshot of the failed job's identity so DLQ rows survive
    -- pipeline_jobs purge.
    type            TEXT NOT NULL,
    entity_type     TEXT,
    entity_id       TEXT,
    payload         JSONB NOT NULL DEFAULT '{}',
    -- Failure details
    error_code      TEXT,                  -- e.g. 'ytdlp_bot_blocked', 'gemini_429', 'r2_5xx'
    error_message   TEXT,
    stack_trace     TEXT,
    attempts        INT NOT NULL,
    failed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Triage state
    resolution_status TEXT NOT NULL DEFAULT 'pending' CHECK (resolution_status IN (
                        'pending',     -- needs human review
                        'requeued',    -- pushed back as a fresh job
                        'cancelled',   -- intentionally dropped
                        'wont_fix'     -- known issue, accepting loss
                    )),
    resolved_by     TEXT,                  -- 'admin' or actor email
    resolved_at     TIMESTAMPTZ,
    resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_dlq_pending
    ON dead_letter_jobs(failed_at DESC)
    WHERE resolution_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_dlq_type
    ON dead_letter_jobs(type, failed_at DESC);

CREATE INDEX IF NOT EXISTS idx_dlq_error_code
    ON dead_letter_jobs(error_code, failed_at DESC);

COMMENT ON TABLE dead_letter_jobs IS
    'Failed jobs that exhausted retries. Row stays even after pipeline_jobs '
    'cleanup. Admin can re-queue / cancel from /admin/pipeline/dlq.';

-- RLS
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dead_letter_jobs ENABLE ROW LEVEL SECURITY;

-- ─── View : pipeline health summary ─────────────────────────────────
-- Powers the /admin/pipeline cards : per-module success rate, throughput,
-- average duration over the last hour.
CREATE OR REPLACE VIEW v_pipeline_health AS
SELECT
    module_name,
    COUNT(*)                                            AS runs_1h,
    SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded_1h,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)    AS failed_1h,
    SUM(items_processed)                                AS items_processed_1h,
    SUM(items_failed)                                   AS items_failed_1h,
    AVG(duration_ms)::int                               AS avg_duration_ms,
    MAX(started_at)                                     AS last_run_at,
    MAX(CASE WHEN status = 'succeeded' THEN started_at END) AS last_success_at
  FROM pipeline_runs
 WHERE started_at > now() - interval '1 hour'
 GROUP BY module_name;

COMMENT ON VIEW v_pipeline_health IS
    'Per-module 1h health snapshot. Used by /admin/pipeline.';
