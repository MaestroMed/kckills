-- Migration 057 — Wave 25 (2026-05-08) — social-graph tables
-- Covers V10 (bookmarks), V16 (kill_reactions server aggregate),
-- V34 (player follows), V38 (fans counter view), V39 (kill_reports
-- moderation queue), V40 (creator tipping links).
--
-- All tables are RLS-enabled. Public reads are gated on aggregated
-- views ; per-user writes go through their own auth.uid() row.
--
-- Idempotent : every CREATE uses IF NOT EXISTS so re-runs are safe.

BEGIN;

-- ─── V10 — kill bookmarks ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kill_bookmarks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kill_id     UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    note        TEXT CHECK (length(note) <= 200),
    UNIQUE (user_id, kill_id)
);
CREATE INDEX IF NOT EXISTS idx_kill_bookmarks_user_created
    ON kill_bookmarks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kill_bookmarks_kill
    ON kill_bookmarks (kill_id);
ALTER TABLE kill_bookmarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kill_bookmarks own read" ON kill_bookmarks;
CREATE POLICY "kill_bookmarks own read" ON kill_bookmarks
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "kill_bookmarks own write" ON kill_bookmarks;
CREATE POLICY "kill_bookmarks own write" ON kill_bookmarks
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── V34 — player follows ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS player_follows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    notify_push BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (user_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_player_follows_user
    ON player_follows (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_follows_player
    ON player_follows (player_id);
ALTER TABLE player_follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "player_follows own read" ON player_follows;
CREATE POLICY "player_follows own read" ON player_follows
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "player_follows own write" ON player_follows;
CREATE POLICY "player_follows own write" ON player_follows
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- V38 — fans counter view (aggregate, public-readable).
CREATE OR REPLACE VIEW v_player_fans_count AS
    SELECT player_id, COUNT(*)::INT AS fans_count
    FROM player_follows
    GROUP BY player_id;
GRANT SELECT ON v_player_fans_count TO anon, authenticated;

-- ─── V16 — kill_reactions (emoji aggregates) ──────────────────────
CREATE TABLE IF NOT EXISTS kill_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id     UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL CHECK (
                    emoji IN ('🔥','👏','😂','😱','💀','🐐')
                ),
    count       INT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (kill_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_kill_reactions_kill
    ON kill_reactions (kill_id);
ALTER TABLE kill_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kill_reactions public read" ON kill_reactions;
CREATE POLICY "kill_reactions public read" ON kill_reactions
    FOR SELECT USING (TRUE);
-- Writes via SECURITY DEFINER RPC only (anon-spam protection).

CREATE OR REPLACE FUNCTION fn_increment_kill_reaction(
    p_kill_id UUID,
    p_emoji   TEXT,
    p_delta   INT DEFAULT 1
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    new_count INT;
BEGIN
    IF p_delta NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'p_delta must be 1..5 (got %)', p_delta;
    END IF;
    INSERT INTO kill_reactions (kill_id, emoji, count, updated_at)
    VALUES (p_kill_id, p_emoji, p_delta, now())
    ON CONFLICT (kill_id, emoji)
    DO UPDATE SET
        count = kill_reactions.count + EXCLUDED.count,
        updated_at = now()
    RETURNING count INTO new_count;
    RETURN new_count;
END;
$$;
GRANT EXECUTE ON FUNCTION fn_increment_kill_reaction(UUID, TEXT, INT)
    TO anon, authenticated;

-- ─── V39 — kill_reports (moderation queue) ────────────────────────
CREATE TABLE IF NOT EXISTS kill_reports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id     UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
    reason      TEXT NOT NULL CHECK (length(reason) <= 200),
    user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ip_hash     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolution  TEXT CHECK (resolution IN ('approved','dismissed','hidden'))
);
CREATE INDEX IF NOT EXISTS idx_kill_reports_pending
    ON kill_reports (kill_id, created_at DESC)
    WHERE resolved_at IS NULL;
ALTER TABLE kill_reports ENABLE ROW LEVEL SECURITY;
-- Anon can write reports via a SECURITY DEFINER RPC. Reads gated to
-- service-role (admins) only. The /api/kills/[id]/report route now
-- has an RPC to call.
DROP POLICY IF EXISTS "kill_reports admin read" ON kill_reports;
CREATE POLICY "kill_reports admin read" ON kill_reports
    FOR SELECT USING (FALSE);  -- service role bypasses RLS

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
    VALUES (p_kill_id, COALESCE(NULLIF(p_reason, ''), 'unspecified'), p_user_id, p_ip_hash)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION fn_record_kill_report(UUID, TEXT, UUID, TEXT)
    TO anon, authenticated;

-- ─── V35 — push_subscriptions player-scope extension ──────────────
-- Add `player_filter` JSONB column so a subscription can carry a list
-- of player_ids the user wants notifications for. Empty/NULL = all
-- (legacy broadcast behaviour preserved).
ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS player_filter UUID[] DEFAULT NULL;

-- ─── V40 — creator tipping links (lightweight) ────────────────────
-- Just a column on the players table for the creator's tip URL.
-- The UI surfaces a "Soutenir <player>" button when the URL is set.
ALTER TABLE players
    ADD COLUMN IF NOT EXISTS tip_url TEXT
        CHECK (tip_url IS NULL OR tip_url ~ '^https://');

COMMENT ON COLUMN players.tip_url IS
    'Optional Twitch / Discord donation URL surfaced on /player/[slug] '
    '+ the player profile drawer. Set per player by admin.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- Operator usage
-- ═══════════════════════════════════════════════════════════════════
--
-- Apply via Supabase Management API (PAT) or `supabase db push` :
--
--   curl -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
--        -H "Authorization: Bearer $SUPABASE_PAT" \
--        -H "Content-Type: application/json" \
--        -d "{\"query\": \"$(cat 057_v10_v34_social_tables.sql | tr '\n' ' ')\"}"
--
-- Verify after apply :
--
--   SELECT count(*) FROM kill_bookmarks ;
--   SELECT count(*) FROM player_follows ;
--   SELECT count(*) FROM kill_reactions ;
--   SELECT count(*) FROM kill_reports ;
--   SELECT * FROM v_player_fans_count LIMIT 5 ;
