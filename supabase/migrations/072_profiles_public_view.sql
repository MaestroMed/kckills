-- Migration 072 (Wave 34 T2.1) — RGPD restrict Public profiles policy
--
-- Pre-Wave-34 : `CREATE POLICY "Public profiles read" ON profiles FOR
-- SELECT USING (true)` exposait TOUS les colonnes de profiles à anon,
-- y compris `discord_id_hash`, `riot_puuid_hash`, `riot_summoner_name`,
-- `riot_tag`, `riot_rank`, `last_seen_at`, `badges`, etc.
--
-- Violation directe CLAUDE.md PARTIE 7.1 : "On stocke seulement username
-- Discord, avatar URL, données publiques". Le hash SHA-256 du Discord ID
-- est leakable par rainbow-table sur un dictionnaire de Discord IDs
-- connus (Discord IDs sont des snowflakes 64-bit, énumérables).
--
-- Fix : créer une VIEW `public_profiles` qui n'expose que les colonnes
-- véritablement publiques, déprécier le SELECT direct sur profiles pour
-- les anon, et faire pointer le code client vers la view.
--
-- Stratégie de déploiement :
--   1. Cette migration crée la view + GRANT SELECT sur la view à anon
--   2. La policy "Public profiles read" reste pour back-compat
--      (les SELECT existants ne cassent pas le jour J)
--   3. Wave 34 T2.1b (follow-up) refactor tous les `from('profiles')`
--      côté client vers `from('public_profiles')`, puis DROP la policy
--      large.
--
-- Cette migration est SAFE : ne casse aucun consumer existant, ajoute
-- juste une surface restreinte pour le code nouveau.

BEGIN;

-- Drop la view si elle existe déjà (idempotent re-run)
DROP VIEW IF EXISTS public_profiles;

-- Vue publique restreinte : seulement les colonnes whitelistées.
-- Per CLAUDE.md PARTIE 7.1 : "username Discord, avatar URL, données publiques".
-- Total stats (total_ratings/comments) sont publiques pour les leaderboards.
-- Pas de hashes, pas de Riot data, pas de timestamp last_seen.
CREATE VIEW public_profiles AS
SELECT
    id,
    discord_username,
    discord_avatar_url,
    total_ratings,
    total_comments,
    created_at
FROM profiles;

-- Grant SELECT à anon + authenticated. La view hérite de la RLS de
-- profiles, mais le filtre de colonnes restreint le surface area.
GRANT SELECT ON public_profiles TO anon, authenticated;

COMMENT ON VIEW public_profiles IS
    'Wave 34 T2.1 — restricted public surface of profiles. Hides hashes '
    '(discord_id_hash, riot_puuid_hash), Riot account (summoner_name, tag, '
    'rank, top_champions), last_seen_at, badges, riot_linked_at. Use '
    'this view from anon/public code paths instead of querying profiles '
    'directly. The large "Public profiles read" policy is kept for '
    'back-compat — Wave 34 T2.1b drops it after refactoring callers.';

-- Wave 34 T2.1 NEXT STEPS (à faire dans une PR séparée web-side) :
--   Find: from("profiles").select(...) avec auth.uid() != id
--   Replace: from("public_profiles").select(...)
--   Une fois 100% des callers migrés, ajouter migration 073 :
--     DROP POLICY "Public profiles read" ON profiles;
--     CREATE POLICY "Own profile read" ON profiles
--       FOR SELECT USING (auth.uid() = id);

COMMIT;
