-- Migration 044 — Kills i18n description columns (Wave 11 / translator daemon)
--
-- The analyzer already stores `ai_description_fr` (and the per-language
-- columns ai_description_en/ko/es exist as NULLABLE Gemini outputs from
-- the analyzer's prompt). Wave 11 ships a dedicated translator daemon
-- that fills those columns asynchronously when the analyzer's own
-- multi-language output is missing or low-quality, using DeepSeek V4
-- Flash (cheapest non-PII text provider) via the new ai_router.
--
-- Schema changes :
--   * Ensure ai_description_en / ai_description_ko / ai_description_es
--     exist on the kills table (idempotent — they may already exist).
--   * Add ai_descriptions_translated_at TIMESTAMPTZ to mark when the
--     translator last touched a row, so the daemon can skip rows that
--     were translated in the last 7 days even if a re-analyze later
--     blanked one of the language columns (avoids translation churn).
--   * Partial index on (updated_at) WHERE status='published' AND
--     ai_description IS NOT NULL AND any of the three target columns
--     is NULL — this is the daemon's pending-rows query, and a partial
--     index keeps it O(log n) even when the table grows to 100K kills.
--
-- Rollback : columns + index are nullable / removable safely. The
-- translator daemon is feature-flagged off by default
-- (KCKILLS_TRANSLATOR_ENABLED=false) so dropping these doesn't break
-- the worker.

-- ─── 1. Ensure target columns exist ───────────────────────────────
-- These are NULLABLE TEXT — the analyzer + the translator both write
-- here. The trigger fn_sync_ai_annotation_to_kill (from migration 028
-- onward) already mirrors the analyzer's per-language columns into
-- kills.* so a re-analyze of a row keeps these in sync. The translator
-- only writes when the analyzer's column is empty.

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS ai_description_en TEXT,
    ADD COLUMN IF NOT EXISTS ai_description_ko TEXT,
    ADD COLUMN IF NOT EXISTS ai_description_es TEXT;

-- ─── 2. Translator audit timestamp ────────────────────────────────
-- Bumped by the translator daemon on every write so we can chart
-- translation throughput in the dashboard and detect a stuck daemon.
-- Distinct from `updated_at` (which fires on EVERY kills update) —
-- this column ONLY moves when the translator wrote.

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS ai_descriptions_translated_at TIMESTAMPTZ;

COMMENT ON COLUMN kills.ai_descriptions_translated_at IS
    'Last time the translator daemon (modules/translator.py) wrote to '
    'ai_description_en / ai_description_ko / ai_description_es. Distinct '
    'from updated_at — only moves on translator writes. Daemon skips '
    'rows touched in the last 7 days to avoid retranslation churn.';

-- ─── 3. Pending-rows index ────────────────────────────────────────
-- The translator daemon's main query :
--   SELECT id, ai_description FROM kills
--   WHERE status='published'
--     AND ai_description IS NOT NULL
--     AND (ai_description_en IS NULL OR ai_description_ko IS NULL OR ai_description_es IS NULL)
--   ORDER BY updated_at DESC LIMIT 50
--
-- A standard B-tree index on updated_at is fine ; the partial filter
-- keeps the index small (only ~30% of published kills lack any one
-- language column at any given time, dropping further once the
-- daemon catches up).

CREATE INDEX IF NOT EXISTS idx_kills_translation_pending
    ON kills(updated_at)
 WHERE status = 'published'
   AND ai_description IS NOT NULL
   AND (
       ai_description_en IS NULL
    OR ai_description_ko IS NULL
    OR ai_description_es IS NULL
   );

COMMENT ON INDEX idx_kills_translation_pending IS
    'Partial index for translator daemon (Wave 11). Drives the per-cycle '
    'scan that picks rows missing at least one language. Index stays '
    'small because the partial WHERE excludes already-translated rows.';
