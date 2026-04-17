-- ════════════════════════════════════════════════════════════════════════════
-- KCKILLS — Clip-Centric Platform RPC
-- ════════════════════════════════════════════════════════════════════════════
-- Single typed entry point that powers the reusable <ClipReel filter={...} />
-- component on every secondary page (player, match, rivalry, champion).
--
-- Filter is passed as JSONB so we can extend it without bumping the RPC
-- signature. Every key is OPTIONAL — omit one and that dimension is
-- ignored. Returns the minimum projection the carousel needs (id +
-- thumbnails + clip URLs + meta), capped at p_limit. RLS is honoured
-- because we run with `security definer` against the published-only
-- subset of `kills`.
--
-- Filter keys recognised:
--   killer_player_id       UUID
--   victim_player_id       UUID
--   match_external_id      text     (joined through games.matches)
--   killer_champion        text
--   victim_champion        text
--   fight_type             text     (enum from 004)
--   matchup_lane           text     (enum from 004)
--   champion_class         text     (enum from 004)
--   minute_bucket          text     (enum from 004)
--   lane_phase             text     (enum from 004)
--   objective_context      text     (enum from 004)
--   opponent_team_code     text     (joined through games.matches.team_red/blue)
--   tracked_team_involvement text   ('team_killer','team_victim','team_assist')
--   multi_kill_min         text     ('double','triple','quadra','penta')
--   is_first_blood         bool
--   min_highlight          float
--   min_avg_rating         float
--
-- Sort order is composite: highlight_score DESC, avg_rating DESC, recency.
-- Idempotent: re-runnable.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.fn_get_clips_filtered(jsonb, int);

CREATE OR REPLACE FUNCTION public.fn_get_clips_filtered(
    p_filter jsonb DEFAULT '{}'::jsonb,
    p_limit  int   DEFAULT 24
) RETURNS TABLE (
    id                       UUID,
    killer_player_id         UUID,
    victim_player_id         UUID,
    killer_champion          TEXT,
    victim_champion          TEXT,
    killer_name              TEXT,
    victim_name              TEXT,
    clip_url_horizontal      TEXT,
    clip_url_vertical        TEXT,
    clip_url_vertical_low    TEXT,
    thumbnail_url            TEXT,
    highlight_score          FLOAT,
    avg_rating               FLOAT,
    rating_count             INT,
    ai_description           TEXT,
    ai_tags                  JSONB,
    multi_kill               TEXT,
    is_first_blood           BOOLEAN,
    tracked_team_involvement TEXT,
    fight_type               TEXT,
    matchup_lane             TEXT,
    lane_phase               TEXT,
    minute_bucket            TEXT,
    game_time_seconds        INT,
    game_id                  UUID,
    game_number              INT,
    match_external_id        TEXT,
    match_stage              TEXT,
    match_date               TIMESTAMPTZ,
    opponent_code            TEXT,
    created_at               TIMESTAMPTZ
) AS $$
DECLARE
    v_killer_player_id        UUID;
    v_victim_player_id        UUID;
    v_match_external_id       TEXT;
    v_killer_champion         TEXT;
    v_victim_champion         TEXT;
    v_fight_type              TEXT;
    v_matchup_lane            TEXT;
    v_champion_class          TEXT;
    v_minute_bucket           TEXT;
    v_lane_phase              TEXT;
    v_objective               TEXT;
    v_opponent_code           TEXT;
    v_involvement             TEXT;
    v_multi_min               TEXT;
    v_is_first_blood          BOOLEAN;
    v_min_highlight           FLOAT;
    v_min_avg_rating          FLOAT;
    v_multi_rank              INT;
