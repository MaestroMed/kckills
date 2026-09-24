-- Migration 095 — v_kc_stats_scopes : compteurs canoniques par périmètre
-- (audit compteurs 2026-08-12)
--
-- POURQUOI : cinq surfaces (home, /scroll, /clips, /matches, /stats)
-- affichaient cinq vérités différentes pour « clips » / « kills » /
-- « matchs » parce que chacune portait sa propre requête avec son propre
-- prédicat (voir web/src/lib/stats-scopes.ts pour le détail). Cette vue
-- renvoie TOUS les compteurs canoniques en UN SELECT (une ligne) :
--   * moins d'egress (1 requête au lieu de 5-6 HEAD counts par TTL),
--   * plus robuste (un seul endroit où vit chaque prédicat côté SQL).
--
-- ⚠️ NON APPLIQUÉE AUTOMATIQUEMENT — Mehdi l'applique à la main.
-- Le code web (web/src/lib/stats-scopes.ts) tente la vue et retombe sur
-- les requêtes REST historiques (prédicats identiques) si elle n'existe
-- pas encore. Aucune dépendance dure.
--
-- SÉCURITÉ : security_invoker = on (cf. migration 090 / Advisor) — la vue
-- compte sous les RLS de l'appelant. Pour l'anon c'est équivalent aux
-- requêtes actuelles : kills n'expose que les lignes publiées (policy
-- « Public kills ») et teams / matches / games / tournaments sont en
-- lecture publique (déjà consommés par l'anon sur /matches et la home).
--
-- Vérité terrain au 12/08/2026 (REST, clé anon) :
--   published_clips   = 5 224   detected_kc_kills = 5 234
--   matches_total     = 537     matches_wins      = 305
--   matches_unknown   = 42  (backfill gol.gg sans winner_team_id)
--   games_total       = 671     year_start/end    = 2021 / 2026

CREATE OR REPLACE VIEW public.v_kc_stats_scopes
WITH (security_invoker = on) AS
WITH kc AS (
    -- L'équipe trackée (KC). LIMIT 1 : le pilote n'en tracke qu'une.
    SELECT id FROM public.teams WHERE is_tracked = TRUE LIMIT 1
),
kc_matches AS (
    -- Matchs KC terminés, toutes compétitions (LFL 2021, EU Masters,
    -- LEC…). L'année vient du tournoi d'abord : la majorité des matchs
    -- backfillés gol.gg ont scheduled_at NULL.
    SELECT m.id,
           m.winner_team_id,
           COALESCE(t.year, EXTRACT(YEAR FROM m.scheduled_at)::int) AS yr
    FROM public.matches m
    LEFT JOIN public.tournaments t ON t.id = m.tournament_id
    CROSS JOIN kc
    WHERE m.state = 'completed'
      AND (m.team_blue_id = kc.id OR m.team_red_id = kc.id)
)
SELECT
    -- « CLIPS » : kills KC publiés AVEC clip jouable. Prédicat STRICTEMENT
    -- identique à getPublishedKcKillCount (web/src/lib/supabase/kills.ts)
    -- — si l'un des deux bouge, l'autre DOIT bouger.
    (SELECT count(*) FROM public.kills k
      WHERE (k.publication_status = 'published'
             OR (k.publication_status IS NULL AND k.status = 'published'))
        AND k.kill_visible IS TRUE
        AND k.tracked_team_involvement = 'team_killer'
        AND k.clip_url_vertical IS NOT NULL
        AND k.thumbnail_url IS NOT NULL)::int          AS published_clips,

    -- « KILLS » : événements de kill KC publiés/visibles, clip OU data-only.
    (SELECT count(*) FROM public.kills k
      WHERE (k.publication_status = 'published'
             OR (k.publication_status IS NULL AND k.status = 'published'))
        AND k.kill_visible IS TRUE
        AND k.tracked_team_involvement = 'team_killer')::int AS detected_kc_kills,

    -- Bilan matchs toutes compétitions. Invariant côté web :
    -- losses = total - wins - unknown (les matchs sans winner_team_id ne
    -- sont NI des défaites NI dans le winrate).
    (SELECT count(*) FROM kc_matches)::int             AS matches_total,
    (SELECT count(*) FROM kc_matches km
      WHERE km.winner_team_id = (SELECT id FROM kc))::int AS matches_wins,
    (SELECT count(*) FROM kc_matches km
      WHERE km.winner_team_id IS NULL)::int            AS matches_unknown,

    -- Games rattachées aux matchs KC terminés. NB : games.winner_team_id
    -- est NULL sur tout le backfill gol.gg → pas de winrate par game ici.
    (SELECT count(*) FROM public.games g
      JOIN kc_matches km ON km.id = g.match_id)::int   AS games_total,

    -- Fenêtre d'années carrière (clamp ère esport 2011-2030 : une ligne
    -- mal datée ne doit pas empoisonner la fenêtre — cf. bug « 1970 »).
    (SELECT min(km.yr) FROM kc_matches km
      WHERE km.yr BETWEEN 2011 AND 2030)::int          AS year_start,
    (SELECT max(km.yr) FROM kc_matches km
      WHERE km.yr BETWEEN 2011 AND 2030)::int          AS year_end;

COMMENT ON VIEW public.v_kc_stats_scopes IS
  'Compteurs canoniques KCKILLS par périmètre (audit 2026-08-12). '
  'Consommée par web/src/lib/stats-scopes.ts (fallback REST si absente). '
  'clips = kills KC publiés avec clip jouable ; kills = événements KC '
  'publiés/visibles ; matches_unknown = terminés sans winner_team_id.';

-- Supabase, 30/10/2026 : les nouveaux objets de `public` ne reçoivent plus
-- de GRANT automatique, service_role compris : on les pose tous ici.
GRANT SELECT ON public.v_kc_stats_scopes TO anon, authenticated, service_role;
