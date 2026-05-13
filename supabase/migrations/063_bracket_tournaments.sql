-- Migration 063 — Monthly Bracket Tournament
--
-- Single-elimination 64-clip bracket that runs every month. The top 64
-- KC kills published in the target month seed Round 1 (sorted by
-- avg_rating then highlight_score). 6 rounds : 32 → 16 → 8 → 4 → 2 → 1.
-- Each round opens for ~24h of community voting, so the bracket spans
-- roughly one week end-to-end.
--
-- The winner of the final match becomes "Goat du Mois" — pinned at the
-- top of /scroll and showcased on the homepage.
--
-- Conventions :
--   * SECURITY DEFINER RPCs with `SET search_path = public, pg_catalog`
--     (search-path hijack lock — migration 051).
--   * Public-write tables get NO direct INSERT policy — anon writes go
--     through SECURITY DEFINER RPCs only, so we can rate-limit + dedupe
--     server-side (same posture as vs_battles / face_off_votes).
--   * Seed + close-round are admin-only : EXECUTE GRANT scoped to
--     `service_role`, anon/authenticated can only SELECT + vote.
--   * Pair-normalised dedup via `UNIQUE (match_id, voter_session_hash)`.
--   * Idempotent : re-running the file is safe (CREATE … IF NOT EXISTS,
--     DROP FUNCTION IF EXISTS before each CREATE OR REPLACE).
--
-- Apply via the Supabase Management API :
--   curl -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
--        -H "Authorization: Bearer $SUPABASE_PAT" \
--        -H "Content-Type: application/json" \
--        --data-binary @<(jq -Rs '{query: .}' < 063_bracket_tournaments.sql)

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- bracket_tournaments — one row per monthly tournament
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bracket_tournaments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    /** Human-friendly slug for /bracket/[slug]. e.g. "mai-2026". */
    slug               TEXT UNIQUE NOT NULL,
    name               TEXT NOT NULL,
    start_date         DATE NOT NULL,
    end_date           DATE NOT NULL,
    status             TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'closed', 'archived')),
    /** Set when the bracket completes (final closes). */
    champion_kill_id   UUID REFERENCES kills(id) ON DELETE SET NULL,
    /** Generated cover image (worker uploads on completion). NULL until done. */
    poster_url         TEXT,
    /** 64 → 6 rounds. Kept open in case we ever ship a 32-bracket variant. */
    bracket_size       INT NOT NULL DEFAULT 64 CHECK (bracket_size IN (32, 64)),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT bracket_tournaments_date_order CHECK (end_date >= start_date),
    CONSTRAINT bracket_tournaments_slug_format CHECK (
        slug ~ '^[a-z0-9-]{3,40}$'
    )
);

