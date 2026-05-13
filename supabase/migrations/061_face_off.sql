-- Migration 061 — Player vs Player Face-Off
--
-- Settles "qui est le meilleur ADC KC ?" debates. /face-off ships a
-- side-by-side comparison of two players (current roster vs alumni, or
-- alumni vs alumni). The community vote on this page is independent of
-- the per-kill ELO that vs_battles tracks (migration 059) — we just
-- count "who's stronger overall" votes per ordered player pair.
--
-- Conventions :
--   * SECURITY DEFINER RPCs with `SET search_path = public, pg_catalog`
--     (search-path hijack lock, see migration 051).
--   * Anon writes go through the RPC only — no INSERT policy on the
--     raw table so we can dedupe + rate-limit server-side.
--   * Pair ordering is normalised inside the RPC so (a,b) and (b,a)
--     collapse to the same row group. Caller can send the player slugs
--     in either order ; the SQL flips them before any read or write.
--   * Slugs are stored case-insensitive (LOWER()).
--   * Idempotent : re-running the file is safe.
--
-- Apply via the Supabase Management API :
--   curl -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
--        -H "Authorization: Bearer $SUPABASE_PAT" \
--        -H "Content-Type: application/json" \
--        --data-binary @<(jq -Rs '{query: .}' < 061_face_off.sql)

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- face_off_votes — one row per cast vote, deduped by session per pair
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS face_off_votes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    /** Always stored with player_a_slug < player_b_slug (case-insensitive,
     *  Unicode-sensitive sort) so "Caliste vs Hans" and "Hans vs Caliste"
     *  resolve to the same ordered pair. */
    player_a_slug      TEXT NOT NULL,
    player_b_slug      TEXT NOT NULL,
    /** NULL = tie / abstain ; otherwise must equal a or b after normalisation. */
    winner_slug        TEXT,
    /** NULL for anon ; filled when caller is authenticated. */
    voter_user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    /** SHA-256 / random hex of the client session id (>= 16 chars). One
     *  vote per session per ordered pair. */
    voter_session_hash TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT face_off_votes_ordered_pair CHECK (
        player_a_slug < player_b_slug
    ),
    CONSTRAINT face_off_votes_winner_in_pair CHECK (
        winner_slug IS NULL
        OR winner_slug = player_a_slug
        OR winner_slug = player_b_slug
    ),
    CONSTRAINT face_off_votes_session_len CHECK (
        length(voter_session_hash) >= 16
    ),
    UNIQUE (player_a_slug, player_b_slug, voter_session_hash)
);

CREATE INDEX IF NOT EXISTS idx_face_off_votes_pair
    ON face_off_votes (player_a_slug, player_b_slug);
CREATE INDEX IF NOT EXISTS idx_face_off_votes_created
    ON face_off_votes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_face_off_votes_winner
    ON face_off_votes (winner_slug)
    WHERE winner_slug IS NOT NULL;

ALTER TABLE face_off_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "face_off_votes public read" ON face_off_votes;
CREATE POLICY "face_off_votes public read" ON face_off_votes
    FOR SELECT USING (TRUE);
-- No INSERT policy — writes via fn_record_face_off_vote SECURITY DEFINER.

COMMENT ON TABLE face_off_votes IS
    'Migration 061 : Player vs Player Face-Off community votes. Ordered '
    'pairs (a < b). Writes via fn_record_face_off_vote only. Public read.';

-- ═══════════════════════════════════════════════════════════════════════
-- fn_record_face_off_vote — idempotent vote + tally
-- ═══════════════════════════════════════════════════════════════════════
--
-- Normalises pair ordering before INSERT so (a,b) and (b,a) collide on
-- the UNIQUE (player_a_slug, player_b_slug, voter_session_hash). On
-- collision we no-op and just return the current tallies — retried
-- POSTs from a flaky network won't double-count.
--
-- Returns votes_a / votes_b / votes_draw normalised back to the order
-- the CALLER sent (so the client UI doesn't need to know about the
-- internal swap).

