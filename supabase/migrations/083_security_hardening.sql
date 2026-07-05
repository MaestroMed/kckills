-- ═══════════════════════════════════════════════════════════════════
-- 083 — Security hardening (audit 2026-07-02)
--
-- Closes the four RLS-layer holes surfaced by the security audit:
--
--  1. comments / moment_comments : "Own comment update" had no column
--     scoping, so any user could PATCH their own pending comment to
--     moderation_status='approved' — a full bypass of the Haiku
--     moderation pipeline. Fixed with column-level UPDATE grants
--     (content + is_deleted only) + a trigger that re-enters
--     moderation when the content changes.
--
--  2. profiles : migration 076 revoked the PII hash columns for anon
--     but left AUTHENTICATED with table-wide SELECT — any logged-in
--     user could dump discord_id_hash / riot_puuid_hash for all rows.
--     Mirrors 076's column grant for authenticated.
--
--  3. user_events / reports : INSERT policies were WITH CHECK (true),
--     writable by anon via direct PostgREST — feed-ranking poisoning
--     (fabricated clip.viewed events) and report-queue spam with
--     spoofed reporter_id. Both tables are only ever written through
--     server API routes, which now use the service role — the public
--     INSERT surface is dropped entirely.
--
--  4. Residual SECURITY DEFINER functions without SET search_path
--     (the class migration 051 locked down, but these three predate /
--     postdate its hardcoded list) + fn_record_kill_report trusted a
--     caller-supplied p_user_id.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1a. comments : column-scoped writes ─────────────────────────────
REVOKE UPDATE ON public.comments FROM anon;
REVOKE UPDATE ON public.comments FROM authenticated;
GRANT UPDATE (content, is_deleted) ON public.comments TO authenticated;

REVOKE UPDATE ON public.moment_comments FROM anon;
REVOKE UPDATE ON public.moment_comments FROM authenticated;
GRANT UPDATE (content, is_deleted) ON public.moment_comments TO authenticated;

-- ratings : users only ever change their score.
REVOKE UPDATE ON public.ratings FROM anon;
REVOKE UPDATE ON public.ratings FROM authenticated;
GRANT UPDATE (score) ON public.ratings TO authenticated;

-- ── 1b. content edits re-enter moderation ───────────────────────────
-- The worker moderator + admin routes run as service_role and update
-- moderation_status WITHOUT touching content, so they are unaffected.
CREATE OR REPLACE FUNCTION fn_comment_edit_remoderate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    IF NEW.content IS DISTINCT FROM OLD.content THEN
        NEW.moderation_status := 'pending';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_comment_edit_remoderate ON comments;
CREATE TRIGGER trg_comment_edit_remoderate
    BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION fn_comment_edit_remoderate();

DROP TRIGGER IF EXISTS trg_moment_comment_edit_remoderate ON moment_comments;
CREATE TRIGGER trg_moment_comment_edit_remoderate
    BEFORE UPDATE ON moment_comments
    FOR EACH ROW EXECUTE FUNCTION fn_comment_edit_remoderate();

-- ── 2. profiles : PII hashes unreadable by authenticated too ────────
-- Same column list as 076 granted to anon. `SELECT *` on profiles no
-- longer works for user-facing clients — /api/me/GET was updated to
-- select explicit columns (the hashes are derived values, not needed
-- in the RGPD export).
REVOKE SELECT ON public.profiles FROM authenticated;
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
) ON public.profiles TO authenticated;

-- ── 3. user_events / reports : server-only writes ───────────────────
-- /api/track and /api/report now insert with the service role (which
-- bypasses RLS); no public write path remains.
DROP POLICY IF EXISTS "Anyone insert events" ON user_events;
REVOKE INSERT ON public.user_events FROM anon;
REVOKE INSERT ON public.user_events FROM authenticated;

DROP POLICY IF EXISTS "Anyone insert reports" ON reports;
REVOKE INSERT ON public.reports FROM anon;
REVOKE INSERT ON public.reports FROM authenticated;

-- ── 4a. search_path locks (051-class, missed functions) ─────────────
ALTER FUNCTION fn_get_match_context_videos(TEXT)
    SET search_path = public, pg_catalog;
ALTER FUNCTION fn_update_kill_like_count()
    SET search_path = public, pg_catalog;
ALTER FUNCTION fn_compilations_touch_updated()
    SET search_path = public, pg_catalog;

-- ── 4b. fn_record_kill_report : derive identity server-side ─────────
-- p_user_id kept in the signature for caller compatibility but is no
-- longer trusted: the recorded user is auth.uid() (NULL for anon).
CREATE OR REPLACE FUNCTION fn_record_kill_report(
    p_kill_id UUID,
    p_reason  TEXT,
    p_user_id UUID DEFAULT NULL,
    p_ip_hash TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO kill_reports (kill_id, reason, user_id, ip_hash)
    VALUES (
        p_kill_id,
        COALESCE(NULLIF(p_reason, ''), 'unspecified'),
        auth.uid(),          -- was: p_user_id (spoofable by any caller)
        p_ip_hash
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

COMMIT;
