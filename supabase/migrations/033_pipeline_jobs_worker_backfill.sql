-- Migration 033 — Add 'worker.backfill' to pipeline_jobs.type whitelist.
--
-- Wave 4 introduces the admin /admin/pipeline/run page which lets the
-- operator one-click-trigger backfill scripts (backfill_clip_errors,
-- backfill_stuck_pipeline, recon_videos_now). The trigger inserts a
-- pipeline_jobs row of kind 'worker.backfill' with payload containing
-- the script name + args ; the worker-side admin_job_runner module
-- claims these and shells out to the matching whitelisted script.
--
-- Without this migration, every admin-trigger insert would fail the
-- pipeline_jobs_type_check constraint and the API would 500.
--
-- Idempotent : DROP CONSTRAINT IF EXISTS handles re-runs safely.

ALTER TABLE pipeline_jobs
    DROP CONSTRAINT IF EXISTS pipeline_jobs_type_check;

ALTER TABLE pipeline_jobs
    ADD CONSTRAINT pipeline_jobs_type_check
    CHECK (type IN (
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
        'cleanup.expired',
        -- Admin one-click ops (PR-arch P1, Wave 4)
        --   payload : { "script": "<whitelisted>", "args": { ... } }
        --   handled by worker/modules/admin_job_runner.py
        --   whitelist : backfill_clip_errors / backfill_stuck_pipeline /
        --               recon_videos_now (server-side enforced — adding
        --               a kind here is NOT enough on its own).
        'worker.backfill'
    ));

COMMENT ON CONSTRAINT pipeline_jobs_type_check ON pipeline_jobs IS
    'Whitelist of supported job types. Keep in sync with the dispatch '
    'switch in worker/modules/* claim() callers AND the admin_job_runner '
    'SCRIPT_WHITELIST when adding worker.backfill scripts.';
