-- ═══════════════════════════════════════════════════════════════════════
-- Migration 049 — channel_videos.status accepts 'skipped_<kind>' values
-- ═══════════════════════════════════════════════════════════════════════
--
-- Why this exists
-- ───────────────
-- The channel reconciler v3+ (modules/channel_reconciler.py L827-849)
-- writes status = `skipped_<kind>` for non-game videos like reveals,
-- vlogs, drama, interviews, etc. The pre-filter saves Gemini quota by
-- not running the parser on videos that visibly aren't game content.
--
-- Migration 011 (the original channel_discovery schema) only allowed
-- six status values via CHECK constraint :
--   'discovered', 'classified', 'matched', 'clipped', 'not_kc', 'manual_review'
--
-- Since v3 reconciler shipped, every "skipped_*" write fails with :
--   23514 — new row for relation "channel_videos" violates check
--   constraint "channel_videos_status_check"
--
-- Production worker logs spam this 50-100 times per reconciler cycle
-- — every Karmine Life vlog, every TCG reveal, every Kameto Réagit
-- video gets re-classified on every poll and the UPDATE bounces.
--
-- This migration drops the original CHECK and replaces it with a
-- broader one that accepts the original 6 values + the 8 skipped_*
-- kinds the reconciler currently emits.
--
-- Rollback
-- ────────
-- Drop the new check, recreate the original. Safe — no data shape change.

-- 1. Drop the existing CHECK if present (name from migration 011)
ALTER TABLE channel_videos
    DROP CONSTRAINT IF EXISTS channel_videos_status_check;

-- 2. Add the broader CHECK that includes skipped_* kinds
ALTER TABLE channel_videos
    ADD CONSTRAINT channel_videos_status_check
    CHECK (status IN (
        -- Original v1 reconciler states
        'discovered',
        'classified',
        'matched',
        'clipped',
        'not_kc',
        'manual_review',
        -- v3 reconciler pre-filter outputs (one per filtered video kind).
        -- The kind is the second word in the original status text :
        --   skipped_reveal     — TCG / merch / sponsorship videos
        --   skipped_vlog       — "Karmine Life #N" daily vlogs
        --   skipped_drama      — beef / call-out / response videos
        --   skipped_interview  — post-match interviews
        --   skipped_reaction   — Kameto réagit / réactions
        --   skipped_irrelevant — random short clips with no game match
        --   skipped_loading    — unwatched livestream waiting rooms
        --   skipped_shorts     — YouTube Shorts (nested in main playlist)
        'skipped_reveal',
        'skipped_vlog',
        'skipped_drama',
        'skipped_interview',
        'skipped_reaction',
        'skipped_irrelevant',
        'skipped_loading',
        'skipped_shorts',
        'skipped_other',
        -- v4 reconciler addition — when classify_video_kind returns
        -- "match" we still need to know if the parser succeeded :
        --   match_no_parse — title looks like a match but parser couldn't
        --                     pull team / opponent / date out of it
        'match_no_parse'
    ));

COMMENT ON CONSTRAINT channel_videos_status_check ON channel_videos IS
    'Wave 12 fix — status now includes skipped_<kind> values written '
    'by the v3+ reconciler pre-filter. Without this, every reveal / '
    'vlog / drama video the reconciler skips fails with 23514 and '
    'spams the production logs.';
