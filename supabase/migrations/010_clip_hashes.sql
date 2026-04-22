-- Migration 010 — content_hash + perceptual_hash columns on kills
--
-- Pourquoi : le worker `services/clip_hash.py` calcule depuis longtemps
-- deux empreintes par clip et les pousse dans le payload UPDATE de
-- `modules/clipper.py:316-322`. Les colonnes n'existaient pas, donc
-- chaque write produisait un warning silencieux PGRST204 :
--
--   "Could not find the 'content_hash' column of 'kills' in the schema cache"
--
-- Les clips s'uploadent quand même sur R2 (le upload ne dépend pas
-- de cet UPDATE), mais on perdait le hash + on polluait les logs.
--
-- Cette migration crée les colonnes + un index unique partial sur
-- content_hash. L'index unique active enfin la dedup byte-identical
-- prévue dans clip_hash.py : si le même VOD est re-clipé deux fois
-- (pipeline retry, manual reclip, etc.), la 2e tentative échoue avec
-- une violation de contrainte au lieu de gaspiller du R2.
--
-- Le perceptual_hash est indexé pour les recherches "near-duplicate"
-- (clips qui ne sont PAS bit-perfect identiques mais visuellement très
-- proches — typique des re-broadcasts d'un même match).

-- ─── content_hash : SHA-256 du fichier MP4 ─────────────────────────
-- 64 hex chars. NULL acceptable pour les rows pré-Phase 1.

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS content_hash TEXT;

ALTER TABLE moments
    ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- ─── perceptual_hash : pHash du thumbnail ──────────────────────────
-- 16 hex chars (64-bit hash). Distance de Hamming entre 2 phashes
-- < 5 ≈ même clip vu sous deux angles, < 10 ≈ même teamfight.

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS perceptual_hash TEXT;

ALTER TABLE moments
    ADD COLUMN IF NOT EXISTS perceptual_hash TEXT;

-- ─── Index unique sur content_hash (kills) ─────────────────────────
-- WHERE clause : on ne contraint que les rows AVEC un hash. Permet de
-- garder les rows pré-Phase 1 (NULL) sans les forcer à un backfill.

CREATE UNIQUE INDEX IF NOT EXISTS idx_kills_content_hash_unique
    ON kills(content_hash)
    WHERE content_hash IS NOT NULL;

-- ─── Index simple sur perceptual_hash (recherche near-dup) ─────────

CREATE INDEX IF NOT EXISTS idx_kills_perceptual_hash
    ON kills(perceptual_hash)
    WHERE perceptual_hash IS NOT NULL;

-- ─── Comments pour le schema browser ───────────────────────────────

COMMENT ON COLUMN kills.content_hash IS
    'SHA-256 du MP4 source (64 hex chars). UNIQUE WHERE NOT NULL — '
    'empêche le double-clip byte-identical du même VOD.';

COMMENT ON COLUMN kills.perceptual_hash IS
    'pHash 64-bit du thumbnail (16 hex chars). Hamming distance < 5 '
    '≈ même clip, < 10 ≈ même fight.';
