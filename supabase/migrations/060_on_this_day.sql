-- Migration 060 — Wave 28 (2026-05-11) — "On This Day" RPC
--
-- A single read-only function that returns published kills which happened
-- on the same calendar date (month + day) in past years. Used by the
-- homepage `<OnThisDay />` banner to surface nostalgia content :
-- "Il y a 4 ans aujourd'hui, Cabochard 1v3 vs G2".
--
-- The date is derived from each kill's parent match `scheduled_at` rather
-- than from `kills.created_at` (which would reflect when the worker
-- ingested the kill, not when the match was actually played in real
-- life). All kills inherit their match's scheduled_at via :
--   kills.game_id → games.match_id → matches.scheduled_at
--
-- Apply via the Supabase Management API :
--   curl -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
--        -H "Authorization: Bearer $SUPABASE_PAT" \
--        -H "Content-Type: application/json" \
--        -d "{\"query\": \"$(cat 060_on_this_day.sql | tr '\n' ' ')\"}"
--
-- Idempotent : the function is dropped+recreated, no schema diff on re-run.

BEGIN;

-- ─── fn_on_this_day ──────────────────────────────────────────────────
-- Returns kills from (month, day) in the past, excluding the current
-- year. Hard-gates on status='published' AND clip_url_vertical IS NOT
-- NULL so the homepage never shows a half-pipeline kill.
--
-- Ordered : most-recent year first, then by highlight_score DESC within
-- each year. Capped at p_limit rows so the homepage banner stays cheap.

DROP FUNCTION IF EXISTS fn_on_this_day(INT, INT, INT, INT);

CREATE OR REPLACE FUNCTION fn_on_this_day(
    p_month        INT,
    p_day          INT,
    p_exclude_year INT DEFAULT 0,
    p_limit        INT DEFAULT 12
)
RETURNS TABLE (
    id                     UUID,
    killer_champion        TEXT,
    victim_champion        TEXT,
    killer_ign             TEXT,
    victim_ign             TEXT,
    clip_url_vertical      TEXT,
    clip_url_vertical_low  TEXT,
    thumbnail_url          TEXT,
    highlight_score        FLOAT,
    avg_rating             FLOAT,
    rating_count           INT,
    multi_kill             TEXT,
    is_first_blood         BOOLEAN,
    tracked_team_involvement TEXT,
    ai_description         TEXT,
    match_date             TIMESTAMPTZ,
    years_ago              INT,
    match_stage            TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_current_year INT := EXTRACT(YEAR FROM now())::INT;
BEGIN
    -- Defensive : reject invalid month/day combos so the planner doesn't
    -- silently scan everything.
    IF p_month < 1 OR p_month > 12 OR p_day < 1 OR p_day > 31 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        k.id,
        k.killer_champion,
        k.victim_champion,
        p1.ign  AS killer_ign,
        p2.ign  AS victim_ign,
        k.clip_url_vertical,
        k.clip_url_vertical_low,
        k.thumbnail_url,
        k.highlight_score,
        k.avg_rating,
        k.rating_count,
        k.multi_kill,
        k.is_first_blood,
        k.tracked_team_involvement,
        k.ai_description,
        m.scheduled_at         AS match_date,
        (v_current_year - EXTRACT(YEAR FROM m.scheduled_at)::INT) AS years_ago,
        m.stage                AS match_stage
    FROM   kills k
    JOIN   games   g ON g.id = k.game_id
    JOIN   matches m ON m.id = g.match_id
    LEFT   JOIN players p1 ON p1.id = k.killer_player_id
    LEFT   JOIN players p2 ON p2.id = k.victim_player_id
    WHERE  k.status = 'published'
      AND  k.clip_url_vertical IS NOT NULL
      AND  m.scheduled_at IS NOT NULL
      AND  EXTRACT(MONTH FROM m.scheduled_at)::INT = p_month
      AND  EXTRACT(DAY   FROM m.scheduled_at)::INT = p_day
      AND  EXTRACT(YEAR  FROM m.scheduled_at)::INT <> COALESCE(NULLIF(p_exclude_year, 0), v_current_year)
    ORDER  BY m.scheduled_at DESC,
              k.highlight_score DESC NULLS LAST,
              k.avg_rating DESC NULLS LAST
    LIMIT  GREATEST(p_limit, 1);
END;
$$;

-- Grant execute to anon + authenticated so the public homepage can call
-- it without an auth session. SECURITY DEFINER + search_path lock above
-- means the function still runs with the function-owner's privileges,
-- but the row return path stays read-only.
GRANT EXECUTE ON FUNCTION fn_on_this_day(INT, INT, INT, INT) TO anon, authenticated;

COMMENT ON FUNCTION fn_on_this_day IS
    'On This Day — kills from (p_month, p_day) in past years, excluding the current year by default. Wave 28 / 2026-05-11.';

COMMIT;
