-- ═══════════════════════════════════════════════════════════════════
-- 086 — Account-level vote dedup (Vague 2, arbitrage « hybride »)
--
-- The three community vote systems (VS roulette, bracket, quote
-- upvotes) deduped by localStorage session-hash only: clearing the
-- browser storage granted unlimited re-votes, making the ELO
-- leaderboard and brackets stuffable. The RPCs for VS (059) and
-- bracket (063) ALREADY record auth.uid() into voter_user_id and
-- swallow unique_violation gracefully — so account-level dedup is
-- pure DDL for those two: a partial unique index per (target, user).
-- Anonymous voting keeps working exactly as before (session-hash
-- path untouched).
--
-- Quote upvotes (065) never captured the account — the dedup log
-- gains a user_id column and fn_record_quote_upvote is redefined to
-- write auth.uid() and treat EITHER unique collision (session or
-- account) as already_voted.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ── VS roulette : one vote per account per pair, across devices ─────
CREATE UNIQUE INDEX IF NOT EXISTS uq_vs_battles_user_pair
    ON vs_battles (kill_a_id, kill_b_id, voter_user_id)
    WHERE voter_user_id IS NOT NULL;

-- ── Bracket : one vote per account per match ────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_bracket_votes_user_match
    ON bracket_votes (match_id, voter_user_id)
    WHERE voter_user_id IS NOT NULL;

-- ── Quote upvotes : capture the account + dedup on it ───────────────
ALTER TABLE kill_quote_upvote_log
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_upvote_user
    ON kill_quote_upvote_log (quote_id, user_id)
    WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_record_quote_upvote(
    p_quote_id     UUID,
    p_session_hash TEXT
)
RETURNS TABLE (
    upvotes  INT,
    already_voted BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
VOLATILE
AS $$
DECLARE
    v_inserted BOOLEAN := FALSE;
    v_count    INT;
BEGIN
    -- Refuse degenerate hashes outright (same guard as 065).
    IF p_session_hash IS NULL OR length(p_session_hash) < 8 THEN
        SELECT q.upvotes INTO v_count FROM kill_quotes q WHERE q.id = p_quote_id;
        RETURN QUERY SELECT COALESCE(v_count, 0), TRUE;
        RETURN;
    END IF;

    -- 086 : the insert now records auth.uid() and can collide on TWO
    -- unique constraints (session PK, account partial index) — an
    -- exception block replaces 065's targeted ON CONFLICT, treating
    -- either collision as "already voted".
    BEGIN
        INSERT INTO kill_quote_upvote_log (quote_id, session_hash, user_id)
        VALUES (p_quote_id, p_session_hash, auth.uid());
        v_inserted := TRUE;
    EXCEPTION WHEN unique_violation THEN
        v_inserted := FALSE;
    END;

    IF v_inserted THEN
        UPDATE kill_quotes
        SET upvotes = upvotes + 1
        WHERE id = p_quote_id
        RETURNING kill_quotes.upvotes INTO v_count;
        RETURN QUERY SELECT COALESCE(v_count, 0), FALSE;
    ELSE
        SELECT q.upvotes INTO v_count FROM kill_quotes q WHERE q.id = p_quote_id;
        RETURN QUERY SELECT COALESCE(v_count, 0), TRUE;
    END IF;
END;
$$;

COMMIT;
