-- ═══════════════════════════════════════════════════════════════════
-- 085 — Persisted emoji reactions (Vague 2, plan award-winning)
--
-- EmojiReactions (scroll V2 sidebar) shipped in Wave 23.1 as a
-- localStorage-only stub: every user saw only their own taps, the
-- documented "V16b server aggregation" was never delivered. This
-- migration is that follow-up.
--
-- Model: one row per (kill, emoji, identity) with an incrementing
-- count (TikTok-style repeated taps), where identity is either the
-- authenticated user_id or an anonymous fingerprint (hashed IP+UA,
-- computed server-side). Arbitrage produit 2026-07-05 : reactions are
-- open to anonymous visitors (social proof grows fast, low stakes) —
-- unlike competitive votes which bind to accounts.
--
-- Writes go EXCLUSIVELY through /api/kills/[id]/react with the
-- service role (pattern migration 083) — no public INSERT/UPDATE.
-- Public reads go through fn_kill_reaction_counts which exposes ONLY
-- (emoji, total): direct SELECT stays closed so fingerprints never
-- leak.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS kill_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id UUID REFERENCES kills(id) ON DELETE CASCADE NOT NULL,
    emoji TEXT NOT NULL CHECK (emoji IN ('🔥','👏','😂','😱','💀','🐐')),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    anon_fingerprint TEXT,
    -- Repeated taps accumulate per identity; the cap keeps a single
    -- identity from inflating a clip into absurdity.
    count INT NOT NULL DEFAULT 1 CHECK (count > 0 AND count <= 200),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    -- Exactly one identity kind per row.
    CHECK ((user_id IS NULL) <> (anon_fingerprint IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kill_reactions_user
    ON kill_reactions (kill_id, emoji, user_id)
    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_kill_reactions_anon
    ON kill_reactions (kill_id, emoji, anon_fingerprint)
    WHERE anon_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kill_reactions_kill
    ON kill_reactions (kill_id);

ALTER TABLE kill_reactions ENABLE ROW LEVEL SECURITY;
-- Deny-all for anon + authenticated: writes are service-role only,
-- reads go through the aggregate RPC below (fingerprints must never
-- be selectable).
CREATE POLICY "kill_reactions deny all" ON kill_reactions
    FOR ALL TO anon, authenticated
    USING (false) WITH CHECK (false);

-- ── Atomic increment (called by the API route as service_role) ──────
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
-- Service-role only — the API route is the single writer.
REVOKE EXECUTE ON FUNCTION fn_increment_kill_reaction_v2(UUID, TEXT, UUID, TEXT, INT)
    FROM PUBLIC, anon, authenticated;

-- ── Public aggregate read ────────────────────────────────────────────
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
