-- Migration 076 (Wave 35 SOTA audit) — close 2 live RLS/PII holes
--
-- Found by the security audit agent (2026-05-28). Both are STOP-level
-- per CLAUDE.md §7 (RLS on ALL tables; zero-knowledge on hashes).
--
-- ── HOLE 1 : clip_sets + clip_set_members have NO RLS ──────────────
-- Created in migration 006 without ENABLE ROW LEVEL SECURITY and never
-- caught by the bulk-RLS migrations. In the public schema, RLS-off means
-- the browser-shipped ANON key can INSERT/UPDATE/DELETE these curated-
-- anthology rows (defacement / integrity). No PII, but a real write hole.
-- Fix : enable RLS + public READ policy only. No write policy ⇒ only
-- service_role (worker/admin, bypasses RLS) can mutate.
--
-- ── HOLE 2 : profiles SHA-256 hashes readable by anon ──────────────
-- The "Public profiles read" policy is USING(true) (migration 001).
-- Migration 072 added a restricted public_profiles VIEW but deliberately
-- KEPT the broad row policy (the T2.1b drop was never shipped). So anon
-- can still `from('profiles').select('discord_id_hash, riot_puuid_hash')`
-- directly → enumerable Discord snowflakes → rainbow-table, + Riot ids.
--
-- Fix chosen : COLUMN-level grant on the anon role. We verified NO public
-- code path reads the hashes (/u/[username] reads only safe cols;
-- riot_profile.ts reads riot_* ; api/me reads its OWN row as authenticated).
-- So revoking anon's table-wide SELECT and re-granting only the 13 safe
-- columns closes the scrape vector with ZERO code change and ZERO risk to
-- authenticated/own-row flows. RLS row policy is left intact (rows still
-- readable, the 2 hash columns are not).
--
-- Residual (documented, lesser): an AUTHENTICATED user can still read
-- another user's hashes via the USING(true) policy. Lower risk (logged-in,
-- accountable, values are SHA-256 not raw ids). Follow-up: scope the row
-- policy to own-row + route public reads through public_profiles once the
-- view is widened to include the riot_* columns its callers need.

BEGIN;

-- ── HOLE 1 ──────────────────────────────────────────────────────────
ALTER TABLE clip_sets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE clip_set_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public active clip_sets" ON clip_sets;
CREATE POLICY "Public active clip_sets" ON clip_sets
    FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Public clip_set_members" ON clip_set_members;
CREATE POLICY "Public clip_set_members" ON clip_set_members
    FOR SELECT USING (true);
-- No INSERT/UPDATE/DELETE policy on purpose : anon/authenticated cannot
-- write ; the worker + admin use service_role which bypasses RLS.

-- ── HOLE 2 ──────────────────────────────────────────────────────────
-- Drop anon's table-wide SELECT, re-grant only the non-sensitive columns.
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (
    id,
    discord_username,
    discord_avatar_url,
    riot_summoner_name,
    riot_tag,
    riot_rank,
    riot_top_champions,
    riot_linked_at,
    total_ratings,
    total_comments,
    badges,
    created_at,
    last_seen_at
) ON public.profiles TO anon;
-- discord_id_hash + riot_puuid_hash are now unreadable by anon. The
-- public_profiles view (owner-privileged) keeps working for its 6 cols.

COMMIT;
