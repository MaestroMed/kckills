-- Migration 096 — fermer les RPC d'administration du bracket à anon et authenticated
--
-- POURQUOI : la 063 fait `REVOKE ALL … FROM PUBLIC` puis `GRANT … TO
-- service_role`. Sur Supabase ça ne suffit pas : les privilèges par défaut
-- du schéma public donnent EXECUTE directement aux rôles anon et
-- authenticated à la création de chaque fonction. N'importe quel visiteur
-- pouvait donc appeler, avec la clé anon publique :
--   POST /rest/v1/rpc/fn_seed_monthly_bracket  → créer un tournoi
--   POST /rest/v1/rpc/fn_close_round           → clore un round
-- L'admin passe par le service role (/api/admin/bracket/*) : rien ne casse.
--
-- ⚠️ À appliquer à la main dans l'éditeur SQL Supabase (comme les autres).
-- Vérification après coup (doit renvoyer false, false, true) :
--   SELECT has_function_privilege('anon', 'public.fn_seed_monthly_bracket(text)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.fn_close_round(uuid, integer)', 'EXECUTE'),
--          has_function_privilege('service_role', 'public.fn_close_round(uuid, integer)', 'EXECUTE');

REVOKE EXECUTE ON FUNCTION public.fn_seed_monthly_bracket(TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_close_round(UUID, INT) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_seed_monthly_bracket(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_close_round(UUID, INT) TO service_role;
