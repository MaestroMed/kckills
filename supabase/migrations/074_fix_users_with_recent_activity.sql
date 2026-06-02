-- Migration 074 (Wave 35 hotfix) — Fix ambiguous user_id in fn_users_with_recent_activity
--
-- Pre-fix : la fonction `fn_users_with_recent_activity` déclare deux OUT
-- params via `RETURNS TABLE (user_id UUID, last_active_at TIMESTAMPTZ)`.
-- Ces noms sont en scope partout dans le body PL/pgSQL → quand le CTE
-- `activity` faisait `WHERE user_id IS NOT NULL` ou `GROUP BY user_id`
-- sur public.ratings / public.comments / public.user_events, Postgres
-- ne pouvait pas trancher entre la colonne table et la variable OUT.
--
-- Symptôme : achievement_evaluator du daemon worker loggait
--   achievement_rpc_http_error
--   body='{"code":"42702","message":"column reference \"user_id\" is ambiguous"}'
-- à chaque cycle (180s) → la RPC renvoyait 400, achievements jamais évalués.
--
-- Fix : alias toutes les tables sources du CTE (r, c, vb, fov, bv, ue) et
-- qualifier chaque référence colonne. Aucun changement de signature ni de
-- shape de retour, donc CREATE OR REPLACE suffit — clients pas impactés.
--
-- Application : Supabase SQL Editor. Le wrap transaction par défaut convient
-- (aucune commande non-transactionnelle ici).

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_users_with_recent_activity(
    p_lookback_days INT DEFAULT 7,
    p_limit         INT DEFAULT 500
)
RETURNS TABLE (
    user_id UUID,
    last_active_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
    v_since TIMESTAMPTZ := now() - (GREATEST(1, p_lookback_days) || ' days')::INTERVAL;
    v_limit INT := GREATEST(10, LEAST(COALESCE(p_limit, 500), 5000));
BEGIN
    RETURN QUERY
    WITH activity AS (
        SELECT r.user_id, MAX(r.created_at) AS last_active_at
        FROM public.ratings r
        WHERE r.user_id IS NOT NULL AND r.created_at >= v_since
        GROUP BY r.user_id
        UNION ALL
        SELECT c.user_id, MAX(c.created_at)
        FROM public.comments c
        WHERE c.user_id IS NOT NULL AND c.created_at >= v_since
        GROUP BY c.user_id
        UNION ALL
        SELECT vb.voter_user_id, MAX(vb.created_at)
        FROM public.vs_battles vb
        WHERE vb.voter_user_id IS NOT NULL AND vb.created_at >= v_since
        GROUP BY vb.voter_user_id
        UNION ALL
        SELECT fov.voter_user_id, MAX(fov.created_at)
        FROM public.face_off_votes fov
        WHERE fov.voter_user_id IS NOT NULL AND fov.created_at >= v_since
        GROUP BY fov.voter_user_id
        UNION ALL
        SELECT bv.voter_user_id, MAX(bv.created_at)
        FROM public.bracket_votes bv
        WHERE bv.voter_user_id IS NOT NULL AND bv.created_at >= v_since
        GROUP BY bv.voter_user_id
        UNION ALL
        SELECT ue.user_id, MAX(ue.created_at)
        FROM public.user_events ue
        WHERE ue.user_id IS NOT NULL AND ue.created_at >= v_since
        GROUP BY ue.user_id
    )
    SELECT activity.user_id, MAX(activity.last_active_at) AS last_active_at
    FROM activity
    GROUP BY activity.user_id
    ORDER BY MAX(activity.last_active_at) DESC
    LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_users_with_recent_activity(int, int)
    TO service_role;

COMMIT;
