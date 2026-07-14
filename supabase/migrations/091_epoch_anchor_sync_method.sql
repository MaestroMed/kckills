-- Migration 091 — sync_method 'epoch_anchor' (vague 2 décryptage)
--
-- 42 % des games partagent leur VOD (94 VODs / 278 games au 2026-07-14).
-- Une fois UNE game d'un VOD décryptée par vision, l'ancre
-- stream_start_epoch = epoch_kill - vod_time(kill) place toutes les
-- games sœurs par arithmétique d'epoch, zéro vision. Ces modèles sont
-- persistés avec sync_method='epoch_anchor', que le CHECK de la 088 ne
-- connaissait pas.

ALTER TABLE game_vod_sources DROP CONSTRAINT IF EXISTS chk_vod_sync_method;
ALTER TABLE game_vod_sources ADD CONSTRAINT chk_vod_sync_method CHECK (
    sync_method IN ('official_epoch','gemini_multipoint','ocr_multipoint',
                    'hybrid_multipoint','single_point_legacy','manual',
                    'epoch_anchor')
    OR sync_method IS NULL
);

COMMENT ON CONSTRAINT chk_vod_sync_method ON game_vod_sources IS
    '091 : + epoch_anchor (modèle dérivé de l''ancre epoch du VOD, '
    'propagé depuis une game sœur décryptée par vision).';
