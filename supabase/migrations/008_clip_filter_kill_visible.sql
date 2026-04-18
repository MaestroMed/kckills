-- Migration 008 — fn_get_clips_filtered ne renvoie plus les kills
-- avec kill_visible=false par defaut.
--
-- Pourquoi: l'audit qualite des descriptions IA (Opus 4.7) a montre
-- que les 8 clips marques kill_visible=false par le QC Gemini ont des
-- descriptions soit creuses, soit hallucinees ("X termine Y" alors
-- qu'on ne voit pas le kill). Sur un feed style TikTok, l'utilisateur
-- s'attend a voir le kill — l'absence est une rupture de contrat.
--
-- Decision: filtrer kill_visible=true au niveau de la RPC.
--   - getClipsFiltered (= toutes les ClipReel) hereditent du filtre
--   - getKillById (deep-link direct) reste sans filtre — si quelqu'un
--     atterrit avec une URL precise, il voit le clip qu'il a demande
--   - getPublishedKills filtrait deja (audit precedent)
--
-- L'alternative (laisser les 8 clips visibles) couterait 5 mauvaises
-- descriptions sur le feed pour 8 vues max. Le ratio est tres
-- defavorable.
--
-- Pour reactiver ces 8 clips il faudra:
--   1. Re-clipper la portion qui contient le kill visible
--   2. Re-analyser pour que kill_visible repasse a true
-- Ou alors decider que la regle est trop stricte et retirer ce filtre.

CREATE OR REPLACE FUNCTION fn_get_clips_filtered(
    p_filter JSONB,
    p_limit INT
)
RETURNS TABLE (
    id UUID,
    killer_player_id UUID,
    victim_player_id UUID,
    killer_champion TEXT,
    victim_champion TEXT,
    killer_name TEXT,
    victim_name TEXT,
    clip_url_horizontal TEXT,
    clip_url_vertical TEXT,
    clip_url_vertical_low TEXT,
    thumbnail_url TEXT,
    highlight_score FLOAT,
    avg_rating FLOAT,
    rating_count INT,
    ai_description TEXT,
    ai_tags JSONB,
    multi_kill TEXT,
    is_first_blood BOOLEAN,
    tracked_team_involvement TEXT,
    fight_type TEXT,
    matchup_lane TEXT,
    lane_phase TEXT,
    minute_bucket TEXT,
    game_time_seconds INT,
    game_id UUID,
    game_number INT,
    match_external_id TEXT,
    match_stage TEXT,
    match_date TIMESTAMPTZ,
    opponent_code TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_killer_player_id     UUID    := (p_filter->>'killer_player_id')::UUID;
    v_victim_player_id     UUID    := (p_filter->>'victim_player_id')::UUID;
    v_match_external_id    TEXT    := NULLIF(p_filter->>'match_external_id', '');
    v_killer_champion      TEXT    := NULLIF(p_filter->>'killer_champion', '');
    v_victim_champion      TEXT    := NULLIF(p_filter->>'victim_champion', '');
    v_fight_type           TEXT    := NULLIF(p_filter->>'fight_type', '');
    v_matchup_lane         TEXT    := NULLIF(p_filter->>'matchup_lane', '');
    v_champion_class       TEXT    := NULLIF(p_filter->>'champion_class', '');
    v_minute_bucket        TEXT    := NULLIF(p_filter->>'minute_bucket', '');
    v_lane_phase           TEXT    := NULLIF(p_filter->>'lane_phase', '');
    v_objective            TEXT    := NULLIF(p_filter->>'objective_context', '');
    v_opponent_code        TEXT    := NULLIF(p_filter->>'opponent_team_code', '');
    v_involvement          TEXT    := NULLIF(p_filter->>'tracked_team_involvement', '');
    v_multi_min            TEXT    := NULLIF(p_filter->>'multi_kill_min', '');
    v_is_first_blood       BOOLEAN := NULLIF(p_filter->>'is_first_blood', '')::BOOLEAN;
    v_min_highlight        FLOAT   := NULLIF(p_filter->>'min_highlight', '')::FLOAT;
    v_min_avg_rating       FLOAT   := NULLIF(p_filter->>'min_avg_rating', '')::FLOAT;
    v_multi_rank           INT;
BEGIN
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
      AND k.kill_visible = TRUE                                    -- NEW: audit Opus 4.7
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
      AND (v_opponent_code     IS NULL OR (
            (tr.code = v_opponent_code AND tr.code <> 'KC') OR
            (tb.code = v_opponent_code AND tb.code <> 'KC')
          ))
      AND (v_involvement       IS NULL OR k.tracked_team_involvement = v_involvement)
      AND (v_multi_rank        IS NULL OR (
            CASE LOWER(COALESCE(k.multi_kill, ''))
                WHEN 'double' THEN 2
                WHEN 'triple' THEN 3
                WHEN 'quadra' THEN 4
                WHEN 'penta'  THEN 5
                ELSE 0
            END
          ) >= v_multi_rank)
      AND (v_is_first_blood    IS NULL OR k.is_first_blood    = v_is_first_blood)
      AND (v_min_highlight     IS NULL OR k.highlight_score   >= v_min_highlight)
      AND (v_min_avg_rating    IS NULL OR k.avg_rating        >= v_min_avg_rating)
    ORDER BY k.highlight_score DESC NULLS LAST,
             k.avg_rating      DESC NULLS LAST,
             k.created_at      DESC
    LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION fn_get_clips_filtered(JSONB, INT) IS
    'Renvoie les clips publies filtres par dimensions Scroll Vivant. '
    'kill_visible=true forcé depuis migration 008 (audit Opus 4.7) — '
    'getKillById reste sans filtre pour les deep-links directs.';
