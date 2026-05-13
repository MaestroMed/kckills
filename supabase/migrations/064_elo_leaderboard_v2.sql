-- Migration 064 — Wave 30e (2026-05-14) — VS Leaderboard real implementation
--
-- The /vs/leaderboard page was shipped as a stub in V59 (migration 059).
-- This migration extends the data layer with everything the production
-- page needs :
--
--   1. fn_top_elo_kills_v2 — same shape as v1 but adds :
--        * p_era_date_start / p_era_date_end : filter by match scheduled_at
--          window (driven by the ERAS table in TS-land, same pattern as
--          fn_pick_vs_pair from migration 059).
--        * p_min_battles : caller-supplied floor on battles_count
--          (defaults to 5 to match v1). The /vs/leaderboard "Min batailles"
--          slider drives this 5..50.
--        * p_offset : cursor for pagination (50-row pages).
--
--      Returns every column v1 already returned PLUS match_date so the
--      UI can decorate rows with the matchup's era chip without a second
--      round-trip.
--
--   2. fn_elo_leaderboard_stats — aggregated counters for the sidebar :
--        * total_battles            : sum of battles_count across all
--                                     kill_elo rows
--        * total_kills_with_battles : count(kill_id) where battles >= 5
--        * most_active_kill         : highest battles_count row
--        * most_contested_kill      : closest win_rate to 0.5 with battles
--                                     >= 20 (avoids 1-2 battle outliers)
--        * most_dominant_kill       : highest win_rate with battles >= 20
--
--      All emitted as a single row so the page costs one round-trip.
--
-- Conventions :
--   * SECURITY DEFINER + `SET search_path = public, pg_catalog`
--     (search-path hijack lock, migration 051).
--   * STABLE — both functions are read-only.
--   * IF NOT EXISTS on schema-touching ops, DROP FUNCTION IF EXISTS
--     before CREATE for the RPCs. Idempotent re-runs.
--
-- Apply via the Supabase Management API :
--   curl -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
--        -H "Authorization: Bearer $SUPABASE_PAT" \
--        -H "Content-Type: application/json" \
--        --data-binary @<(jq -Rs '{query: .}' < 064_elo_leaderboard_v2.sql)

BEGIN;

-- ──────────────────────────────────────────────────────────────────────
-- fn_top_elo_kills_v2 — paginated leaderboard with era + min_battles
-- ──────────────────────────────────────────────────────────────────────

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
    match_date            TIMESTAMPTZ
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
        m.scheduled_at AS match_date
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
    'Wave 30e / V64 : paginated VS Roulette leaderboard. Filters : role, '
    'champion, match-date era window, min battles. Defaults to top 50 with '
    'battles_count >= 5.';

-- ──────────────────────────────────────────────────────────────────────
-- fn_elo_leaderboard_stats — sidebar counters in a single round-trip
-- ──────────────────────────────────────────────────────────────────────
--
-- The four "highlight" picks (most_active / most_contested / most_dominant)
-- are returned as JSONB blobs so we can carry the full kill projection
-- without inventing a new composite type. JSONB also degrades to NULL
-- when no row matches the gate (e.g. zero kills with >= 20 battles).

