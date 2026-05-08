-- Migration 056 — Enable RLS on leagues table
-- Wave 19 (2026-05-08) — addresses Data audit finding (RLS coverage
-- gap on the new `leagues` table introduced by migration 043).
--
-- Why
-- ────
-- 043 created `leagues` as a public catalog table (read-only for
-- everyone, write only via service role) but never called `ALTER
-- TABLE leagues ENABLE ROW LEVEL SECURITY`. With RLS disabled, the
-- table is wide-open to any authenticated client — they could
-- INSERT / UPDATE / DELETE rows directly via PostgREST. No active
-- exploit (no public write API), but the audit advisor flags it as
-- "RLS disabled on table that's exposed via the API".
--
-- This migration :
--
--   1. Enables RLS on the `leagues` table.
--   2. Grants public SELECT (the worker reads at boot, the frontend
--      reads via `/api/leagues`).
--   3. Denies INSERT / UPDATE / DELETE for anon + authenticated.
--      Service role bypasses RLS automatically (workers + admin
--      writes).
--
-- Idempotent : `IF EXISTS` / `DROP POLICY IF EXISTS` everywhere.
-- Safe to re-run.

BEGIN;

ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;

-- Public SELECT — anyone can read the league catalog.
DROP POLICY IF EXISTS leagues_public_read ON leagues;
CREATE POLICY leagues_public_read ON leagues
  FOR SELECT TO anon, authenticated
  USING (true);

-- No INSERT / UPDATE / DELETE for anon or authenticated. Service
-- role bypasses RLS, so the worker + admin scripts continue to
-- write unaffected.
DROP POLICY IF EXISTS leagues_no_anon_write ON leagues;
CREATE POLICY leagues_no_anon_write ON leagues
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Note : the FOR SELECT policy + the FOR ALL deny policy coexist —
-- PostgreSQL applies the most permissive matching policy per
-- operation. SELECT hits leagues_public_read (allowed). INSERT /
-- UPDATE / DELETE hit leagues_no_anon_write (denied). Service role
-- bypasses both.

COMMIT;

-- Verification :
--   -- As anon (no JWT) :
--   SELECT count(*) FROM leagues;          -- works
--   INSERT INTO leagues (slug, name) VALUES ('x', 'X');  -- DENIED
--
--   -- As service role :
--   INSERT INTO leagues (slug, name) VALUES ('x', 'X');  -- works
