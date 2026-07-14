-- Migration 092 — Réparation kill_reactions v1 → v2 (2026-07-14)
--
-- POURQUOI LA 085 ÉCHOUE CHEZ TOI
--   La 057 (Wave 25) avait créé kill_reactions en V1 AGRÉGÉE :
--   (id, kill_id, emoji, count, updated_at) UNIQUE(kill_id, emoji) — pas
--   de colonne d'identité. La 085 (V2 par-identité : user_id +
--   anon_fingerprint) commence par CREATE TABLE IF NOT EXISTS → no-op
--   sur la table 057, puis son index sur user_id explose :
--   « column "user_id" does not exist ». C'est pour ça que les fonctions
--   v2 n'ont jamais existé et que les réactions emoji étaient mortes en
--   prod (la route /api/kills/[id]/react appelle fn_increment_kill_
--   reaction_v2, absente).
--
-- CE QUE FAIT LA 092 (⚠️ à appliquer À LA PLACE de la 085)
--   1. Garde-fou : refuse de tourner si kill_reactions contient des
--      lignes (vérifié le 2026-07-14 : 0 ligne — mais on ne détruit
--      jamais à l'aveugle).
--   2. DROP de la table v1 vide + de son RPC v1 obsolète.
--   3. Recrée la V2 complète de la 085 : table par-identité, index
--      partiels, RLS deny-all (écritures service-role uniquement),
--      fn_increment_kill_reaction_v2 (REVOKE anon) et
--      fn_kill_reaction_counts (GRANT anon).
--
-- Répare d'un coup : réactions emoji de /scroll + rituel du F de la
-- Chambre des Souffrances.

BEGIN;

-- ── 1. Garde-fou anti-destruction ────────────────────────────────────
DO $$
DECLARE
    n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM kill_reactions;
    IF n > 0 THEN
        RAISE EXCEPTION
            '092: kill_reactions contient % lignes — migration de données requise, ne pas dropper. Contacter Fable.', n;
    END IF;
EXCEPTION WHEN undefined_table THEN
    NULL; -- table déjà absente : on recrée directement
END $$;

-- ── 2. Purge de la v1 (table vide + RPC obsolète) ────────────────────
DROP TABLE IF EXISTS kill_reactions CASCADE;
DROP FUNCTION IF EXISTS fn_increment_kill_reaction(UUID, TEXT, INT);

-- ── 3. La V2 (contenu de la 085, inchangé) ───────────────────────────
CREATE TABLE kill_reactions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id          UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
    emoji            TEXT NOT NULL CHECK (
                         emoji IN ('🔥','👏','😂','😱','💀','🐐')
                     ),
    user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    anon_fingerprint TEXT,
    count            INT NOT NULL DEFAULT 0 CHECK (count >= 0 AND count <= 200),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (user_id IS NOT NULL OR anon_fingerprint IS NOT NULL)
);

CREATE UNIQUE INDEX uq_kill_reactions_user
    ON kill_reactions (kill_id, emoji, user_id)
    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_kill_reactions_anon
    ON kill_reactions (kill_id, emoji, anon_fingerprint)
    WHERE anon_fingerprint IS NOT NULL;
CREATE INDEX idx_kill_reactions_kill
    ON kill_reactions (kill_id);

ALTER TABLE kill_reactions ENABLE ROW LEVEL SECURITY;
-- Deny-all pour anon + authenticated : écritures service-role
-- uniquement, lectures via le RPC agrégé (les fingerprints ne doivent
-- jamais être sélectionnables).
CREATE POLICY "kill_reactions deny all" ON kill_reactions
    FOR ALL TO anon, authenticated
    USING (false) WITH CHECK (false);

-- ── Incrément atomique (appelé par la route API en service_role) ─────
CREATE OR REPLACE FUNCTION fn_increment_kill_reaction_v2(
    p_kill_id UUID,
    p_emoji TEXT,
    p_user_id UUID,
    p_fingerprint TEXT,
    p_delta INT
) RETURNS INT
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_delta INT := LEAST(GREATEST(COALESCE(p_delta, 1), 1), 20);
    v_count INT;
BEGIN
    IF p_emoji NOT IN ('🔥','👏','😂','😱','💀','🐐') THEN
        RAISE EXCEPTION 'invalid emoji';
    END IF;
    IF p_user_id IS NOT NULL THEN
        INSERT INTO kill_reactions (kill_id, emoji, user_id, count)
        VALUES (p_kill_id, p_emoji, p_user_id, v_delta)
        ON CONFLICT (kill_id, emoji, user_id) WHERE user_id IS NOT NULL
        DO UPDATE SET
            count = LEAST(kill_reactions.count + v_delta, 200),
            updated_at = now()
        RETURNING count INTO v_count;
    ELSIF p_fingerprint IS NOT NULL THEN
        INSERT INTO kill_reactions (kill_id, emoji, anon_fingerprint, count)
        VALUES (p_kill_id, p_emoji, p_fingerprint, v_delta)
        ON CONFLICT (kill_id, emoji, anon_fingerprint) WHERE anon_fingerprint IS NOT NULL
        DO UPDATE SET
            count = LEAST(kill_reactions.count + v_delta, 200),
            updated_at = now()
        RETURNING count INTO v_count;
    ELSE
        RAISE EXCEPTION 'identity required';
    END IF;
    RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION fn_increment_kill_reaction_v2(UUID, TEXT, UUID, TEXT, INT)
    FROM PUBLIC, anon, authenticated;

-- ── Lecture agrégée publique ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_kill_reaction_counts(p_kill_id UUID)
RETURNS TABLE (emoji TEXT, total BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT r.emoji, SUM(r.count)::BIGINT AS total
    FROM kill_reactions r
    WHERE r.kill_id = p_kill_id
    GROUP BY r.emoji;
$$;
GRANT EXECUTE ON FUNCTION fn_kill_reaction_counts(UUID) TO anon, authenticated;

COMMIT;

-- Vérification post-apply :
--   SELECT * FROM fn_kill_reaction_counts('00000000-0000-0000-0000-000000000000'::uuid);
--   → 0 ligne (pas d'erreur « function does not exist ») = OK