DROP FUNCTION IF EXISTS public.fn_elo_leaderboard_stats();
CREATE OR REPLACE FUNCTION public.fn_elo_leaderboard_stats()
RETURNS TABLE (
    total_battles            BIGINT,
    total_kills_with_battles BIGINT,
    most_active_kill         JSONB,
    most_contested_kill      JSONB,
    most_dominant_kill       JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
    v_total_battles            BIGINT;
    v_total_kills_with_battles BIGINT;
    v_most_active              JSONB;
    v_most_contested           JSONB;
    v_most_dominant            JSONB;
BEGIN
    -- Total battles across every kill_elo row. The kill_elo table tracks
    -- battles_count per side so summing it overcounts by 2x — we divide
    -- after the fact to get the true "battles cast" count.
    SELECT COALESCE(SUM(battles_count), 0) / 2
        INTO v_total_battles
        FROM kill_elo;

    SELECT COUNT(*)
        INTO v_total_kills_with_battles
        FROM kill_elo
        WHERE battles_count >= 5;

    -- Most active : highest battles_count (any threshold).
    WITH base AS (
        SELECT
            e.kill_id,
            e.elo_rating,
            e.battles_count,
            e.wins,
            (e.wins::FLOAT / NULLIF(e.battles_count, 0)) AS win_rate,
            k.killer_champion,
            k.victim_champion,
            p1.ign  AS killer_name,
            p1.role AS killer_role,
            p2.ign  AS victim_name,
            k.thumbnail_url,
            k.clip_url_vertical,
            k.clip_url_vertical_low,
            k.multi_kill,
            k.is_first_blood,
            k.ai_description,
            k.highlight_score
        FROM kill_elo e
        JOIN kills   k  ON k.id = e.kill_id
        LEFT JOIN players p1 ON k.killer_player_id = p1.id
        LEFT JOIN players p2 ON k.victim_player_id = p2.id
        WHERE k.status = 'published'
          AND k.clip_url_vertical IS NOT NULL
          AND e.battles_count > 0
    )
    SELECT to_jsonb(b.*) INTO v_most_active
    FROM base b
    ORDER BY b.battles_count DESC, b.elo_rating DESC
    LIMIT 1;

    -- Most contested : closest win_rate to 0.5 with battles_count >= 20.
    -- ORDER BY ABS(win_rate - 0.5) ASC.
    WITH base AS (
        SELECT
            e.kill_id,
            e.elo_rating,
            e.battles_count,
            e.wins,
            (e.wins::FLOAT / NULLIF(e.battles_count, 0)) AS win_rate,
            k.killer_champion,
            k.victim_champion,
            p1.ign  AS killer_name,
            p1.role AS killer_role,
            p2.ign  AS victim_name,
            k.thumbnail_url,
            k.clip_url_vertical,
            k.clip_url_vertical_low,
            k.multi_kill,
            k.is_first_blood,
            k.ai_description,
            k.highlight_score
        FROM kill_elo e
        JOIN kills   k  ON k.id = e.kill_id
        LEFT JOIN players p1 ON k.killer_player_id = p1.id
        LEFT JOIN players p2 ON k.victim_player_id = p2.id
        WHERE k.status = 'published'
          AND k.clip_url_vertical IS NOT NULL
          AND e.battles_count >= 20
    )
    SELECT to_jsonb(b.*) INTO v_most_contested
    FROM base b
    ORDER BY ABS(b.win_rate - 0.5) ASC, b.battles_count DESC
    LIMIT 1;

    -- Most dominant : highest win_rate with battles_count >= 20.
    WITH base AS (
        SELECT
            e.kill_id,
            e.elo_rating,
            e.battles_count,
            e.wins,
            (e.wins::FLOAT / NULLIF(e.battles_count, 0)) AS win_rate,
            k.killer_champion,
            k.victim_champion,
            p1.ign  AS killer_name,
            p1.role AS killer_role,
            p2.ign  AS victim_name,
            k.thumbnail_url,
            k.clip_url_vertical,
            k.clip_url_vertical_low,
            k.multi_kill,
            k.is_first_blood,
            k.ai_description,
            k.highlight_score
        FROM kill_elo e
        JOIN kills   k  ON k.id = e.kill_id
        LEFT JOIN players p1 ON k.killer_player_id = p1.id
        LEFT JOIN players p2 ON k.victim_player_id = p2.id
        WHERE k.status = 'published'
          AND k.clip_url_vertical IS NOT NULL
          AND e.battles_count >= 20
    )
    SELECT to_jsonb(b.*) INTO v_most_dominant
    FROM base b
    ORDER BY b.win_rate DESC NULLS LAST, b.battles_count DESC
    LIMIT 1;

    RETURN QUERY SELECT
        v_total_battles,
        v_total_kills_with_battles,
        v_most_active,
        v_most_contested,
        v_most_dominant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_elo_leaderboard_stats()
    TO anon, authenticated;

COMMENT ON FUNCTION public.fn_elo_leaderboard_stats() IS
    'Wave 30e / V64 : aggregated counters for the /vs/leaderboard sidebar. '
    'Single round-trip returning total battles, kills passing the >= 5 '
    'gate, and three featured kills (most active, most contested, most '
    'dominant). Featured kills require battles_count >= 20.';

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- Verify after apply
-- ══════════════════════════════════════════════════════════════════════
--
--   SELECT * FROM fn_top_elo_kills_v2();
--   SELECT * FROM fn_top_elo_kills_v2(50, 0, 'mid', NULL, NULL, NULL, 5);
--   SELECT * FROM fn_top_elo_kills_v2(
--       50, 0, NULL, NULL,
--       '2025-01-01'::text, '2025-12-31'::text, 5
--   );
--   SELECT * FROM fn_elo_leaderboard_stats();