DROP FUNCTION IF EXISTS public.fn_record_face_off_vote(text, text, text, text);
CREATE OR REPLACE FUNCTION public.fn_record_face_off_vote(
    p_a_slug       TEXT,
    p_b_slug       TEXT,
    p_winner_slug  TEXT,
    p_session_hash TEXT
)
RETURNS TABLE (
    votes_a     INT,
    votes_b     INT,
    votes_draw  INT,
    inserted    BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    norm_a       TEXT;
    norm_b       TEXT;
    norm_winner  TEXT;
    swapped      BOOLEAN := FALSE;
    v_inserted   BOOLEAN := FALSE;
    v_votes_a    INT := 0;   -- after-swap a count
    v_votes_b    INT := 0;   -- after-swap b count
    v_votes_draw INT := 0;
BEGIN
    -- Argument validation
    IF p_a_slug IS NULL OR length(trim(p_a_slug)) = 0 THEN
        RAISE EXCEPTION 'fn_record_face_off_vote: p_a_slug required';
    END IF;
    IF p_b_slug IS NULL OR length(trim(p_b_slug)) = 0 THEN
        RAISE EXCEPTION 'fn_record_face_off_vote: p_b_slug required';
    END IF;
    IF p_session_hash IS NULL OR length(p_session_hash) < 16 THEN
        RAISE EXCEPTION 'fn_record_face_off_vote: session_hash must be >= 16 chars';
    END IF;

    -- Lowercase + trim slugs for stable storage / lookup.
    norm_a := lower(trim(p_a_slug));
    norm_b := lower(trim(p_b_slug));
    norm_winner := CASE WHEN p_winner_slug IS NULL THEN NULL
                        ELSE lower(trim(p_winner_slug)) END;

    IF norm_a = norm_b THEN
        RAISE EXCEPTION 'fn_record_face_off_vote: a and b must differ';
    END IF;

    -- Winner must be a, b, or NULL (tie).
    IF norm_winner IS NOT NULL
       AND norm_winner <> norm_a
       AND norm_winner <> norm_b THEN
        RAISE EXCEPTION 'fn_record_face_off_vote: winner must be a, b, or NULL';
    END IF;

    -- Normalise ordering so (a,b) and (b,a) collapse into the same row.
    IF norm_a > norm_b THEN
        DECLARE
            tmp TEXT := norm_a;
        BEGIN
            norm_a := norm_b;
            norm_b := tmp;
            swapped := TRUE;
        END;
    END IF;

    -- Insert. UNIQUE collision = same session has already voted on this
    -- pair — swallow silently and fall through to the tally read.
    BEGIN
        INSERT INTO face_off_votes (
            player_a_slug, player_b_slug, winner_slug,
            voter_user_id, voter_session_hash
        ) VALUES (
            norm_a, norm_b, norm_winner,
            auth.uid(), p_session_hash
        );
        v_inserted := TRUE;
    EXCEPTION WHEN unique_violation THEN
        v_inserted := FALSE;
    END;

    -- Tally. Done as a single grouped scan over the pair — cheap because
    -- of idx_face_off_votes_pair.
    SELECT
        COUNT(*) FILTER (WHERE winner_slug = norm_a),
        COUNT(*) FILTER (WHERE winner_slug = norm_b),
        COUNT(*) FILTER (WHERE winner_slug IS NULL)
    INTO v_votes_a, v_votes_b, v_votes_draw
    FROM face_off_votes
    WHERE player_a_slug = norm_a
      AND player_b_slug = norm_b;

    -- If we swapped, the caller's "a" is actually our stored "b". Flip
    -- the columns back so the response always matches the caller's
    -- input order.
    IF swapped THEN
        RETURN QUERY SELECT v_votes_b, v_votes_a, v_votes_draw, v_inserted;
    ELSE
        RETURN QUERY SELECT v_votes_a, v_votes_b, v_votes_draw, v_inserted;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_record_face_off_vote(TEXT, TEXT, TEXT, TEXT)
    TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- fn_get_face_off_tally — read-only tally for an (a,b) pair
-- ═══════════════════════════════════════════════════════════════════════
--
-- Lets the client read the current vote counts on page load WITHOUT
-- casting a vote first. Same normalisation + swap-back behaviour as
-- fn_record_face_off_vote.

DROP FUNCTION IF EXISTS public.fn_get_face_off_tally(text, text);
CREATE OR REPLACE FUNCTION public.fn_get_face_off_tally(
    p_a_slug TEXT,
    p_b_slug TEXT
)
RETURNS TABLE (
    votes_a    INT,
    votes_b    INT,
    votes_draw INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
    norm_a   TEXT;
    norm_b   TEXT;
    swapped  BOOLEAN := FALSE;
    a_count  INT := 0;
    b_count  INT := 0;
    d_count  INT := 0;
BEGIN
    IF p_a_slug IS NULL OR p_b_slug IS NULL THEN
        RETURN QUERY SELECT 0, 0, 0;
        RETURN;
    END IF;

    norm_a := lower(trim(p_a_slug));
    norm_b := lower(trim(p_b_slug));

    IF norm_a = norm_b THEN
        RETURN QUERY SELECT 0, 0, 0;
        RETURN;
    END IF;

    IF norm_a > norm_b THEN
        DECLARE
            tmp TEXT := norm_a;
        BEGIN
            norm_a := norm_b;
            norm_b := tmp;
            swapped := TRUE;
        END;
    END IF;

    SELECT
        COUNT(*) FILTER (WHERE winner_slug = norm_a),
        COUNT(*) FILTER (WHERE winner_slug = norm_b),
        COUNT(*) FILTER (WHERE winner_slug IS NULL)
    INTO a_count, b_count, d_count
    FROM face_off_votes
    WHERE player_a_slug = norm_a
      AND player_b_slug = norm_b;

    IF swapped THEN
        RETURN QUERY SELECT b_count, a_count, d_count;
    ELSE
        RETURN QUERY SELECT a_count, b_count, d_count;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_face_off_tally(TEXT, TEXT)
    TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- fn_top_face_off_duels — leaderboard of most-voted-on duels
-- ═══════════════════════════════════════════════════════════════════════
--
-- Powers the "Duels populaires" footer on /face-off. Returns the
-- top-N most-engaged pairs (by total vote count) along with the
-- per-side tallies so the UI can render a small standings card.

DROP FUNCTION IF EXISTS public.fn_top_face_off_duels(int);
CREATE OR REPLACE FUNCTION public.fn_top_face_off_duels(
    p_limit INT DEFAULT 5
)
RETURNS TABLE (
    player_a_slug TEXT,
    player_b_slug TEXT,
    votes_a       INT,
    votes_b       INT,
    votes_draw    INT,
    total_votes   INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.player_a_slug,
        v.player_b_slug,
        SUM((v.winner_slug = v.player_a_slug)::INT)::INT AS votes_a,
        SUM((v.winner_slug = v.player_b_slug)::INT)::INT AS votes_b,
        SUM((v.winner_slug IS NULL)::INT)::INT           AS votes_draw,
        COUNT(*)::INT                                    AS total_votes
    FROM face_off_votes v
    GROUP BY v.player_a_slug, v.player_b_slug
    ORDER BY total_votes DESC, MAX(v.created_at) DESC
    LIMIT GREATEST(1, LEAST(p_limit, 50));
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_top_face_off_duels(INT)
    TO anon, authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- Smoke tests
-- ═══════════════════════════════════════════════════════════════════════
--
-- SELECT * FROM fn_record_face_off_vote(
--     'caliste', 'hans-sama', 'caliste',
--     'face-off-test-session-1234567890ab'
-- );
-- SELECT * FROM fn_get_face_off_tally('hans-sama', 'caliste');
-- SELECT * FROM fn_top_face_off_duels(10);
