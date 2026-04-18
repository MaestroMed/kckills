-- Migration 007 — HLS adaptive streaming columns
--
-- Adds optional HLS manifest URLs to kills + moments. Both columns are
-- NULLABLE so existing rows keep working with the MP4 progressive
-- fallback. The /scroll-v2 player consumes hls_master_url first; if
-- NULL it falls back to clip_url_vertical (legacy MP4).
--
-- The worker's new hls_packager module writes to these columns AFTER
-- the legacy clip pipeline succeeds. That way HLS encoding failures
-- don't poison the regular clip — worst case the user gets MP4
-- instead of adaptive HLS.
--
-- Backfill plan: a one-shot script will iterate every published kill
-- with hls_master_url IS NULL and re-encode in place. Estimated 5GB
-- of additional R2 storage for the current 340-clip backlog.

-- ─── Per-clip master playlist URL ──────────────────────────────────
-- Points to the .m3u8 master that lists all bitrate variants. The
-- video element's src is set to this URL — hls.js (or Safari native)
-- handles the variant selection automatically.

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS hls_master_url TEXT;

ALTER TABLE moments
    ADD COLUMN IF NOT EXISTS hls_master_url TEXT;

-- ─── Encoding metadata (debugging + audit) ─────────────────────────
-- bitrates_kbps records what variants were encoded so we can detect
-- partial failures (e.g. 720p variant missing). encoded_at lets us
-- spot stale encodings if we change the ladder later.

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS hls_bitrates_kbps INT[],
    ADD COLUMN IF NOT EXISTS hls_encoded_at TIMESTAMPTZ;

ALTER TABLE moments
    ADD COLUMN IF NOT EXISTS hls_bitrates_kbps INT[],
    ADD COLUMN IF NOT EXISTS hls_encoded_at TIMESTAMPTZ;

-- ─── Indexes ───────────────────────────────────────────────────────
-- Predicate index — find rows still needing HLS encoding without a
-- full table scan. Used by the backfill cron.

CREATE INDEX IF NOT EXISTS idx_kills_pending_hls
    ON kills (created_at)
    WHERE hls_master_url IS NULL AND status = 'published';

CREATE INDEX IF NOT EXISTS idx_moments_pending_hls
    ON moments (created_at)
    WHERE hls_master_url IS NULL;

-- ─── Comments for the schema browser ───────────────────────────────

COMMENT ON COLUMN kills.hls_master_url IS
    'HLS .m3u8 master playlist on R2. NULL = clip not yet HLS-packaged, fall back to clip_url_vertical MP4.';

COMMENT ON COLUMN kills.hls_bitrates_kbps IS
    'Bitrate ladder actually encoded, e.g. {400, 1000, 2500} for 240p/480p/720p. Empty array means encoding failed.';

COMMENT ON COLUMN kills.hls_encoded_at IS
    'Timestamp of last successful HLS encode. Re-encoding sets a new value.';
