-- Migration 090 — Advisor Supabase : Security Definer Views (2026-07-14)
--
-- L'Advisor flagge 4 vues CRITICAL (+ 3 sœurs jamais corrigées par la
-- 050) : elles tournent avec les privilèges du OWNER, donc N'IMPORTE QUI
-- avec la clé anon peut lire leur contenu en contournant les RLS des
-- tables sous-jacentes. Concrètement exposé aujourd'hui à tout visiteur :
--   * v_recent_push_notifications — historique des notifications push
--   * v_admin_actions_7d          — l'audit trail des actions ADMIN
--   * v_pipeline_health           — état interne du pipeline
--   * v_clip_engagement_24h / v_trending_kills_1h — analytics internes
--   * v_ai_cost_24h               — dépense IA
--   * v_player_fans_count         — compte de follows (bénin mais autant
--                                    fermer proprement)
--
-- ⚠️ ORDRE D'APPLICATION — D'ABORD LE WEB, ENSUITE CETTE MIGRATION.
-- Les pages admin lisent ces vues avec le client ANON
-- (createServerSupabase). Passer les vues en security_invoker rendra
-- leurs résultats VIDES pour l'anon (c'est le but). Il faut donc d'abord
-- basculer ces call sites sur createServiceSupabase() (server-only) :
--   * web/src/app/admin/analytics/page.tsx  (v_clip_engagement_24h,
--                                             v_trending_kills_1h)
--   * web/src/app/admin/audit/page.tsx      (v_admin_actions_7d)
--   * web/src/app/admin/push/page.tsx       (v_recent_push_notifications)
--   * web/src/app/admin/pipeline/page.tsx   (v_pipeline_health)
--   * v_ai_cost_24h : vérifier ses consommateurs (admin/dashboard)
--   * /api/players/[id]/follow : remplacer la lecture de
--     v_player_fans_count par le RPC fn_player_fans_count ci-dessous
--     (ou un client service role).
-- → C'est le périmètre de la session admin en cours sur l'autre PC.
--
-- Idempotent : DO-blocks gardés par pg_views.

DO $$
DECLARE
    v TEXT;
BEGIN
    FOREACH v IN ARRAY ARRAY[
        'v_recent_push_notifications',
        'v_pipeline_health',
        'v_clip_engagement_24h',
        'v_trending_kills_1h',
        'v_admin_actions_7d',
        'v_ai_cost_24h',
        'v_player_fans_count'
    ] LOOP
        IF EXISTS (
            SELECT 1 FROM pg_views
            WHERE schemaname = 'public' AND viewname = v
        ) THEN
            EXECUTE format(
                'ALTER VIEW public.%I SET (security_invoker = on)', v);
        END IF;
    END LOOP;
END $$;

-- ─── Compte de fans public sans exposer les rows ──────────────────────
-- player_follows a des RLS "own read" : un invoker view ne peut plus
-- compter les fans pour l'anon. On expose UNIQUEMENT l'agrégat via une
-- fonction SECURITY DEFINER minimaliste (pas de fuite de rows, pas de
-- paramètre libre injectable, search_path épinglé).

CREATE OR REPLACE FUNCTION fn_player_fans_count(p_player_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT count(*)::int FROM player_follows WHERE player_id = p_player_id;
$$;

GRANT EXECUTE ON FUNCTION fn_player_fans_count(UUID) TO anon, authenticated;

COMMENT ON FUNCTION fn_player_fans_count(UUID) IS
    'Migration 090 — remplace la lecture anon de v_player_fans_count '
    '(passée en security_invoker). Expose le COUNT seul, jamais les rows.';
