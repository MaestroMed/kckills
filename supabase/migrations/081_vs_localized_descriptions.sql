-- ════════════════════════════════════════════════════════════════════
-- 081 — VS surfaces: SELECT localized descriptions (Wave 36)
-- ════════════════════════════════════════════════════════════════════
--
-- BUG (i18n leak on /vs and /vs/leaderboard):
--   The two VS Roulette RPCs only project the French description column
--   (`ai_description`) and never the per-language columns the translator
--   daemon fills (migration 044 — `ai_description_en` / `ai_description_ko`
--   / `ai_description_es`). The frontend's lang-aware picker therefore has
--   no localized text to choose from on these surfaces, so non-FR users
--   always see French on the VS roulette card and the ELO leaderboard.
--
--   Affected functions (canonical definitions):
--     * fn_pick_vs_pair(JSONB, JSONB)          — migration 059
--     * fn_top_elo_kills_v2(INT,INT,TEXT,TEXT,TEXT,TEXT,INT) — migration 064
--
-- FIX: CREATE OR REPLACE both functions so they ALSO project
--   ai_description_en / ai_description_ko / ai_description_es alongside the
--   existing ai_description (FR). Every other field, the exact signatures,
--   and the GRANTs are preserved verbatim.
--     * fn_pick_vs_pair builds each side via `to_jsonb(c.*)`, so adding the
--       three columns to the candidates CTE adds three JSON keys with those
--       exact names — no signature change, the RETURNS TABLE shape (kill_a
--       JSONB, kill_b JSONB) is untouched.
--     * fn_top_elo_kills_v2 returns explicit columns, so we append three new
--       trailing TEXT output columns (additive — existing positional/named
--       consumers keep working; the DROP handles the RETURNS-TABLE change).
--
-- Column names verified against the `kills` table definition: the FR base
-- is `ai_description` (there is no `description_fr`); migration 044 added
-- `ai_description_en`, `ai_description_ko`, `ai_description_es`.
--
-- Transaction-safe (no CONCURRENTLY / VACUUM) → applies cleanly in the
-- Supabase SQL Editor. Idempotent (DROP IF EXISTS before each CREATE).
--
-- Apply via the Supabase Management API :
--   curl -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
--        -H "Authorization: Bearer $SUPABASE_PAT" \
--        -H "Content-Type: application/json" \
--        --data-binary @<(jq -Rs '{query: .}' < 081_vs_localized_descriptions.sql)

BEGIN;

-- ──────────────────────────────────────────────────────────────────────
-- fn_pick_vs_pair — now projects ai_description_en/_ko/_es into both sides
-- ──────────────────────────────────────────────────────────────────────
--
-- Unchanged from migration 059 except the two candidates CTEs each gain
-- three localized description columns (which flow into the side JSON via
-- to_jsonb(c.*)). Signature, hard filters, per-side filter handling, and
-- the GRANT are identical.

