-- ════════════════════════════════════════════════════════════════════════════
-- KCKILLS — Scroll Vivant V1: grid pivot dimensions
-- ════════════════════════════════════════════════════════════════════════════
-- Adds 6 structured dimensions on kills so the homepage grid can pivot on
-- time × player × opponent × fight-type. Dimensions are filled by Gemini and
-- reconciled with the livestats frame timestamp in analyzer.py.
-- Idempotent: re-runnable without error.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS lane_phase TEXT
        CHECK (lane_phase IN ('early','mid','late')),
    ADD COLUMN IF NOT EXISTS fight_type TEXT
        CHECK (fight_type IN (
            'solo_kill','gank','skirmish_2v2','skirmish_3v3',
            'teamfight_4v4','teamfight_5v5','pick'
        )),
    ADD COLUMN IF NOT EXISTS objective_context TEXT
        DEFAULT 'none'
        CHECK (objective_context IN (
            'none','dragon','baron','herald','atakhan',
            'tower','inhibitor','nexus'
        )),
    ADD COLUMN IF NOT EXISTS matchup_lane TEXT
        CHECK (matchup_lane IN ('top','jungle','mid','bot','support','cross_map')),
    ADD COLUMN IF NOT EXISTS champion_class TEXT
        CHECK (champion_class IN (
            'assassin','bruiser','mage','marksman',
            'tank','enchanter','skirmisher'
        )),
    ADD COLUMN IF NOT EXISTS game_minute_bucket TEXT
        CHECK (game_minute_bucket IN (
            '0-5','5-10','10-15','15-20',
            '20-25','25-30','30-35','35+'
        ));

-- Partial indexes: only published rows matter for the grid query path.
CREATE INDEX IF NOT EXISTS idx_kills_fight_type
    ON kills(fight_type) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_kills_minute_bucket
    ON kills(game_minute_bucket) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_kills_objective
    ON kills(objective_context)
    WHERE status = 'published' AND objective_context != 'none';
CREATE INDEX IF NOT EXISTS idx_kills_matchup_lane
    ON kills(matchup_lane) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_kills_lane_phase
    ON kills(lane_phase) WHERE status = 'published';

-- ────────────────────────────────────────────────────────────────────────────
-- RPC fn_get_grid_cells — returns one row per (cell_x, cell_y) bucket.
-- Axis selectors are validated against a whitelist: attempting to query any
-- other column throws. The top_kill_id for each cell is chosen by Wilson-ish
-- ordering (avg_rating DESC, rating_count DESC, highlight_score DESC).
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS fn_get_grid_cells(TEXT, TEXT, JSONB);

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
BEGIN
    IF NOT (p_axis_x = ANY(allowed_axes)) THEN
        RAISE EXCEPTION 'invalid axis_x: %', p_axis_x;
    END IF;
    IF NOT (p_axis_y = ANY(allowed_axes)) THEN
        RAISE EXCEPTION 'invalid axis_y: %', p_axis_y;
    END IF;

    -- The opponent axis needs a join on games → matches → teams; everything
    -- else is a plain column on kills. Resolve both sides with the same
    -- helper CTE so the caller can pick any pairing without branching.
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
            WHERE k.status = 'published'
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
    $f$, x_expr, y_expr);

    RETURN QUERY EXECUTE sql;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION fn_get_grid_cells(TEXT, TEXT, JSONB) TO anon, authenticated;
