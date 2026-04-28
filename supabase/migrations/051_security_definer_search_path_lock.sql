-- Migration 051 — SECURITY DEFINER search_path lock + missing CASCADE FKs
--
-- Two security/correctness fixes from the 2026-04-29 audit.
--
-- ─── Part A : SECURITY DEFINER search_path hijack class ─────────────
--
-- Postgres SECURITY DEFINER functions run with the OWNER's privileges,
-- not the caller's. If `search_path` isn't pinned, an attacker who can
-- create a function in a schema earlier in `search_path` (e.g. a
-- temporary schema, or a public-writable schema) can shadow our
-- `pg_catalog.*` calls and execute their code with our owner's grants.
-- This is CVE-class — it has bitten Supabase apps before.
--
-- Fix : `SET search_path = public, pg_catalog` at function level.
-- We use `CREATE OR REPLACE FUNCTION ... SET search_path = ...` so the
-- setting is part of the function definition (resilient across rolling
-- restarts vs ALTER FUNCTION which can race with the next call).
--
-- The 2026-04-29 audit flagged 6 functions missing the lock :
--   * fn_record_impression          (001)
--   * fn_update_kill_rating         (001)
--   * fn_update_comment_count       (001)
--   * fn_update_kill_search_vector  (001)
--   * fn_recompute_comment_upvotes  (038)
--   * fn_get_grid_cells             (004)
--   * fn_get_clips_filtered         (008)
--
-- We fix them all here. Idempotent : the ALTER FUNCTION ... SET takes
-- effect even if the function already has the setting.

ALTER FUNCTION public.fn_record_impression(uuid)
    SET search_path = public, pg_catalog;

ALTER FUNCTION public.fn_update_kill_rating()
    SET search_path = public, pg_catalog;

ALTER FUNCTION public.fn_update_comment_count()
    SET search_path = public, pg_catalog;

ALTER FUNCTION public.fn_update_kill_search_vector()
    SET search_path = public, pg_catalog;

-- These may not exist on every project (they're from later migrations
-- that some envs may not have applied). Wrap in DO blocks so the
-- migration is idempotent + safe to apply on partial-state DBs.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'fn_recompute_comment_upvotes'
    ) THEN
        EXECUTE 'ALTER FUNCTION public.fn_recompute_comment_upvotes() SET search_path = public, pg_catalog';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'fn_get_grid_cells'
    ) THEN
        -- Two-arg + three-arg overloads may exist depending on partial migrations
        FOR r IN
            SELECT p.oid::regprocedure AS sig
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'fn_get_grid_cells'
        LOOP
            EXECUTE 'ALTER FUNCTION ' || r.sig || ' SET search_path = public, pg_catalog';
        END LOOP;
    END IF;
END $$;

DO $$
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'fn_get_clips_filtered'
    LOOP
        EXECUTE 'ALTER FUNCTION ' || r.sig || ' SET search_path = public, pg_catalog';
    END LOOP;
END $$;

-- Also lock fn_get_feed_kills + fn_similar_kills + fn_recommend_kills
-- since they're SECURITY DEFINER too (we want consistency).
DO $$
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'fn_get_feed_kills',
            'fn_similar_kills',
            'fn_recommend_kills',
            'fn_get_feed_moments',
            'fn_record_moment_impression',
            'fn_update_moment_rating',
            'fn_update_moment_comment_count',
            'fn_update_moment_search_vector',
            'fn_release_stale_pipeline_locks'
          )
          AND p.prosecdef = true
    LOOP
        EXECUTE 'ALTER FUNCTION ' || r.sig || ' SET search_path = public, pg_catalog';
    END LOOP;
END $$;

-- ─── Part B : missing ON DELETE CASCADE on FKs to kills(id) ─────────
--
-- The 2026-04-28 pollution cleanup found that DELETE FROM kills failed
-- with FK violations because game_events.kill_id (migration 014) and
-- lab_evaluations.kill_id (016) reference kills(id) WITHOUT
-- ON DELETE CASCADE. We worked around it by deleting from those
-- tables first, but the next operator hitting the same problem will
-- re-discover it the hard way.
--
-- Fix : drop + recreate the FKs with ON DELETE CASCADE. Idempotent
-- via constraint-name introspection.

DO $$
DECLARE
    v_constraint TEXT;
BEGIN
    -- game_events.kill_id
    SELECT conname INTO v_constraint
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE t.relname = 'game_events' AND a.attname = 'kill_id' AND c.contype = 'f';

    IF v_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.game_events DROP CONSTRAINT %I', v_constraint);
        ALTER TABLE public.game_events
            ADD CONSTRAINT game_events_kill_id_fkey
            FOREIGN KEY (kill_id) REFERENCES public.kills(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
DECLARE
    v_constraint TEXT;
BEGIN
    -- game_events.moment_id
    SELECT conname INTO v_constraint
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE t.relname = 'game_events' AND a.attname = 'moment_id' AND c.contype = 'f';

    IF v_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.game_events DROP CONSTRAINT %I', v_constraint);
        ALTER TABLE public.game_events
            ADD CONSTRAINT game_events_moment_id_fkey
            FOREIGN KEY (moment_id) REFERENCES public.moments(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
DECLARE
    v_constraint TEXT;
BEGIN
    -- lab_evaluations.kill_id
    SELECT conname INTO v_constraint
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE t.relname = 'lab_evaluations' AND a.attname = 'kill_id' AND c.contype = 'f';

    IF v_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.lab_evaluations DROP CONSTRAINT %I', v_constraint);
        ALTER TABLE public.lab_evaluations
            ADD CONSTRAINT lab_evaluations_kill_id_fkey
            FOREIGN KEY (kill_id) REFERENCES public.kills(id) ON DELETE CASCADE;
    END IF;
END $$;

COMMENT ON SCHEMA public IS
    'Migration 051 (2026-04-29) : SECURITY DEFINER search_path locked on '
    '~12 functions ; ON DELETE CASCADE added to game_events.kill_id, '
    'game_events.moment_id, lab_evaluations.kill_id.';
