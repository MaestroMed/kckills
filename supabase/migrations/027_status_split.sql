-- Migration 027 — Status splitting (4 dimensions instead of 1)
--
-- Today `kills.status` carries 4 different concerns simultaneously :
--   * pipeline progress  (raw → clipped → analyzed)
--   * publication state  (published / retracted)
--   * QC state           (passing / failing)
--   * asset state        (missing / ready / corrupted)
--
-- That collapses signals : a kill stuck in `analyzed` could be QC-failed
-- OR pipeline-not-yet-published OR publisher-buggy. Split into 4 fields.
--
-- Migration strategy :
--   1. Add the 4 new columns nullable
--   2. Backfill from current `status`
--   3. Keep `status` (back-compat) — frontend gradually migrates
--   4. Add a GENERATED legacy `status` view for clients that haven't migrated

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS pipeline_status TEXT,
    ADD COLUMN IF NOT EXISTS publication_status TEXT,
    ADD COLUMN IF NOT EXISTS qc_status TEXT,
    ADD COLUMN IF NOT EXISTS asset_status TEXT;

-- ─── CHECK constraints ─────────────────────────────────────────────
ALTER TABLE kills
    DROP CONSTRAINT IF EXISTS chk_pipeline_status;
ALTER TABLE kills
    ADD CONSTRAINT chk_pipeline_status CHECK (pipeline_status IN (
        'raw',          -- harvester inserted, no VOD yet
        'vod_found',    -- has vod_youtube_id, ready for clipper
        'clipping',     -- clipper has it
        'clipped',      -- clip files on R2
        'analyzing',    -- analyzer has it
        'analyzed',     -- AI annotations done
        'failed',       -- terminal failure
        NULL
    ) OR pipeline_status IS NULL);

ALTER TABLE kills
    DROP CONSTRAINT IF EXISTS chk_publication_status;
ALTER TABLE kills
    ADD CONSTRAINT chk_publication_status CHECK (publication_status IN (
        'draft',        -- not yet eligible
        'publishable',  -- all gates green, awaiting publisher tick
        'published',    -- visible on /scroll
        'retracted',    -- was published, pulled by QC
        'hidden',       -- admin hide (kill_visible=false equivalent)
        NULL
    ) OR publication_status IS NULL);

ALTER TABLE kills
    DROP CONSTRAINT IF EXISTS chk_qc_status;
ALTER TABLE kills
    ADD CONSTRAINT chk_qc_status CHECK (qc_status IN (
        'pending',          -- not yet QCed
        'passed',           -- QC OK
        'failed',           -- QC drift / unreadable
        'human_review',     -- flagged for editor
        NULL
    ) OR qc_status IS NULL);

ALTER TABLE kills
    DROP CONSTRAINT IF EXISTS chk_asset_status;
ALTER TABLE kills
    ADD CONSTRAINT chk_asset_status CHECK (asset_status IN (
        'missing',          -- no clip files
        'processing',       -- clipper running
        'ready',            -- all 4 variants on R2
        'partial',          -- some variants missing
        'corrupted',        -- known-bad
        NULL
    ) OR asset_status IS NULL);

-- ─── Backfill from existing `status` ──────────────────────────────
UPDATE kills SET
    pipeline_status = CASE
        WHEN status IN ('raw') THEN 'raw'
        WHEN status IN ('vod_found') THEN 'vod_found'
        WHEN status IN ('clipping') THEN 'clipping'
        WHEN status IN ('clipped') THEN 'clipped'
        WHEN status IN ('analyzed', 'published') THEN 'analyzed'
        WHEN status IN ('clip_error', 'manual_review') THEN 'failed'
        ELSE 'raw'
    END,
    publication_status = CASE
        WHEN status = 'published' AND kill_visible IS NOT FALSE THEN 'published'
        WHEN status = 'published' AND kill_visible = FALSE THEN 'hidden'
        WHEN status = 'analyzed' THEN 'publishable'  -- close to publishing
        WHEN status = 'manual_review' THEN 'hidden'
        ELSE 'draft'
    END,
    qc_status = CASE
        WHEN kill_visible = FALSE THEN 'failed'
        WHEN kill_visible = TRUE AND status IN ('analyzed', 'published') THEN 'passed'
        WHEN status = 'manual_review' THEN 'human_review'
        ELSE 'pending'
    END,
    asset_status = CASE
        WHEN clip_url_vertical IS NOT NULL AND clip_url_horizontal IS NOT NULL AND thumbnail_url IS NOT NULL THEN 'ready'
        WHEN clip_url_vertical IS NOT NULL OR clip_url_horizontal IS NOT NULL THEN 'partial'
        WHEN status = 'clipping' THEN 'processing'
        WHEN status = 'clip_error' THEN 'missing'
        ELSE 'missing'
    END
 WHERE pipeline_status IS NULL;

-- ─── Indexes for the new dimensions ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_kills_pipeline_status
    ON kills(pipeline_status, created_at DESC)
    WHERE pipeline_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kills_publication_status
    ON kills(publication_status, created_at DESC)
    WHERE publication_status = 'published';

CREATE INDEX IF NOT EXISTS idx_kills_qc_pending
    ON kills(qc_status, created_at DESC)
    WHERE qc_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_kills_asset_ready
    ON kills(asset_status, highlight_score DESC NULLS LAST)
    WHERE asset_status = 'ready';

-- ─── Sync trigger : when legacy `status` is updated, recompute the 4 ────
-- During the migration window, callers may write either side. Trigger
-- keeps them in sync. Drop after the codebase stops writing legacy.
CREATE OR REPLACE FUNCTION fn_sync_kill_status_split()
RETURNS TRIGGER AS $$
BEGIN
    -- Only run when `status` changed and the new dims weren't explicitly set.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.pipeline_status IS NOT DISTINCT FROM OLD.pipeline_status THEN
            NEW.pipeline_status := CASE
                WHEN NEW.status IN ('raw') THEN 'raw'
                WHEN NEW.status IN ('vod_found') THEN 'vod_found'
                WHEN NEW.status IN ('clipping') THEN 'clipping'
                WHEN NEW.status IN ('clipped') THEN 'clipped'
                WHEN NEW.status IN ('analyzed', 'published') THEN 'analyzed'
                WHEN NEW.status IN ('clip_error', 'manual_review') THEN 'failed'
                ELSE NEW.pipeline_status
            END;
        END IF;
        IF NEW.publication_status IS NOT DISTINCT FROM OLD.publication_status THEN
            NEW.publication_status := CASE
                WHEN NEW.status = 'published' AND NEW.kill_visible IS NOT FALSE THEN 'published'
                WHEN NEW.status = 'published' AND NEW.kill_visible = FALSE THEN 'hidden'
                WHEN NEW.status = 'analyzed' THEN 'publishable'
                WHEN NEW.status = 'manual_review' THEN 'hidden'
                ELSE NEW.publication_status
            END;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_kill_status_split ON kills;
CREATE TRIGGER trg_sync_kill_status_split
    BEFORE UPDATE OF status ON kills
    FOR EACH ROW
    EXECUTE FUNCTION fn_sync_kill_status_split();

COMMENT ON COLUMN kills.pipeline_status IS
    'PR23-arch — pipeline progression. Independent of publication_status.';
COMMENT ON COLUMN kills.publication_status IS
    'PR23-arch — visibility on the public site.';
COMMENT ON COLUMN kills.qc_status IS
    'PR23-arch — Gemini QC verdict (passes / fails / pending).';
COMMENT ON COLUMN kills.asset_status IS
    'PR23-arch — file readiness on R2 (missing / processing / ready).';