BEGIN
    -- Extract typed values once, with NULL for missing keys.
    v_killer_player_id  := NULLIF(p_filter->>'killer_player_id','')::UUID;
    v_victim_player_id  := NULLIF(p_filter->>'victim_player_id','')::UUID;
    v_match_external_id := NULLIF(p_filter->>'match_external_id','');
    v_killer_champion   := NULLIF(p_filter->>'killer_champion','');
    v_victim_champion   := NULLIF(p_filter->>'victim_champion','');
    v_fight_type        := NULLIF(p_filter->>'fight_type','');
    v_matchup_lane      := NULLIF(p_filter->>'matchup_lane','');
    v_champion_class    := NULLIF(p_filter->>'champion_class','');
    v_minute_bucket     := NULLIF(p_filter->>'minute_bucket','');
    v_lane_phase        := NULLIF(p_filter->>'lane_phase','');
    v_objective         := NULLIF(p_filter->>'objective_context','');
    v_opponent_code     := NULLIF(p_filter->>'opponent_team_code','');
    v_involvement       := NULLIF(p_filter->>'tracked_team_involvement','');
    v_multi_min         := NULLIF(p_filter->>'multi_kill_min','');
    v_is_first_blood    := NULLIF(p_filter->>'is_first_blood','')::BOOLEAN;
    v_min_highlight     := NULLIF(p_filter->>'min_highlight','')::FLOAT;
    v_min_avg_rating    := NULLIF(p_filter->>'min_avg_rating','')::FLOAT;

    -- Translate the multi_kill_min textual value into a numeric rank so we
    -- can do a single >= comparison server-side. NULL when no constraint.
    v_multi_rank := CASE LOWER(COALESCE(v_multi_min, ''))
        WHEN 'double' THEN 2
        WHEN 'triple' THEN 3
        WHEN 'quadra' THEN 4
        WHEN 'penta'  THEN 5
        ELSE NULL
    END;

    RETURN QUERY
    SELECT
        k.id,
        k.killer_player_id,
        k.victim_player_id,
        k.killer_champion,
        k.victim_champion,
        p1.ign  AS killer_name,
        p2.ign  AS victim_name,
        k.clip_url_horizontal,
        k.clip_url_vertical,
        k.clip_url_vertical_low,
        k.thumbnail_url,
        k.highlight_score,
        k.avg_rating,
        k.rating_count,
        k.ai_description,
        k.ai_tags,
        k.multi_kill,
        k.is_first_blood,
        k.tracked_team_involvement,
        k.fight_type,
        k.matchup_lane,
        k.lane_phase,
        k.game_minute_bucket AS minute_bucket,
        k.game_time_seconds,
        k.game_id,
        g.game_number,
        m.external_id AS match_external_id,
        m.stage AS match_stage,
        m.scheduled_at AS match_date,
        CASE
            WHEN tr.code IS NOT NULL AND tr.code <> 'KC' THEN tr.code
            WHEN tb.code IS NOT NULL AND tb.code <> 'KC' THEN tb.code
            ELSE NULL
        END AS opponent_code,
        k.created_at
    FROM kills k
    LEFT JOIN players p1 ON k.killer_player_id = p1.id
    LEFT JOIN players p2 ON k.victim_player_id = p2.id
    LEFT JOIN games   g  ON k.game_id          = g.id
    LEFT JOIN matches m  ON g.match_id         = m.id
    LEFT JOIN teams   tb ON m.team_blue_id     = tb.id
    LEFT JOIN teams   tr ON m.team_red_id      = tr.id
    WHERE k.status = 'published'
      AND (v_killer_player_id  IS NULL OR k.killer_player_id  = v_killer_player_id)
      AND (v_victim_player_id  IS NULL OR k.victim_player_id  = v_victim_player_id)
      AND (v_match_external_id IS NULL OR m.external_id       = v_match_external_id)
      AND (v_killer_champion   IS NULL OR k.killer_champion   = v_killer_champion)
      AND (v_victim_champion   IS NULL OR k.victim_champion   = v_victim_champion)
      AND (v_fight_type        IS NULL OR k.fight_type        = v_fight_type)
      AND (v_matchup_lane      IS NULL OR k.matchup_lane      = v_matchup_lane)
      AND (v_champion_class    IS NULL OR k.champion_class    = v_champion_class)
      AND (v_minute_bucket     IS NULL OR k.game_minute_bucket = v_minute_bucket)
      AND (v_lane_phase        IS NULL OR k.lane_phase        = v_lane_phase)
      AND (v_objective         IS NULL OR k.objective_context = v_objective)
      AND (v_involvement       IS NULL OR k.tracked_team_involvement = v_involvement)
      AND (v_is_first_blood    IS NULL OR k.is_first_blood    = v_is_first_blood)
      AND (v_min_highlight     IS NULL OR k.highlight_score  >= v_min_highlight)
      AND (v_min_avg_rating    IS NULL OR k.avg_rating       >= v_min_avg_rating)
      AND (v_opponent_code     IS NULL OR (
            (tr.code = v_opponent_code AND tb.code = 'KC') OR
            (tb.code = v_opponent_code AND tr.code = 'KC')
      ))
      AND (v_multi_rank IS NULL OR (
            CASE LOWER(COALESCE(k.multi_kill, ''))
                WHEN 'double' THEN 2
                WHEN 'triple' THEN 3
                WHEN 'quadra' THEN 4
                WHEN 'penta'  THEN 5
                ELSE 1
            END
      ) >= v_multi_rank)
    ORDER BY
        k.highlight_score DESC NULLS LAST,
        k.avg_rating      DESC NULLS LAST,
        k.created_at      DESC
    LIMIT GREATEST(1, LEAST(p_limit, 60));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.fn_get_clips_filtered(jsonb, int) TO anon, authenticated;
