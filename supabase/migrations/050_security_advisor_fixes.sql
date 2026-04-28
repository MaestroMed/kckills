-- Migration 050 — Supabase Advisor critical security fixes (2026-04-28).
--
-- The Supabase project dashboard advisor flagged 4 CRITICAL items :
--   * RLS Disabled in Public on `kill_tags`
--   * RLS Disabled in Public on `health_checks`
--   * Security Definer View on `v_game_events_qc_audit`
--   * Security Definer View on `v_game_events_legacy`
--
-- Both classes are real risks :
--   - RLS-disabled tables in the `public` schema are reachable via the
--     anon key, so any visitor (or scraper) can SELECT/INSERT/DELETE
--     without auth. `kill_tags` is community-curated metadata that
--     SHOULD be read-only public + auth-only writeable. `health_checks`
--     is an internal worker heartbeat table that SHOULD be service-
--     role-only.
--   - SECURITY DEFINER views run with the view OWNER's privileges
--     instead of the calling user's. If a regular user can SELECT the
--     view, they can read data they wouldn't normally see via RLS on
--     the underlying tables. Switch to SECURITY INVOKER (the default
--     since PG 15) so the view respects the caller's RLS.
--
-- Idempotent : safe to re-run. ALTER TABLE ... ENABLE ROW LEVEL
-- SECURITY is no-op when already enabled, CREATE POLICY IF NOT EXISTS
-- guards repeat runs.

-- ─── kill_tags : public read, auth write ───────────────────────────────

ALTER TABLE IF EXISTS public.kill_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kill_tags_public_read" ON public.kill_tags;
CREATE POLICY "kill_tags_public_read"
  ON public.kill_tags
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "kill_tags_auth_insert" ON public.kill_tags;
CREATE POLICY "kill_tags_auth_insert"
  ON public.kill_tags
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Update / delete : service-role only (no policy = no access via RLS).
-- Service role bypasses RLS so the worker keeps full control.

-- ─── health_checks : service-role only ─────────────────────────────────

ALTER TABLE IF EXISTS public.health_checks ENABLE ROW LEVEL SECURITY;

-- No SELECT policy at all → anon + authenticated callers see nothing.
-- The worker uses the service role and bypasses RLS, which is what we
-- want for a heartbeat table containing internal job state.

-- ─── v_game_events_qc_audit : SECURITY DEFINER → INVOKER ───────────────

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_views
        WHERE schemaname = 'public' AND viewname = 'v_game_events_qc_audit'
    ) THEN
        EXECUTE 'ALTER VIEW public.v_game_events_qc_audit SET (security_invoker = on)';
    END IF;
END $$;

-- ─── v_game_events_legacy : SECURITY DEFINER → INVOKER ─────────────────

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_views
        WHERE schemaname = 'public' AND viewname = 'v_game_events_legacy'
    ) THEN
        EXECUTE 'ALTER VIEW public.v_game_events_legacy SET (security_invoker = on)';
    END IF;
END $$;

COMMENT ON TABLE public.kill_tags IS
    'Community-curated tags on kills. Public SELECT, auth INSERT, '
    'service-role-only UPDATE/DELETE. Migration 050 added RLS.';
COMMENT ON TABLE public.health_checks IS
    'Worker heartbeat / internal job state. Service-role-only via RLS '
    '(no policies for anon/authenticated). Migration 050 added RLS.';