CREATE INDEX IF NOT EXISTS idx_bracket_tournaments_status
    ON bracket_tournaments (status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_bracket_tournaments_start
    ON bracket_tournaments (start_date DESC);

ALTER TABLE bracket_tournaments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bracket_tournaments public read" ON bracket_tournaments;
CREATE POLICY "bracket_tournaments public read" ON bracket_tournaments
    FOR SELECT USING (TRUE);
-- No INSERT/UPDATE policy — admin via fn_seed_monthly_bracket / fn_close_round only.

COMMENT ON TABLE bracket_tournaments IS
    'Wave 30h : Monthly single-elimination bracket. 64 KC kills compete '
    'across 6 rounds. Winner = Goat du Mois. Writes via admin RPCs only.';

-- ═══════════════════════════════════════════════════════════════════════
-- bracket_matches — one row per head-to-head match in the bracket
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bracket_matches (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id    UUID NOT NULL REFERENCES bracket_tournaments(id) ON DELETE CASCADE,
    /** 1..6 (Round of 64 = 1, Final = 6) for a 64-bracket. */
    round            INT NOT NULL CHECK (round BETWEEN 1 AND 6),
    /** 0..31 (R1), 0..15 (R2), …, 0 (Final). Position within the round. */
    match_index      INT NOT NULL CHECK (match_index >= 0),
    /** Nullable until seeded — supports BYE handling on partial brackets. */
    kill_a_id        UUID REFERENCES kills(id) ON DELETE SET NULL,
    kill_b_id        UUID REFERENCES kills(id) ON DELETE SET NULL,
    votes_a          INT NOT NULL DEFAULT 0,
    votes_b          INT NOT NULL DEFAULT 0,
    /** Set when the round closes (computed by fn_close_round). */
    winner_kill_id   UUID REFERENCES kills(id) ON DELETE SET NULL,
    opens_at         TIMESTAMPTZ NOT NULL,
    closes_at        TIMESTAMPTZ NOT NULL,

    CONSTRAINT bracket_matches_window CHECK (closes_at > opens_at),
    CONSTRAINT bracket_matches_winner_in_pair CHECK (
        winner_kill_id IS NULL
        OR winner_kill_id = kill_a_id
        OR winner_kill_id = kill_b_id
    ),
    UNIQUE (tournament_id, round, match_index)
);

CREATE INDEX IF NOT EXISTS idx_bracket_matches_tournament
    ON bracket_matches (tournament_id, round, match_index);
CREATE INDEX IF NOT EXISTS idx_bracket_matches_open
    ON bracket_matches (opens_at, closes_at)
    WHERE winner_kill_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_bracket_matches_winner
    ON bracket_matches (winner_kill_id)
    WHERE winner_kill_id IS NOT NULL;

ALTER TABLE bracket_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bracket_matches public read" ON bracket_matches;
CREATE POLICY "bracket_matches public read" ON bracket_matches
    FOR SELECT USING (TRUE);

COMMENT ON TABLE bracket_matches IS
    'Wave 30h : One row per head-to-head match. votes_a/votes_b are kept '
    'in sync by fn_record_bracket_vote. winner_kill_id is computed at round '
    'close by fn_close_round.';

-- ═══════════════════════════════════════════════════════════════════════
-- bracket_votes — one row per cast vote (deduped per session per match)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bracket_votes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id           UUID NOT NULL REFERENCES bracket_matches(id) ON DELETE CASCADE,
    winner_kill_id     UUID NOT NULL REFERENCES kills(id),
    voter_user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    voter_session_hash TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT bracket_votes_session_len CHECK (
        length(voter_session_hash) >= 16
    ),
    UNIQUE (match_id, voter_session_hash)
);

CREATE INDEX IF NOT EXISTS idx_bracket_votes_match
    ON bracket_votes (match_id);
CREATE INDEX IF NOT EXISTS idx_bracket_votes_created
    ON bracket_votes (created_at DESC);

ALTER TABLE bracket_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bracket_votes public read" ON bracket_votes;
CREATE POLICY "bracket_votes public read" ON bracket_votes
    FOR SELECT USING (TRUE);
-- No INSERT policy — writes via fn_record_bracket_vote SECURITY DEFINER only.

COMMENT ON TABLE bracket_votes IS
    'Wave 30h : One vote per session per match. Dedup via UNIQUE '
    '(match_id, voter_session_hash). Writes via fn_record_bracket_vote.';

-- ═══════════════════════════════════════════════════════════════════════
-- fn_get_current_bracket — full active bracket payload for /bracket
-- ═══════════════════════════════════════════════════════════════════════
--
-- Returns a single-row table : tournament header + matches as a JSONB
-- array. Each match row carries both kill thumbnails / killer ign so the
-- client can render the entire tree without follow-up queries.

