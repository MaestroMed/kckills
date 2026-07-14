-- Migration 089 — Neutralisation des doublons sémantiques + index NULL-proof
--
-- ⚠️ À RELIRE AVANT D'APPLIQUER — touche ~7 700 lignes kills (audit
--    2026-07-14 : 2 193 groupes / 9 865 lignes dont 1 keeper par groupe).
-- ⚠️ Appliquer APRÈS la 088 (qui ajoute status='duplicate' + is_duplicate_of).
--
-- CE QU'ELLE FAIT
--   1. Pour chaque groupe (game_id, event_epoch, victim_champion) avec
--      event_epoch > 0 : garde LA meilleure ligne (published > analyzed >
--      clipped > … puis URLs présentes, puis player_ids mappés, puis la plus
--      ancienne), neutralise les autres en status='duplicate' +
--      is_duplicate_of=keeper. JAMAIS de DELETE (les kill_assets/R2 des
--      absorbés restent référencés).
--   2. Bloque la publication des game_events liés aux absorbés
--      (qc_human_approved=FALSE → is_publishable passe à FALSE → le
--      event_publisher les rétracte au prochain cycle).
--   3. Pose l'index UNIQUE partiel NULL-proof qui empêche la ré-insertion
--      des mêmes doublons par les prochains runs du harvester/backfill.
--
-- CE QU'ELLE NE FAIT PAS (volontairement — c'est le backfill Python) :
--   * le collapse des séquences multi-kill (quadra absorbe triple+double) —
--     nécessite la fenêtre temporelle par killer, fait par
--     scripts/backfill_au_crible.py qui remplit aussi clip_ledger ;
--   * les doublons gol.gg à event_epoch=0 (pas de clé fiable en SQL pur).

-- ═══════════════════════════════════════════════════════════════════
-- 1. Neutralisation (keeper = meilleure ligne du groupe)
-- ═══════════════════════════════════════════════════════════════════

WITH ranked AS (
    SELECT
        id,
        row_number() OVER w AS rn,
        first_value(id) OVER w AS keeper_id
    FROM kills
    WHERE event_epoch > 0
      AND victim_champion IS NOT NULL
      AND status <> 'duplicate'
    WINDOW w AS (
        PARTITION BY game_id, event_epoch, victim_champion
        ORDER BY
            CASE status
                WHEN 'published'     THEN 0
                WHEN 'analyzed'      THEN 1
                WHEN 'clipped'       THEN 2
                WHEN 'clipping'      THEN 3
                WHEN 'vod_found'     THEN 4
                WHEN 'enriched'      THEN 5
                WHEN 'raw'           THEN 6
                WHEN 'needs_review'  THEN 7
                WHEN 'clip_error'    THEN 8
                WHEN 'manual_review' THEN 9
                ELSE 10
            END,
            (clip_url_vertical IS NULL),        -- URLs présentes d'abord
            (killer_player_id IS NULL),         -- player mappé d'abord
            (highlight_score IS NULL),          -- déjà analysé d'abord
            created_at ASC,                     -- le plus ancien
            id                                  -- tie-break déterministe
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    )
)
UPDATE kills k
SET status             = 'duplicate',
    is_duplicate_of    = r.keeper_id,
    publication_status = 'retracted'
FROM ranked r
WHERE k.id = r.id
  AND r.rn > 1;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Rétracter les game_events des absorbés
-- ═══════════════════════════════════════════════════════════════════

UPDATE game_events ge
SET qc_human_approved     = FALSE,
    publish_blocked_reason = 'duplicate_kill_neutralized_089'
FROM kills k
WHERE ge.kill_id = k.id
  AND k.status = 'duplicate'
  AND (ge.qc_human_approved IS DISTINCT FROM FALSE);

-- ═══════════════════════════════════════════════════════════════════
-- 3. Index UNIQUE partiel — la porte se referme
-- ═══════════════════════════════════════════════════════════════════
-- NULL-proof : ne dépend d'aucun player_id (contrairement à
-- idx_kills_unique_event de la 030 que les mappings ratés contournaient).
-- Un INSERT en collision lèvera 23505 → le worker le compte comme
-- « déjà présent » (supabase_client.flush_cache le drop proprement).

CREATE UNIQUE INDEX IF NOT EXISTS idx_kills_semantic_unique
    ON kills(game_id, event_epoch, victim_champion)
    WHERE status <> 'duplicate'
      AND event_epoch > 0
      AND victim_champion IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 4. Bilan (affiché dans le SQL editor)
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
    n_dup INT;
    n_pub INT;
BEGIN
    SELECT count(*) INTO n_dup FROM kills WHERE status = 'duplicate';
    SELECT count(*) INTO n_pub FROM kills WHERE status = 'published';
    RAISE NOTICE '089 done — % kills neutralisés (duplicate), % encore published',
        n_dup, n_pub;
END $$;