DROP FUNCTION IF EXISTS public.fn_pick_vs_pair(jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.fn_pick_vs_pair(
    left_filters  JSONB DEFAULT '{}'::jsonb,
    right_filters JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    kill_a JSONB,
    kill_b JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_kill_a JSONB;
    v_kill_b JSONB;
BEGIN
    -- Helper : pick one matching kill at random. Inlined twice (rather
    -- than as a sub-function) so we don't multiply privilege surface.

    WITH candidates AS (
        SELECT
            k.id,
            k.killer_champion,
            k.victim_champion,
            p1.ign            AS killer_name,
            p1.role           AS killer_role,
            p2.ign            AS victim_name,
            k.clip_url_vertical,
            k.clip_url_vertical_low,
            k.clip_url_horizontal,
            k.thumbnail_url,
            k.highlight_score,
            k.avg_rating,
            k.rating_count,
            k.ai_description,
            k.ai_description_en,
            k.ai_description_ko,
            k.ai_description_es,
            k.ai_tags,
            k.multi_kill,
            k.is_first_blood,
            k.tracked_team_involvement,
            k.game_time_seconds,
            k.created_at,
            COALESCE(e.elo_rating, 1500) AS elo_rating,
            COALESCE(e.battles_count, 0) AS elo_battles,
            m.scheduled_at AS match_date
        FROM kills k
        LEFT JOIN players p1 ON k.killer_player_id = p1.id
        LEFT JOIN players p2 ON k.victim_player_id = p2.id
        LEFT JOIN games   g  ON k.game_id          = g.id
        LEFT JOIN matches m  ON g.match_id         = m.id
        LEFT JOIN kill_elo e ON e.kill_id          = k.id
        WHERE k.status = 'published'
          AND k.clip_url_vertical IS NOT NULL
          -- player_slug : case-insensitive match on ign
          AND (
            NULLIF(left_filters->>'player_slug','') IS NULL
            OR LOWER(p1.ign) = LOWER(NULLIF(left_filters->>'player_slug',''))
          )
          AND (
            NULLIF(left_filters->>'champion','') IS NULL
            OR k.killer_champion = NULLIF(left_filters->>'champion','')
          )
          AND (
            NULLIF(left_filters->>'role','') IS NULL
            OR p1.role = NULLIF(left_filters->>'role','')
          )
          AND (
            NULLIF(left_filters->>'era_date_start','') IS NULL
            OR m.scheduled_at >= (NULLIF(left_filters->>'era_date_start',''))::TIMESTAMPTZ
          )
          AND (
            NULLIF(left_filters->>'era_date_end','') IS NULL
            OR m.scheduled_at <= (NULLIF(left_filters->>'era_date_end',''))::TIMESTAMPTZ
          )
          AND (
            NULLIF(left_filters->>'is_first_blood','') IS NULL
            OR k.is_first_blood = (NULLIF(left_filters->>'is_first_blood',''))::BOOLEAN
          )
          AND (
            NULLIF(left_filters->>'min_highlight_score','') IS NULL
            OR k.highlight_score >= (NULLIF(left_filters->>'min_highlight_score',''))::FLOAT
          )
          AND (
            NULLIF(left_filters->>'multi_kill_min','') IS NULL
            OR (
                CASE LOWER(COALESCE(k.multi_kill, ''))
                    WHEN 'double' THEN 2
                    WHEN 'triple' THEN 3
                    WHEN 'quadra' THEN 4
                    WHEN 'penta'  THEN 5
                    ELSE 1
                END
            ) >= (
                CASE LOWER(NULLIF(left_filters->>'multi_kill_min',''))
                    WHEN 'double' THEN 2
                    WHEN 'triple' THEN 3
                    WHEN 'quadra' THEN 4
                    WHEN 'penta'  THEN 5
                    ELSE NULL
                END
            )
          )
        ORDER BY random()
        LIMIT 1
    )
    SELECT to_jsonb(c.*) INTO v_kill_a FROM candidates c;

    WITH candidates AS (
        SELECT
            k.id,
            k.killer_champion,
            k.victim_champion,
            p1.ign            AS killer_name,
            p1.role           AS killer_role,
            p2.ign            AS victim_name,
            k.clip_url_vertical,
            k.clip_url_vertical_low,
            k.clip_url_horizontal,
            k.thumbnail_url,
            k.highlight_score,
            k.avg_rating,
            k.rating_count,
            k.ai_description,
            k.ai_description_en,
            k.ai_description_ko,
            k.ai_description_es,
            k.ai_tags,
            k.multi_kill,
            k.is_first_blood,
            k.tracked_team_involvement,
            k.game_time_seconds,
            k.created_at,
            COALESCE(e.elo_rating, 1500) AS elo_rating,
            COALESCE(e.battles_count, 0) AS elo_battles,
            m.scheduled_at AS match_date
        FROM kills k
        LEFT JOIN players p1 ON k.killer_player_id = p1.id
        LEFT JOIN players p2 ON k.victim_player_id = p2.id
        LEFT JOIN games   g  ON k.game_id          = g.id
        LEFT JOIN matches m  ON g.match_id         = m.id
        LEFT JOIN kill_elo e ON e.kill_id          = k.id
        WHERE k.status = 'published'
          AND k.clip_url_vertical IS NOT NULL
          -- Don't pick the same kill twice (degenerate self-vs-self).
          AND (v_kill_a IS NULL OR k.id <> (v_kill_a->>'id')::UUID)
          AND (
            NULLIF(right_filters->>'player_slug','') IS NULL
            OR LOWER(p1.ign) = LOWER(NULLIF(right_filters->>'player_slug',''))
          )
          AND (
            NULLIF(right_filters->>'champion','') IS NULL
            OR k.killer_champion = NULLIF(right_filters->>'champion','')
          )
          AND (
            NULLIF(right_filters->>'role','') IS NULL
            OR p1.role = NULLIF(right_filters->>'role','')
          )
          AND (
            NULLIF(right_filters->>'era_date_start','') IS NULL
            OR m.scheduled_at >= (NULLIF(right_filters->>'era_date_start',''))::TIMESTAMPTZ
          )
          AND (
            NULLIF(right_filters->>'era_date_end','') IS NULL
            OR m.scheduled_at <= (NULLIF(right_filters->>'era_date_end',''))::TIMESTAMPTZ
          )
          AND (
            NULLIF(right_filters->>'is_first_blood','') IS NULL
            OR k.is_first_blood = (NULLIF(right_filters->>'is_first_blood',''))::BOOLEAN
          )
          AND (
            NULLIF(right_filters->>'min_highlight_score','') IS NULL
            OR k.highlight_score >= (NULLIF(right_filters->>'min_highlight_score',''))::FLOAT
          )
          AND (
            NULLIF(right_filters->>'multi_kill_min','') IS NULL
            OR (
                CASE LOWER(COALESCE(k.multi_kill, ''))
                    WHEN 'double' THEN 2
                    WHEN 'triple' THEN 3
                    WHEN 'quadra' THEN 4
                    WHEN 'penta'  THEN 5
                    ELSE 1
                END
            ) >= (
                CASE LOWER(NULLIF(right_filters->>'multi_kill_min',''))
                    WHEN 'double' THEN 2
                    WHEN 'triple' THEN 3
                    WHEN 'quadra' THEN 4
                    WHEN 'penta'  THEN 5
                    ELSE NULL
                END
            )
          )
        ORDER BY random()
        LIMIT 1
    )
    SELECT to_jsonb(c.*) INTO v_kill_b FROM candidates c;

    RETURN QUERY SELECT v_kill_a, v_kill_b;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_pick_vs_pair(JSONB, JSONB)
    TO anon, authenticated;

COMMENT ON FUNCTION public.fn_pick_vs_pair(JSONB, JSONB) IS
    'V59 / V81 : sample one published kill per side for the /vs roulette. '
    'Each side JSON now carries ai_description plus the localized '
    'ai_description_en / ai_description_ko / ai_description_es so the '
    'frontend lang picker can avoid the French fallback.';

-- ──────────────────────────────────────────────────────────────────────
-- fn_top_elo_kills_v2 — now also returns ai_description_en/_ko/_es
-- ──────────────────────────────────────────────────────────────────────
--
-- Unchanged from migration 064 except three trailing output columns
-- (ai_description_en / ai_description_ko / ai_description_es) added to the
-- RETURNS TABLE and the projection. Signature (the 7 IN params), filters,
-- pagination, ordering, and the GRANT are identical.

DROP FUNCTION IF EXISTS public.fn_top_elo_kills_v2(int, int, text, text, text, text, int);
CREATE OR REPLACE FUNCTION public.fn_top_elo_kills_v2(
    p_limit            INT  DEFAULT 50,
    p_offset           INT  DEFAULT 0,
    p_filter_role      TEXT DEFAULT NULL,
    p_filter_champion  TEXT DEFAULT NULL,
    p_era_date_start   TEXT DEFAULT NULL,
    p_era_date_end     TEXT DEFAULT NULL,
    p_min_battles      INT  DEFAULT 5
)
RETURNS TABLE (
    kill_id               UUID,
    elo_rating            FLOAT,
    battles_count         INT,
    wins                  INT,
    killer_champion       TEXT,
    victim_champion       TEXT,
    killer_name           TEXT,
    killer_role           TEXT,
    victim_name           TEXT,
    clip_url_vertical     TEXT,
    clip_url_vertical_low TEXT,
    thumbnail_url         TEXT,
    highlight_score       FLOAT,
    avg_rating            FLOAT,
    ai_description        TEXT,
    multi_kill            TEXT,
    is_first_blood        BOOLEAN,
    created_at            TIMESTAMPTZ,
    match_date            TIMESTAMPTZ,
    ai_description_en     TEXT,
    ai_description_ko     TEXT,
    ai_description_es     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
    v_min_battles INT := GREATEST(0, COALESCE(p_min_battles, 5));
    v_limit       INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
    v_offset      INT := GREATEST(0, COALESCE(p_offset, 0));
BEGIN
    RETURN QUERY
    SELECT
        e.kill_id,
        e.elo_rating,
        e.battles_count,
        e.wins,
        k.killer_champion,
        k.victim_champion,
        p1.ign  AS killer_name,
        p1.role AS killer_role,
        p2.ign  AS victim_name,
        k.clip_url_vertical,
        k.clip_url_vertical_low,
        k.thumbnail_url,
        k.highlight_score,
        k.avg_rating,
        k.ai_description,
        k.multi_kill,
        k.is_first_blood,
        k.created_at,
        m.scheduled_at AS match_date,
        k.ai_description_en,
        k.ai_description_ko,
        k.ai_description_es
    FROM kill_elo e
    JOIN kills    k  ON k.id = e.kill_id
    LEFT JOIN players p1 ON k.killer_player_id = p1.id
    LEFT JOIN players p2 ON k.victim_player_id = p2.id
    LEFT JOIN games   g  ON k.game_id          = g.id
    LEFT JOIN matches m  ON g.match_id         = m.id
    WHERE k.status = 'published'
      AND k.clip_url_vertical IS NOT NULL
      AND e.battles_count >= v_min_battles
      AND (NULLIF(p_filter_role,'')     IS NULL OR p1.role            = NULLIF(p_filter_role,''))
      AND (NULLIF(p_filter_champion,'') IS NULL OR k.killer_champion  = NULLIF(p_filter_champion,''))
      AND (
        NULLIF(p_era_date_start,'') IS NULL
        OR m.scheduled_at >= (NULLIF(p_era_date_start,''))::TIMESTAMPTZ
      )
      AND (
        NULLIF(p_era_date_end,'') IS NULL
        OR m.scheduled_at <= (NULLIF(p_era_date_end,''))::TIMESTAMPTZ
      )
    ORDER BY e.elo_rating DESC, e.battles_count DESC, k.created_at DESC
    LIMIT v_limit
    OFFSET v_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_top_elo_kills_v2(INT, INT, TEXT, TEXT, TEXT, TEXT, INT)
    TO anon, authenticated;

COMMENT ON FUNCTION public.fn_top_elo_kills_v2(INT, INT, TEXT, TEXT, TEXT, TEXT, INT) IS
    'Wave 30e / V64 / V81 : paginated VS Roulette leaderboard. Filters : '
    'role, champion, match-date era window, min battles. Defaults to top 50 '
    'with battles_count >= 5. Now also returns ai_description_en / '
    'ai_description_ko / ai_description_es so the lang picker avoids the '
    'French fallback.';

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- Verify after apply
-- ══════════════════════════════════════════════════════════════════════
--
--   -- Both sides now carry the localized keys:
--   SELECT (kill_a ? 'ai_description_en') AS a_has_en,
--          (kill_b ? 'ai_description_ko') AS b_has_ko
--   FROM fn_pick_vs_pair('{}'::jsonb, '{}'::jsonb);
--
--   -- Leaderboard now exposes the three trailing columns:
--   SELECT kill_id, ai_description, ai_description_en,
--          ai_description_ko, ai_description_es
--   FROM fn_top_elo_kills_v2(5, 0, NULL, NULL, NULL, NULL, 0);