DROP FUNCTION IF EXISTS public.fn_get_current_bracket();
CREATE OR REPLACE FUNCTION public.fn_get_current_bracket()
RETURNS TABLE (
    tournament JSONB,
    matches    JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
    v_tournament JSONB;
    v_matches    JSONB;
    v_id         UUID;
BEGIN
    -- Pick the most recent open tournament. Fall back to the most recent
    -- closed one if no open tournament exists (so the page never 500s).
    SELECT id INTO v_id
        FROM bracket_tournaments
        WHERE status = 'open'
        ORDER BY start_date DESC
        LIMIT 1;

    IF v_id IS NULL THEN
        SELECT id INTO v_id
            FROM bracket_tournaments
            WHERE status IN ('closed', 'archived')
            ORDER BY start_date DESC
            LIMIT 1;
    END IF;

    IF v_id IS NULL THEN
        RETURN QUERY SELECT NULL::JSONB, '[]'::JSONB;
        RETURN;
    END IF;

    SELECT to_jsonb(t.*) INTO v_tournament
        FROM bracket_tournaments t
        WHERE t.id = v_id;

    SELECT COALESCE(jsonb_agg(row_to_jsonb(m) ORDER BY m.round, m.match_index), '[]'::jsonb)
        INTO v_matches
        FROM (
            SELECT
                bm.id,
                bm.round,
                bm.match_index,
                bm.kill_a_id,
                bm.kill_b_id,
                bm.votes_a,
                bm.votes_b,
                bm.winner_kill_id,
                bm.opens_at,
                bm.closes_at,
                -- Kill A snapshot
                ka.killer_champion       AS kill_a_killer_champion,
                ka.victim_champion       AS kill_a_victim_champion,
                pa.ign                   AS kill_a_killer_name,
                ka.thumbnail_url         AS kill_a_thumbnail,
                ka.clip_url_vertical     AS kill_a_clip_vertical,
                ka.clip_url_vertical_low AS kill_a_clip_vertical_low,
                ka.ai_description        AS kill_a_ai_description,
                ka.multi_kill            AS kill_a_multi_kill,
                ka.is_first_blood        AS kill_a_first_blood,
                ka.highlight_score       AS kill_a_highlight_score,
                ka.avg_rating            AS kill_a_avg_rating,
                -- Kill B snapshot
                kb.killer_champion       AS kill_b_killer_champion,
                kb.victim_champion       AS kill_b_victim_champion,
                pb.ign                   AS kill_b_killer_name,
                kb.thumbnail_url         AS kill_b_thumbnail,
                kb.clip_url_vertical     AS kill_b_clip_vertical,
                kb.clip_url_vertical_low AS kill_b_clip_vertical_low,
                kb.ai_description        AS kill_b_ai_description,
                kb.multi_kill            AS kill_b_multi_kill,
                kb.is_first_blood        AS kill_b_first_blood,
                kb.highlight_score       AS kill_b_highlight_score,
                kb.avg_rating            AS kill_b_avg_rating
            FROM bracket_matches bm
            LEFT JOIN kills   ka ON ka.id = bm.kill_a_id
            LEFT JOIN players pa ON pa.id = ka.killer_player_id
            LEFT JOIN kills   kb ON kb.id = bm.kill_b_id
            LEFT JOIN players pb ON pb.id = kb.killer_player_id
            WHERE bm.tournament_id = v_id
            ORDER BY bm.round, bm.match_index
        ) m;

    RETURN QUERY SELECT v_tournament, v_matches;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_current_bracket()
    TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- fn_get_bracket_by_slug — same shape as fn_get_current_bracket, by slug
-- ═══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.fn_get_bracket_by_slug(text);
CREATE OR REPLACE FUNCTION public.fn_get_bracket_by_slug(
    p_slug TEXT
)
RETURNS TABLE (
    tournament JSONB,
    matches    JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
    v_tournament JSONB;
    v_matches    JSONB;
    v_id         UUID;
BEGIN
    IF p_slug IS NULL OR length(trim(p_slug)) = 0 THEN
        RETURN QUERY SELECT NULL::JSONB, '[]'::JSONB;
        RETURN;
    END IF;

    SELECT id INTO v_id
        FROM bracket_tournaments
        WHERE slug = lower(trim(p_slug))
        LIMIT 1;

    IF v_id IS NULL THEN
        RETURN QUERY SELECT NULL::JSONB, '[]'::JSONB;
        RETURN;
    END IF;

    SELECT to_jsonb(t.*) INTO v_tournament
        FROM bracket_tournaments t
        WHERE t.id = v_id;

    SELECT COALESCE(jsonb_agg(row_to_jsonb(m) ORDER BY m.round, m.match_index), '[]'::jsonb)
        INTO v_matches
        FROM (
            SELECT
                bm.id,
                bm.round,
                bm.match_index,
                bm.kill_a_id,
                bm.kill_b_id,
                bm.votes_a,
                bm.votes_b,
                bm.winner_kill_id,
                bm.opens_at,
                bm.closes_at,
                ka.killer_champion       AS kill_a_killer_champion,
                ka.victim_champion       AS kill_a_victim_champion,
                pa.ign                   AS kill_a_killer_name,
                ka.thumbnail_url         AS kill_a_thumbnail,
                ka.clip_url_vertical     AS kill_a_clip_vertical,
                ka.clip_url_vertical_low AS kill_a_clip_vertical_low,
                ka.ai_description        AS kill_a_ai_description,
                ka.multi_kill            AS kill_a_multi_kill,
                ka.is_first_blood        AS kill_a_first_blood,
                ka.highlight_score       AS kill_a_highlight_score,
                ka.avg_rating            AS kill_a_avg_rating,
                kb.killer_champion       AS kill_b_killer_champion,
                kb.victim_champion       AS kill_b_victim_champion,
                pb.ign                   AS kill_b_killer_name,
                kb.thumbnail_url         AS kill_b_thumbnail,
                kb.clip_url_vertical     AS kill_b_clip_vertical,
                kb.clip_url_vertical_low AS kill_b_clip_vertical_low,
                kb.ai_description        AS kill_b_ai_description,
                kb.multi_kill            AS kill_b_multi_kill,
                kb.is_first_blood        AS kill_b_first_blood,
                kb.highlight_score       AS kill_b_highlight_score,
                kb.avg_rating            AS kill_b_avg_rating
            FROM bracket_matches bm
            LEFT JOIN kills   ka ON ka.id = bm.kill_a_id
            LEFT JOIN players pa ON pa.id = ka.killer_player_id
            LEFT JOIN kills   kb ON kb.id = bm.kill_b_id
            LEFT JOIN players pb ON pb.id = kb.killer_player_id
            WHERE bm.tournament_id = v_id
            ORDER BY bm.round, bm.match_index
        ) m;

    RETURN QUERY SELECT v_tournament, v_matches;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_bracket_by_slug(TEXT)
    TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- fn_record_bracket_vote — idempotent vote + tally update
-- ═══════════════════════════════════════════════════════════════════════
--
-- Validates :
--   * match exists + voting window is open (NOW() BETWEEN opens_at AND closes_at)
--   * winner_kill_id matches kill_a_id OR kill_b_id of the match
--   * winner is not yet decided (match.winner_kill_id IS NULL)
--   * session hash >= 16 chars
--
-- On UNIQUE (match_id, voter_session_hash) collision : no-op + return
-- current tallies (idempotent retry).

DROP FUNCTION IF EXISTS public.fn_record_bracket_vote(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.fn_record_bracket_vote(
    p_match_id     UUID,
    p_winner_kill_id UUID,
    p_session_hash TEXT
)
RETURNS TABLE (
    votes_a   INT,
    votes_b   INT,
    inserted  BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_match       bracket_matches%ROWTYPE;
    v_inserted    BOOLEAN := FALSE;
    v_now         TIMESTAMPTZ := now();
    v_votes_a     INT := 0;
    v_votes_b     INT := 0;
BEGIN
    IF p_match_id IS NULL THEN
        RAISE EXCEPTION 'fn_record_bracket_vote: match_id required';
    END IF;
    IF p_winner_kill_id IS NULL THEN
        RAISE EXCEPTION 'fn_record_bracket_vote: winner_kill_id required';
    END IF;
    IF p_session_hash IS NULL OR length(p_session_hash) < 16 THEN
        RAISE EXCEPTION 'fn_record_bracket_vote: session_hash must be >= 16 chars';
    END IF;

    SELECT * INTO v_match
        FROM bracket_matches
        WHERE id = p_match_id
        FOR UPDATE;

    IF v_match.id IS NULL THEN
        RAISE EXCEPTION 'fn_record_bracket_vote: match % not found', p_match_id;
    END IF;

    IF v_match.winner_kill_id IS NOT NULL THEN
        -- Round already closed — return current state (idempotent read).
        RETURN QUERY SELECT v_match.votes_a, v_match.votes_b, FALSE;
        RETURN;
    END IF;

    IF v_match.opens_at > v_now THEN
        RAISE EXCEPTION 'fn_record_bracket_vote: voting not yet open (opens at %)', v_match.opens_at
            USING ERRCODE = 'P0001';
    END IF;
    IF v_match.closes_at < v_now THEN
        RAISE EXCEPTION 'fn_record_bracket_vote: voting window closed (closed at %)', v_match.closes_at
            USING ERRCODE = 'P0001';
    END IF;

    IF v_match.kill_a_id IS NULL OR v_match.kill_b_id IS NULL THEN
        RAISE EXCEPTION 'fn_record_bracket_vote: match not seeded (BYE)';
    END IF;

    IF p_winner_kill_id <> v_match.kill_a_id
       AND p_winner_kill_id <> v_match.kill_b_id THEN
        RAISE EXCEPTION 'fn_record_bracket_vote: winner must be kill_a or kill_b of match';
    END IF;

    -- Insert. UNIQUE collision = same session has already voted on this
    -- match — swallow and fall through to the read path.
    BEGIN
        INSERT INTO bracket_votes (
            match_id, winner_kill_id, voter_user_id, voter_session_hash
        ) VALUES (
            p_match_id, p_winner_kill_id, auth.uid(), p_session_hash
        );
        v_inserted := TRUE;
    EXCEPTION WHEN unique_violation THEN
        v_inserted := FALSE;
    END;

    IF v_inserted THEN
        IF p_winner_kill_id = v_match.kill_a_id THEN
            UPDATE bracket_matches
                SET votes_a = votes_a + 1
                WHERE id = p_match_id
                RETURNING votes_a, votes_b INTO v_votes_a, v_votes_b;
        ELSE
            UPDATE bracket_matches
                SET votes_b = votes_b + 1
                WHERE id = p_match_id
                RETURNING votes_a, votes_b INTO v_votes_a, v_votes_b;
        END IF;
    ELSE
        SELECT m.votes_a, m.votes_b INTO v_votes_a, v_votes_b
            FROM bracket_matches m
            WHERE m.id = p_match_id;
    END IF;

    RETURN QUERY SELECT v_votes_a, v_votes_b, v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_record_bracket_vote(UUID, UUID, TEXT)
    TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- fn_seed_monthly_bracket — admin-only : create the tournament + R1 seed
-- ═══════════════════════════════════════════════════════════════════════
--
-- p_month_year format : "YYYY-MM" (e.g. "2026-05" → "Mai 2026").
--
-- Pulls the top 64 kills published in the target calendar month, ordered
-- by avg_rating DESC NULLS LAST, then highlight_score DESC NULLS LAST,
-- then created_at DESC. If fewer than 64 qualify, the bracket downsizes
-- to the next power of 2 (32 / 16 / 8). The slug is the month-year in
-- French, lowercased, dash-separated ("mai-2026").
--
-- Schedules a 24h voting window per round, starting at the next 00:00 UTC
-- after the call. So a typical 64-bracket spans 6 days end-to-end.

DROP FUNCTION IF EXISTS public.fn_seed_monthly_bracket(text);
CREATE OR REPLACE FUNCTION public.fn_seed_monthly_bracket(
    p_month_year TEXT
)
RETURNS TABLE (
    tournament_id UUID,
    slug          TEXT,
    name          TEXT,
    bracket_size  INT,
    seeded_kills  INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_year        INT;
    v_month       INT;
    v_start       DATE;
    v_end         DATE;
    v_slug        TEXT;
    v_name        TEXT;
    v_tid         UUID;
    v_kill_ids    UUID[];
    v_count       INT;
    v_size        INT;
    v_rounds      INT;
    v_round_open  TIMESTAMPTZ;
    v_round_close TIMESTAMPTZ;
    v_round       INT;
    v_pair_count  INT;
    v_idx         INT;
    v_french_month TEXT;
BEGIN
    -- Parse p_month_year ("YYYY-MM").
    IF p_month_year IS NULL OR p_month_year !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'fn_seed_monthly_bracket: p_month_year must be YYYY-MM (got %)', p_month_year;
    END IF;
    v_year  := split_part(p_month_year, '-', 1)::INT;
    v_month := split_part(p_month_year, '-', 2)::INT;
    v_start := make_date(v_year, v_month, 1);
    v_end   := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

    -- French month name for the public slug + headline.
    v_french_month := CASE v_month
        WHEN  1 THEN 'janvier'
        WHEN  2 THEN 'fevrier'
        WHEN  3 THEN 'mars'
        WHEN  4 THEN 'avril'
        WHEN  5 THEN 'mai'
        WHEN  6 THEN 'juin'
        WHEN  7 THEN 'juillet'
        WHEN  8 THEN 'aout'
        WHEN  9 THEN 'septembre'
        WHEN 10 THEN 'octobre'
        WHEN 11 THEN 'novembre'
        WHEN 12 THEN 'decembre'
        ELSE 'mois-' || v_month::TEXT
    END;
    v_slug := v_french_month || '-' || v_year::TEXT;
    v_name := 'Tournoi du Mois — ' ||
              initcap(v_french_month) || ' ' || v_year::TEXT;

    -- If a tournament already exists for this slug, return it (idempotent).
    SELECT id INTO v_tid FROM bracket_tournaments WHERE slug = v_slug;
    IF v_tid IS NOT NULL THEN
        RETURN QUERY
            SELECT t.id, t.slug, t.name, t.bracket_size,
                   (SELECT COUNT(*)::INT FROM bracket_matches WHERE tournament_id = t.id AND round = 1)
            FROM bracket_tournaments t WHERE t.id = v_tid;
        RETURN;
    END IF;

    -- Pull top 64 published KC kills in the month.
    SELECT array_agg(id ORDER BY ord)
        INTO v_kill_ids
        FROM (
            SELECT k.id,
                   ROW_NUMBER() OVER (
                       ORDER BY
                           COALESCE(k.avg_rating, 0)      DESC,
                           COALESCE(k.highlight_score, 0) DESC,
                           k.created_at                   DESC
                   ) AS ord
            FROM kills k
            WHERE k.status = 'published'
              AND k.kill_visible = TRUE
              AND k.clip_url_vertical IS NOT NULL
              AND k.thumbnail_url IS NOT NULL
              AND k.tracked_team_involvement = 'team_killer'
              AND k.created_at >= v_start::TIMESTAMPTZ
              AND k.created_at <  (v_end + INTERVAL '1 day')::TIMESTAMPTZ
            ORDER BY
                COALESCE(k.avg_rating, 0)      DESC,
                COALESCE(k.highlight_score, 0) DESC,
                k.created_at                   DESC
            LIMIT 64
        ) s;

    v_count := COALESCE(array_length(v_kill_ids, 1), 0);
    IF v_count < 4 THEN
        RAISE EXCEPTION 'fn_seed_monthly_bracket: not enough kills (% found, need >=4)', v_count;
    END IF;

    -- Round down to nearest power of 2 (4, 8, 16, 32, 64).
    v_size := CASE
        WHEN v_count >= 64 THEN 64
        WHEN v_count >= 32 THEN 32
        WHEN v_count >= 16 THEN 16
        WHEN v_count >=  8 THEN  8
        ELSE 4
    END;
    -- Trim to bracket size.
    v_kill_ids := v_kill_ids[1:v_size];
    v_rounds := CASE v_size
        WHEN 64 THEN 6
        WHEN 32 THEN 5
        WHEN 16 THEN 4
        WHEN  8 THEN 3
        ELSE 2
    END;

    -- Create tournament.
    INSERT INTO bracket_tournaments (slug, name, start_date, end_date, bracket_size, status)
        VALUES (v_slug, v_name, CURRENT_DATE, CURRENT_DATE + (v_rounds * INTERVAL '1 day')::INTERVAL,
                v_size, 'open')
        RETURNING id INTO v_tid;

    -- Schedule the rounds. Round 1 opens at the next 00:00 UTC after now ;
    -- each subsequent round opens 24h later.
    v_round_open  := date_trunc('day', now() AT TIME ZONE 'UTC') + INTERVAL '1 day';
    v_round_close := v_round_open + INTERVAL '24 hours';

    FOR v_round IN 1..v_rounds LOOP
        v_pair_count := v_size / (2 ^ v_round)::INT;  -- 32, 16, 8, 4, 2, 1
        FOR v_idx IN 0..(v_pair_count - 1) LOOP
            INSERT INTO bracket_matches (
                tournament_id, round, match_index,
                kill_a_id, kill_b_id,
                opens_at, closes_at
            ) VALUES (
                v_tid, v_round, v_idx,
                CASE WHEN v_round = 1 THEN v_kill_ids[v_idx * 2 + 1] ELSE NULL END,
                CASE WHEN v_round = 1 THEN v_kill_ids[v_idx * 2 + 2] ELSE NULL END,
                v_round_open, v_round_close
            );
        END LOOP;
        v_round_open  := v_round_open + INTERVAL '24 hours';
        v_round_close := v_round_close + INTERVAL '24 hours';
    END LOOP;

    RETURN QUERY
        SELECT t.id, t.slug, t.name, t.bracket_size, v_size
        FROM bracket_tournaments t WHERE t.id = v_tid;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_seed_monthly_bracket(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_seed_monthly_bracket(TEXT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- fn_close_round — admin-only : pick winners + advance to round + 1
-- ═══════════════════════════════════════════════════════════════════════
--
-- For each undecided match in (tournament_id, round) :
--   * winner = whoever has more votes (votes_a > votes_b → kill_a wins,
--     votes_b > votes_a → kill_b wins, tie → kill_a wins by index — V0
--     deterministic tiebreaker, can be revisited)
--   * if a slot in round+1 exists, write the winner into it (slot index =
--     floor(match_index / 2), side = match_index % 2 == 0 ? a : b)
--   * if round is the final, set tournament.champion_kill_id + status='closed'

DROP FUNCTION IF EXISTS public.fn_close_round(uuid, int);
CREATE OR REPLACE FUNCTION public.fn_close_round(
    p_tournament_id UUID,
    p_round         INT
)
RETURNS TABLE (
    closed_matches   INT,
    next_round       INT,
    champion_kill_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_size      INT;
    v_rounds    INT;
    v_closed    INT := 0;
    v_next      INT;
    v_champion  UUID;
    v_match     RECORD;
    v_winner    UUID;
    v_slot_idx  INT;
    v_slot_side INT;
BEGIN
    IF p_tournament_id IS NULL THEN
        RAISE EXCEPTION 'fn_close_round: tournament_id required';
    END IF;
    IF p_round IS NULL OR p_round < 1 OR p_round > 6 THEN
        RAISE EXCEPTION 'fn_close_round: round must be 1..6 (got %)', p_round;
    END IF;

    SELECT bracket_size INTO v_size
        FROM bracket_tournaments WHERE id = p_tournament_id;
    IF v_size IS NULL THEN
        RAISE EXCEPTION 'fn_close_round: tournament % not found', p_tournament_id;
    END IF;

    v_rounds := CASE v_size
        WHEN 64 THEN 6
        WHEN 32 THEN 5
        WHEN 16 THEN 4
        WHEN  8 THEN 3
        ELSE 2
    END;

    -- Walk every undecided match in this round.
    FOR v_match IN
        SELECT * FROM bracket_matches
        WHERE tournament_id = p_tournament_id
          AND round = p_round
          AND winner_kill_id IS NULL
        ORDER BY match_index
    LOOP
        -- BYE handling : if only one side is seeded, that side wins by default.
        IF v_match.kill_a_id IS NOT NULL AND v_match.kill_b_id IS NULL THEN
            v_winner := v_match.kill_a_id;
        ELSIF v_match.kill_b_id IS NOT NULL AND v_match.kill_a_id IS NULL THEN
            v_winner := v_match.kill_b_id;
        ELSIF v_match.kill_a_id IS NULL AND v_match.kill_b_id IS NULL THEN
            -- Empty slot — skip (this shouldn't happen in a well-seeded bracket).
            CONTINUE;
        ELSIF v_match.votes_b > v_match.votes_a THEN
            v_winner := v_match.kill_b_id;
        ELSE
            -- ties + votes_a > votes_b → kill_a wins
            v_winner := v_match.kill_a_id;
        END IF;

        UPDATE bracket_matches
            SET winner_kill_id = v_winner
            WHERE id = v_match.id;
        v_closed := v_closed + 1;

        -- Advance to round + 1 if one exists.
        IF p_round < v_rounds THEN
            v_slot_idx  := v_match.match_index / 2;  -- integer division
            v_slot_side := v_match.match_index % 2;
            IF v_slot_side = 0 THEN
                UPDATE bracket_matches
                    SET kill_a_id = v_winner
                    WHERE tournament_id = p_tournament_id
                      AND round = p_round + 1
                      AND match_index = v_slot_idx;
            ELSE
                UPDATE bracket_matches
                    SET kill_b_id = v_winner
                    WHERE tournament_id = p_tournament_id
                      AND round = p_round + 1
                      AND match_index = v_slot_idx;
            END IF;
        ELSE
            -- Final round closed — winner = champion.
            v_champion := v_winner;
        END IF;
    END LOOP;

    -- If we just closed the final round, mark the tournament closed.
    IF p_round = v_rounds AND v_champion IS NOT NULL THEN
        UPDATE bracket_tournaments
            SET status = 'closed',
                champion_kill_id = v_champion
            WHERE id = p_tournament_id;
    END IF;

    v_next := CASE WHEN p_round < v_rounds THEN p_round + 1 ELSE NULL END;
    RETURN QUERY SELECT v_closed, v_next, v_champion;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_close_round(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_close_round(UUID, INT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- fn_get_past_winners — list of past tournament champions
-- ═══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.fn_get_past_winners(int);
CREATE OR REPLACE FUNCTION public.fn_get_past_winners(
    p_limit INT DEFAULT 12
)
RETURNS TABLE (
    tournament_id      UUID,
    slug               TEXT,
    name               TEXT,
    start_date         DATE,
    end_date           DATE,
    status             TEXT,
    poster_url         TEXT,
    bracket_size       INT,
    champion_kill_id   UUID,
    champion_killer_champion TEXT,
    champion_victim_champion TEXT,
    champion_killer_name     TEXT,
    champion_thumbnail TEXT,
    champion_multi_kill TEXT,
    champion_first_blood BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.slug,
        t.name,
        t.start_date,
        t.end_date,
        t.status,
        t.poster_url,
        t.bracket_size,
        t.champion_kill_id,
        k.killer_champion,
        k.victim_champion,
        p.ign,
        k.thumbnail_url,
        k.multi_kill,
        k.is_first_blood
    FROM bracket_tournaments t
    LEFT JOIN kills   k ON k.id = t.champion_kill_id
    LEFT JOIN players p ON p.id = k.killer_player_id
    WHERE t.status IN ('closed', 'archived')
    ORDER BY t.start_date DESC
    LIMIT GREATEST(1, LEAST(p_limit, 60));
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_past_winners(INT)
    TO anon, authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- Smoke tests (run AFTER apply, AS service_role)
-- ═══════════════════════════════════════════════════════════════════════
--
-- SELECT * FROM fn_seed_monthly_bracket('2026-04');   -- seeds previous month
-- SELECT * FROM fn_get_current_bracket();
-- SELECT * FROM fn_get_past_winners(10);
--
-- Round-close walk (admin op) :
-- SELECT * FROM fn_close_round(
--     (SELECT id FROM bracket_tournaments WHERE slug = 'avril-2026'),
--     1
-- );
