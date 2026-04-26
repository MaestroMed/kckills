-- Migration 028 — AI annotations versioning
--
-- The analyzer stamps ai_description_*, ai_tags, highlight_score directly
-- onto the kills row. That works for v1 but loses :
--   * which model produced this score (Flash-Lite v2.5? Pro v3.1?)
--   * which prompt version (we tweak prompts often)
--   * the input asset version (analyzed v1 clip vs v2 clip with new offset)
--   * confidence
--   * raw response (for debugging "why did you score this 9/10?")
--   * historical scores when re-analyzed
--
-- ai_annotations gives one row per (kill, model, version) tuple. The
-- LATEST is_current=true tuple feeds the kills row's denormalised
-- ai_description_* fields via trigger.

CREATE TABLE IF NOT EXISTS ai_annotations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id         UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
    -- Provenance
    model_provider  TEXT NOT NULL,                    -- 'gemini' | 'anthropic' | 'openai'
    model_name      TEXT NOT NULL,                    -- 'gemini-2.5-flash-lite', 'gemini-3-pro-preview'
    prompt_version  TEXT NOT NULL,                    -- 'analyzer-v3' (bumped when we change wording)
    analysis_version TEXT NOT NULL,                   -- 'v1', 'v2' (overall pipeline iteration)
    input_asset_id  UUID REFERENCES kill_assets(id) ON DELETE SET NULL,
    input_asset_version INT,                          -- snapshot in case asset is re-clipped
    -- Output
    highlight_score FLOAT,
    ai_tags         JSONB,
    ai_description_fr TEXT,
    ai_description_en TEXT,
    ai_description_ko TEXT,
    ai_description_es TEXT,
    ai_thumbnail_timestamp_sec INT,
    confidence_score FLOAT,                           -- 0-1, model's self-rated confidence
    raw_response    JSONB,                            -- full model output for replay/debug
    -- Cost tracking
    input_tokens    INT,
    output_tokens   INT,
    cost_usd        NUMERIC(10, 6),
    latency_ms      INT,
    -- Lifecycle
    is_current      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ
);

-- One CURRENT annotation per kill — re-analysis flips old to is_current=false.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_annotations_one_current
    ON ai_annotations(kill_id)
    WHERE is_current = TRUE;

-- All-versions lookup
CREATE INDEX IF NOT EXISTS idx_ai_annotations_kill_recent
    ON ai_annotations(kill_id, created_at DESC);

-- Find by model for cost/quality analysis
CREATE INDEX IF NOT EXISTS idx_ai_annotations_model
    ON ai_annotations(model_provider, model_name, created_at DESC);

-- ─── Trigger : sync current annotation to kills row ────────────────
-- Keeps backwards-compat with code that still reads kills.ai_description_*.
CREATE OR REPLACE FUNCTION fn_sync_ai_annotation_to_kill()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_current THEN
        UPDATE kills SET
            highlight_score = NEW.highlight_score,
            ai_tags = COALESCE(NEW.ai_tags, ai_tags),
            ai_description = COALESCE(NEW.ai_description_fr, ai_description),
            ai_description_fr = COALESCE(NEW.ai_description_fr, ai_description_fr),
            ai_description_en = COALESCE(NEW.ai_description_en, ai_description_en),
            ai_description_ko = COALESCE(NEW.ai_description_ko, ai_description_ko),
            ai_description_es = COALESCE(NEW.ai_description_es, ai_description_es),
            ai_thumbnail_timestamp_sec = COALESCE(NEW.ai_thumbnail_timestamp_sec, ai_thumbnail_timestamp_sec),
            updated_at = now()
        WHERE id = NEW.kill_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_ai_annotation ON ai_annotations;
CREATE TRIGGER trg_sync_ai_annotation
    AFTER INSERT OR UPDATE ON ai_annotations
    FOR EACH ROW
    EXECUTE FUNCTION fn_sync_ai_annotation_to_kill();

-- ─── RLS ────────────────────────────────────────────────────────────
ALTER TABLE ai_annotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read current ai_annotations" ON ai_annotations;
CREATE POLICY "Public read current ai_annotations" ON ai_annotations
    FOR SELECT USING (is_current = TRUE);

-- ─── Cost summary view (for /admin/analytics) ──────────────────────
CREATE OR REPLACE VIEW v_ai_cost_24h AS
SELECT
    model_provider,
    model_name,
    COUNT(*)                   AS calls_24h,
    SUM(input_tokens)          AS input_tokens_24h,
    SUM(output_tokens)         AS output_tokens_24h,
    SUM(cost_usd)              AS cost_usd_24h,
    AVG(latency_ms)::int       AS avg_latency_ms,
    AVG(confidence_score)      AS avg_confidence
  FROM ai_annotations
 WHERE created_at > now() - interval '24 hours'
 GROUP BY model_provider, model_name;

COMMENT ON TABLE ai_annotations IS
    'Versioned AI output per kill. Latest is_current=TRUE row syncs to kills.* '
    'denormalised fields via trigger. Prior versions kept for audit.';
