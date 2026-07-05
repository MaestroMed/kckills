-- ═══════════════════════════════════════════════════════════════════
-- 084 — Backfill deterministic time dimensions (audit 2026-07-02)
--
-- game_minute_bucket + lane_phase (migration 004) had NO active writer
-- since the Scroll Vivant analyzer refactor was dropped — the /clips
-- minute/phase filters always returned 0 rows and the grid's default
-- axis was empty. Both columns are pure functions of
-- game_time_seconds, so they are backfilled in SQL and the worker now
-- writes them at insertion (models/kill_event.py).
--
-- Formulas mirror worker/models/kill_event.py :
--   minute_bucket : floor(min/5)*5 → "0-5" … "30-35", "35+"
--   lane_phase    : <14min early / 14-25min mid / >25min late
--
-- champion_class + matchup_lane stay NULL (they need real data, not a
-- formula) — the /clips UI hides those filters until a writer exists.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

UPDATE kills
SET game_minute_bucket = CASE
        WHEN game_time_seconds / 60 >= 35 THEN '35+'
        ELSE (
            ((game_time_seconds / 60) / 5 * 5)::text
            || '-' ||
            ((game_time_seconds / 60) / 5 * 5 + 5)::text
        )
    END
WHERE game_time_seconds IS NOT NULL
  AND game_minute_bucket IS NULL;

UPDATE kills
SET lane_phase = CASE
        WHEN game_time_seconds / 60 < 14 THEN 'early'
        WHEN game_time_seconds / 60 <= 25 THEN 'mid'
        ELSE 'late'
    END
WHERE game_time_seconds IS NOT NULL
  AND lane_phase IS NULL;

COMMIT;
