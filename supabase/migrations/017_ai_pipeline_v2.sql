-- Migration 017 — AI Pipeline 2.0 (PR14)
--
-- Single Gemini call produces :
--   * description_fr (existing, kept)
--   * description_en / ko / es (NEW — multi-language)
--   * ai_thumbnail_timestamp_sec (NEW — "best second in clip for poster frame")
--   * ai_qc_timer_sec (NEW — in-game timer read from clip midpoint)
--   * ai_qc_drift_sec (NEW — |ai_qc_timer_sec - expected_game_time|)
--
-- Drives :
--   - Frontend lang switcher (FR default, EN / KO / ES fallback)
--   - Thumbnail re-extraction at the AI-picked timestamp (replaces
--     luminance heuristic — catches the kill moment, not loading screens)
--   - Per-clip QC (drift > 30s → needs_reclip=TRUE, bypasses sampled
--     qc_sampler path for newly-analyzed clips)
--
-- Backward compat :
--   - ai_description (FR) stays canonical. Frontend reads
--     COALESCE(ai_description_fr, ai_description) so older clips work.
--   - Older clips analyzed pre-PR14 have NULL translation columns →
--     frontend falls back to FR.

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS ai_description_fr TEXT,
    ADD COLUMN IF NOT EXISTS ai_description_en TEXT,
    ADD COLUMN IF NOT EXISTS ai_description_ko TEXT,
    ADD COLUMN IF NOT EXISTS ai_description_es TEXT,
    ADD COLUMN IF NOT EXISTS ai_thumbnail_timestamp_sec INT,
    ADD COLUMN IF NOT EXISTS ai_qc_timer_sec INT,
    ADD COLUMN IF NOT EXISTS ai_qc_drift_sec INT,
    ADD COLUMN IF NOT EXISTS ai_pipeline_version TEXT DEFAULT 'v1';

COMMENT ON COLUMN kills.ai_description_en IS
    'English description. Gemini-generated alongside the French version '
    'in a single call (PR14). NULL = pre-PR14 clip, frontend falls back '
    'to ai_description (French canonical).';

COMMENT ON COLUMN kills.ai_description_ko IS
    'Korean description for LCK-fan audience following KC''s Korean players.';

COMMENT ON COLUMN kills.ai_description_es IS
    'Spanish description for LATAM fanbase.';

COMMENT ON COLUMN kills.ai_thumbnail_timestamp_sec IS
    'AI-picked second IN the clip (0-40) that best represents the kill '
    'moment. Replaces the luminance × variance heuristic. Set by the '
    'analyzer ; clipper re-extracts thumbnail at this offset.';

COMMENT ON COLUMN kills.ai_qc_timer_sec IS
    'In-game MM:SS timer read by Gemini from the clip midpoint, converted '
    'to seconds. Compared against game_time_seconds to detect offset drift.';

COMMENT ON COLUMN kills.ai_qc_drift_sec IS
    '|ai_qc_timer_sec - game_time_seconds|. If > 30, the offset is wrong '
    'and needs_reclip is set to TRUE automatically (bypasses the sampled '
    'qc_sampler path for newly-analyzed clips).';

COMMENT ON COLUMN kills.ai_pipeline_version IS
    'Analyzer pipeline version that produced the AI fields. "v1" = '
    'Flash-Lite single-lang (pre-PR14). "v2" = multi-lang + timer QC '
    '+ thumbnail picker (PR14).';
