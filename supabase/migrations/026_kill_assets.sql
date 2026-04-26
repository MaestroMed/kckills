-- Migration 026 — kill_assets table + manifest column
--
-- Today the kills row carries 4 hard-coded asset URLs :
--   clip_url_horizontal, clip_url_vertical, clip_url_vertical_low, thumbnail_url
--
-- That works for v1 but breaks the moment we want to :
--   * re-clip with a fixed offset (need v1 + v2 side by side)
--   * add a 4K variant
--   * add a watermarked share variant
--   * audit which version a viewer actually got
--   * track encoding params (codec, bitrate, multipass, etc.)
--   * dedup byte-identical re-clips
--
-- New model :
--   kill_assets         — one row per (kill, version, type) tuple
--   kills.assets_manifest — a JSONB cache of the current set of URLs,
--                           refreshed on insert via trigger. The
--                           frontend reads the manifest column ;
--                           the worker writes via kill_assets.

CREATE TABLE IF NOT EXISTS kill_assets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id         UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
    version         INT NOT NULL,                     -- 1, 2, 3 for re-clips
    type            TEXT NOT NULL CHECK (type IN (
                        'horizontal',    -- 16:9 1920x1080 MP4
                        'vertical',      -- 9:16 1080x1920 MP4
                        'vertical_low',  -- 9:16 540x960 MP4 (data saver)
                        'hls_master',    -- HLS master playlist (vertical ladder)
                        'thumbnail',     -- 9:16 1080x1920 JPEG
                        'og_image',      -- 1200x630 PNG (Open Graph)
                        'preview_gif'    -- short looping 360p GIF (future)
                    )),
    -- Storage
    url             TEXT NOT NULL,                    -- public URL (R2 / CDN)
    r2_key          TEXT NOT NULL,                    -- bucket key
    -- Media metadata
    width           INT,
    height          INT,
    duration_ms     INT,
    codec           TEXT,
    bitrate_kbps    INT,
    size_bytes      BIGINT,
    -- Identity hashes (PR23.10)
    content_hash    TEXT,                             -- SHA-256 of file
    perceptual_hash TEXT,                             -- pHash of frame
    -- Provenance
    source_offset_seconds INT,                        -- vod offset used
    source_clip_window_seconds JSONB,                 -- { "start": s, "end": e }
    encoder_args    JSONB,                            -- ffmpeg args used
    encoding_node   TEXT,                             -- worker_id that encoded it
    -- Lifecycle
    is_current      BOOLEAN NOT NULL DEFAULT TRUE,    -- false on re-clip = old row archived
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);

-- One CURRENT asset per (kill, type) — re-clipping flips old to is_current=false.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kill_assets_one_current_per_type
    ON kill_assets(kill_id, type)
    WHERE is_current = TRUE;

-- All-versions lookup
CREATE INDEX IF NOT EXISTS idx_kill_assets_kill_version
    ON kill_assets(kill_id, version DESC, type);

-- Dedup byte-identical
CREATE INDEX IF NOT EXISTS idx_kill_assets_content_hash
    ON kill_assets(content_hash)
    WHERE content_hash IS NOT NULL;

-- ─── kills.assets_manifest cache column ─────────────────────────────
-- Denormalised JSON of all current assets so the frontend reads ONE
-- column instead of 4 SELECTs from kill_assets. Auto-refreshed by trigger.
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS assets_manifest JSONB;

CREATE INDEX IF NOT EXISTS idx_kills_assets_manifest_gin
    ON kills USING GIN (assets_manifest);

-- Refresh trigger : when a kill_asset row is inserted/updated/deleted,
-- rebuild the parent kill's manifest.
CREATE OR REPLACE FUNCTION fn_refresh_kill_assets_manifest()
RETURNS TRIGGER AS $$
DECLARE
    v_kill_id UUID;
    v_manifest JSONB;
BEGIN
    v_kill_id := COALESCE(NEW.kill_id, OLD.kill_id);
    SELECT jsonb_object_agg(
              type,
              jsonb_build_object(
                'url',         url,
                'width',       width,
                'height',      height,
                'duration_ms', duration_ms,
                'size_bytes',  size_bytes,
                'version',     version
              )
           )
      INTO v_manifest
      FROM kill_assets
     WHERE kill_id = v_kill_id
       AND is_current = TRUE;

    UPDATE kills
       SET assets_manifest = COALESCE(v_manifest, '{}'::jsonb)
     WHERE id = v_kill_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kill_assets_refresh_manifest ON kill_assets;
CREATE TRIGGER trg_kill_assets_refresh_manifest
    AFTER INSERT OR UPDATE OR DELETE ON kill_assets
    FOR EACH ROW
    EXECUTE FUNCTION fn_refresh_kill_assets_manifest();

-- ─── Backfill existing clip_url_* into kill_assets v1 ────────────────
-- Idempotent : skip if already populated.
INSERT INTO kill_assets (kill_id, version, type, url, r2_key, is_current)
SELECT
    id, 1, 'horizontal', clip_url_horizontal,
    'clips/' || id || '/v1/h.mp4', TRUE
  FROM kills
 WHERE clip_url_horizontal IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO kill_assets (kill_id, version, type, url, r2_key, is_current)
SELECT
    id, 1, 'vertical', clip_url_vertical,
    'clips/' || id || '/v1/v.mp4', TRUE
  FROM kills
 WHERE clip_url_vertical IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO kill_assets (kill_id, version, type, url, r2_key, is_current)
SELECT
    id, 1, 'vertical_low', clip_url_vertical_low,
    'clips/' || id || '/v1/v_low.mp4', TRUE
  FROM kills
 WHERE clip_url_vertical_low IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO kill_assets (kill_id, version, type, url, r2_key, is_current)
SELECT
    id, 1, 'thumbnail', thumbnail_url,
    'thumbnails/' || id || '/v1/thumb.jpg', TRUE
  FROM kills
 WHERE thumbnail_url IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO kill_assets (kill_id, version, type, url, r2_key, is_current)
SELECT
    id, 1, 'hls_master', hls_master_url,
    'hls/' || id || '/v1/master.m3u8', TRUE
  FROM kills
 WHERE hls_master_url IS NOT NULL
ON CONFLICT DO NOTHING;

-- ─── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE kill_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read kill_assets current" ON kill_assets;
CREATE POLICY "Public read kill_assets current" ON kill_assets
    FOR SELECT USING (is_current = TRUE);

COMMENT ON TABLE kill_assets IS
    'Versioned media assets per kill. Replaces the hardcoded clip_url_* '
    'columns on kills (which stay for back-compat but become read-only).';
