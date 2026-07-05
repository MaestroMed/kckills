-- ═══════════════════════════════════════════════════════════════════
-- 087 — fn_get_grid_cells alignment (Vague 3, résurrection Scroll Vivant)
--
-- The grid RPC (004) filtered on `status='published'` ONLY — it would
-- surface kills the QC pipeline had rejected (kill_visible=false),
-- opponent-side kills and clip-less rows that /scroll never shows.
-- Now that the grid returns to the homepage, its WHERE is aligned on
-- the scroll feed's exact predicate (lib/supabase/kills.ts):
--   publication_status/status published + kill_visible IS TRUE
--   + tracked_team_involvement='team_killer'
--   + clip_url_vertical & thumbnail_url NOT NULL
--
-- Also fixes the audit finding: `p_filters` was accepted but NEVER
-- applied. It now supports a whitelisted equality filter per allowed
-- axis column (e.g. {"fight_type":"teamfight_5v5"}), values passed as
-- bound parameters — never interpolated.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION fn_get_grid_cells(
    p_axis_x TEXT,
    p_axis_y TEXT,
    p_filters JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (
    cell_x TEXT,
    cell_y TEXT,
    kill_count INT,
    top_kill_id UUID,
    top_thumbnail TEXT,
    top_vertical_url TEXT,
    top_vertical_low_url TEXT,
    avg_rating FLOAT,
    rating_count INT,
    avg_highlight FLOAT
) AS $$
DECLARE
    allowed_axes CONSTANT TEXT[] := ARRAY[
        'game_minute_bucket','lane_phase','fight_type',
        'objective_context','matchup_lane','champion_class',
        'killer_player_id','opponent_team_code'
    ];
    sql TEXT;
    x_expr TEXT;
    y_expr TEXT;
    filter_sql TEXT := '';
    filter_key TEXT;
    filter_vals TEXT[] := ARRAY[]::TEXT[];
    i INT := 0;
BEGIN
    IF NOT (p_axis_x = ANY(allowed_axes)) THEN
        RAISE EXCEPTION 'invalid axis_x: %', p_axis_x;
    END IF;
    IF NOT (p_axis_y = ANY(allowed_axes)) THEN
        RAISE EXCEPTION 'invalid axis_y: %', p_axis_y;
    END IF;

    x_expr := CASE
        WHEN p_axis_x = 'killer_player_id' THEN 'k.killer_player_id::text'
        WHEN p_axis_x = 'opponent_team_code' THEN 'opp.code'
        ELSE format('k.%I', p_axis_x)
    END;
    y_expr := CASE
        WHEN p_axis_y = 'killer_player_id' THEN 'k.killer_player_id::text'
        WHEN p_axis_y = 'opponent_team_code' THEN 'opp.code'
        ELSE format('k.%I', p_axis_y)
    END;

    -- 087 : whitelisted equality filters, values bound via USING (the
    -- key is validated against allowed_axes, the value never touches
    -- the SQL string). Unknown keys raise — a silently-ignored filter
    -- is how this parameter rotted for three months.
    FOR filter_key IN SELECT jsonb_object_keys(COALESCE(p_filters, '{}'::jsonb))
    LOOP
        IF NOT (filter_key = ANY(allowed_axes)) THEN
            RAISE EXCEPTION 'invalid filter key: %', filter_key;
        END IF;
        i := i + 1;
        filter_vals := filter_vals || (p_filters ->> filter_key);
        filter_sql := filter_sql || format(
            ' AND %s = $1[%s]',
            CASE
                WHEN filter_key = 'killer_player_id' THEN 'k.killer_player_id::text'
                WHEN filter_key = 'opponent_team_code' THEN 'opp.code'
                ELSE format('k.%I', filter_key)
            END,
            i
        );
    END LOOP;

    sql := format($f$
        WITH base AS (
            SELECT
                k.id,
                k.thumbnail_url,
                k.clip_url_vertical,
                k.clip_url_vertical_low,
                k.avg_rating,
                k.rating_count,
                k.highlight_score,
                %s AS cx,
                %s AS cy
            FROM kills k
            LEFT JOIN games g ON g.id = k.game_id
            LEFT JOIN matches m ON m.id = g.match_id
            LEFT JOIN teams tb ON tb.id = m.team_blue_id
            LEFT JOIN teams tr ON tr.id = m.team_red_id
            LEFT JOIN LATERAL (
                SELECT CASE
                    WHEN tb.is_tracked IS TRUE THEN tr.code
                    WHEN tr.is_tracked IS TRUE THEN tb.code
                    ELSE NULL
                END AS code
            ) opp ON true
            WHERE (
                    k.publication_status = 'published'
                    OR (k.publication_status IS NULL AND k.status = 'published')
                  )
              AND k.kill_visible IS TRUE
              AND k.tracked_team_involvement = 'team_killer'
              AND k.clip_url_vertical IS NOT NULL
              AND k.thumbnail_url IS NOT NULL
              %s
        ),
        ranked AS (
            SELECT
                cx, cy, id, thumbnail_url, clip_url_vertical, clip_url_vertical_low,
                avg_rating, rating_count, highlight_score,
                ROW_NUMBER() OVER (
                    PARTITION BY cx, cy
                    ORDER BY
                        avg_rating DESC NULLS LAST,
                        rating_count DESC NULLS LAST,
                        highlight_score DESC NULLS LAST
                ) AS rn
            FROM base
            WHERE cx IS NOT NULL AND cy IS NOT NULL
        )
        SELECT
            cx::text,
            cy::text,
            COUNT(*)::int AS kill_count,
            (ARRAY_AGG(id ORDER BY rn))[1] AS top_kill_id,
            (ARRAY_AGG(thumbnail_url ORDER BY rn))[1] AS top_thumbnail,
            (ARRAY_AGG(clip_url_vertical ORDER BY rn))[1] AS top_vertical_url,
            (ARRAY_AGG(clip_url_vertical_low ORDER BY rn))[1] AS top_vertical_low_url,
            AVG(avg_rating)::float AS avg_rating,
            SUM(rating_count)::int AS rating_count,
            AVG(highlight_score)::float AS avg_highlight
        FROM ranked
        GROUP BY cx, cy
        ORDER BY cx, cy
    $f$, x_expr, y_expr, filter_sql);

    RETURN QUERY EXECUTE sql USING filter_vals;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog;

GRANT EXECUTE ON FUNCTION fn_get_grid_cells(TEXT, TEXT, JSONB) TO anon, authenticated;

COMMIT;
