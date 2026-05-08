-- Migration 058 — Wave 25.2 (2026-05-08).
-- V33 : profile-level "make my bookmarks public" opt-in flag.
-- V37 : `community_clips` doesn't need new columns — just an index
--       + a public-read RLS policy refresh so they can be folded
--       into /scroll feeds at low priority.
-- V41 : new `kill_captions` table for the auto-caption pipeline
--       (Whisper / Gemini transcribe → SRT track → R2). Worker
--       module ships next ; the table is the contract.
-- V49 : new `daily_highlight_reels` table for the auto-mashup pipeline.
-- V50 : new `kill_annotations` table for the editor-mode community
--       overlays (V50 scaffold).
--
-- Idempotent.

BEGIN;

-- ─── V33 — public bookmarks opt-in ───────────────────────────────
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS public_bookmarks BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN profiles.public_bookmarks IS
    'Wave 25.2 / V33 : user opt-in to surface their kill_bookmarks '
    'list on their /u/[username] page. Default FALSE (privacy by '
    'default). UI in /settings flips it.';

-- Permission to read bookmarks of users who opted in.
DROP POLICY IF EXISTS "kill_bookmarks public_when_owner_opted_in" ON kill_bookmarks;
CREATE POLICY "kill_bookmarks public_when_owner_opted_in" ON kill_bookmarks
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = kill_bookmarks.user_id
            AND p.public_bookmarks = TRUE
        )
    );

-- ─── V41 — kill captions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kill_captions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id     UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
    language    TEXT NOT NULL DEFAULT 'fr',
    /** SRT-format transcript or VTT cue text. */
    text        TEXT NOT NULL,
    /** R2 URL of the .vtt / .srt file when uploaded ; NULL if inline. */
    vtt_url     TEXT,
    model       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (kill_id, language)
);
CREATE INDEX IF NOT EXISTS idx_kill_captions_kill
    ON kill_captions (kill_id);
ALTER TABLE kill_captions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kill_captions public read" ON kill_captions;
CREATE POLICY "kill_captions public read" ON kill_captions
    FOR SELECT USING (TRUE);

-- ─── V49 — daily highlight reels ─────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_highlight_reels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    /** YYYY-MM-DD for which the reel was assembled. UNIQUE. */
    reel_date   DATE NOT NULL UNIQUE,
    /** R2 URL of the assembled MP4 (16:9 + 9:16 if both available). */
    mp4_url_horizontal TEXT,
    mp4_url_vertical   TEXT,
    /** Ordered list of kill_ids that made the reel. */
    kill_ids    UUID[] NOT NULL DEFAULT '{}',
    duration_s  INT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE daily_highlight_reels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reels public read" ON daily_highlight_reels;
CREATE POLICY "reels public read" ON daily_highlight_reels
    FOR SELECT USING (TRUE);

-- ─── V50 — kill annotations (editor mode scaffold) ───────────────
CREATE TABLE IF NOT EXISTS kill_annotations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id     UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    /** ms offset within the clip where the annotation appears. */
    offset_ms   INT NOT NULL CHECK (offset_ms >= 0),
    duration_ms INT NOT NULL CHECK (duration_ms BETWEEN 500 AND 10000),
    /** Annotation type — text overlay / arrow / circle / freehand. */
    kind        TEXT NOT NULL CHECK (kind IN ('text','arrow','circle','freehand')),
    /** Geometry / payload as JSON (positions, colors, text). */
    payload     JSONB NOT NULL DEFAULT '{}',
    moderation_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (moderation_status IN ('pending','approved','rejected')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kill_annotations_kill
    ON kill_annotations (kill_id, offset_ms)
    WHERE moderation_status = 'approved';
ALTER TABLE kill_annotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "annotations public approved" ON kill_annotations;
CREATE POLICY "annotations public approved" ON kill_annotations
    FOR SELECT USING (moderation_status = 'approved');
DROP POLICY IF EXISTS "annotations own write" ON kill_annotations;
CREATE POLICY "annotations own write" ON kill_annotations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ─── V42 — best-thumbnail timestamp on kills ─────────────────────
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS best_thumbnail_seconds INT
        CHECK (best_thumbnail_seconds IS NULL OR best_thumbnail_seconds BETWEEN 0 AND 60);
COMMENT ON COLUMN kills.best_thumbnail_seconds IS
    'Wave 25.2 / V42 : analyser-derived offset (in seconds within '
    'the clip) of the most informative frame. Used by the FeedPlayerPool '
    'to seek the LIVE-slot video to that frame BEFORE first paint, '
    'making the poster image already-the-action-frame instead of a '
    'random 0-sec cover. Populated by the analyser when '
    'best_thumbnail_timestamp_in_clip_sec is in the response.';

COMMIT;
