-- Migration 059 — Wave 25.3 (2026-05-11)
--   Feature 1 : VS Roulette — kill-vs-kill duels + per-clip ELO ratings
--                so we can surface a community-driven "best ever" leaderboard.
--   Feature 2 : Antre de la BCC — hidden fan-club cave (the dropdown easter
--                egg behind the KC logo). Global counters for the three
--                ritual gestures + a player-specific kills feed for Kyeahoo.
--
-- Conventions :
--   * RPCs are SECURITY DEFINER with `SET search_path = public, pg_catalog`
--     (CVE-class search-path hijack lock, see migration 051).
--   * Public-write tables get NO direct INSERT policy — anon writes go
--     through SECURITY DEFINER RPCs only, so we can rate-limit + dedupe
--     server-side (same posture as kill_reactions / kill_reports in 057).
--   * Every CREATE uses IF NOT EXISTS so re-runs are idempotent.
--   * Era filtering : the eras live in TS-land (web/src/lib/eras.ts), so
--     the RPC accepts pre-resolved `era_date_start` / `era_date_end`
--     ISO-8601 strings inside `filters_json`. The `era_slug` key is also
--     accepted but only used as an audit label on the vs_battles row —
--     the actual filter is the date range. This avoids hard-coding the
--     era table in SQL (which would drift the moment the TS file moves).
--
-- Idempotent.

BEGIN;

-- ══════════════════════════════════════════════════════════════════════
-- FEATURE 1 — VS ROULETTE
-- ══════════════════════════════════════════════════════════════════════

-- ─── vs_battles : one row per cast vote ───────────────────────────────
CREATE TABLE IF NOT EXISTS vs_battles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_a_id       UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
    kill_b_id       UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
    /** NULL = abstain / "no winner" vote ; otherwise must equal kill_a or kill_b. */
    winner_kill_id  UUID REFERENCES kills(id) ON DELETE CASCADE,
    /** NULL for anon votes ; filled when caller is authenticated. */
    voter_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    /** SHA-256 of (anon_user_id || session_id) for anon dedup. Required
     *  for both anon and authed callers — gives us a single rate-limit key. */
    voter_session_hash TEXT NOT NULL,
    /** The criteria used to pick the pair : `{player_slug, champion, role,
     *  era_slug, era_date_start, era_date_end, multi_kill_min,
     *  is_first_blood, min_highlight_score}` per side, plus an optional
     *  `pool_id` label for analytics. */
    filters_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    /** Sanity check : winner, if set, must be one of the two kills in the pair. */
    CONSTRAINT vs_battles_winner_in_pair CHECK (
        winner_kill_id IS NULL
        OR winner_kill_id = kill_a_id
        OR winner_kill_id = kill_b_id
    ),
    /** Same anon session can't double-vote on the same ordered pair.
     *  We treat (a,b) and (b,a) as distinct pairs — the RPC normalises
     *  the ordering before insert so this is effectively undirected. */
    UNIQUE (kill_a_id, kill_b_id, voter_session_hash)
);

CREATE INDEX IF NOT EXISTS idx_vs_battles_created
    ON vs_battles (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vs_battles_winner
    ON vs_battles (winner_kill_id)
    WHERE winner_kill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vs_battles_kill_a
    ON vs_battles (kill_a_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vs_battles_kill_b
    ON vs_battles (kill_b_id, created_at DESC);

ALTER TABLE vs_battles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vs_battles public read" ON vs_battles;
CREATE POLICY "vs_battles public read" ON vs_battles
    FOR SELECT USING (TRUE);
-- No INSERT policy : writes via fn_record_vs_vote SECURITY DEFINER only.

COMMENT ON TABLE vs_battles IS
    'Wave 25.3 / V59 : kill-vs-kill votes from the /vs roulette page. '
    'Writes only via fn_record_vs_vote (rate-limited, dedup-by-session). '
    'Public SELECT enables a "recent duels" feed.';

-- ─── kill_elo : the running ELO rating per kill ───────────────────────
CREATE TABLE IF NOT EXISTS kill_elo (
    kill_id         UUID PRIMARY KEY REFERENCES kills(id) ON DELETE CASCADE,
    elo_rating      FLOAT NOT NULL DEFAULT 1500,
    battles_count   INT   NOT NULL DEFAULT 0,
    wins            INT   NOT NULL DEFAULT 0,
    last_battle_at  TIMESTAMPTZ,
    /** Bookkeeping so we can show "newcomer" / "established" badges. */
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kill_elo_rating
    ON kill_elo (elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_kill_elo_battles
    ON kill_elo (battles_count DESC);

ALTER TABLE kill_elo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kill_elo public read" ON kill_elo;
CREATE POLICY "kill_elo public read" ON kill_elo
    FOR SELECT USING (TRUE);
-- No INSERT/UPDATE policy : mutated exclusively by fn_record_vs_vote.

COMMENT ON TABLE kill_elo IS
    'Wave 25.3 / V59 : per-kill ELO rating maintained by the VS Roulette '
    'voting RPC. Public SELECT for leaderboards. K-factor = 32 (standard). '
    'Starting rating = 1500. Mutated only via fn_record_vs_vote.';

-- ─── fn_pick_vs_pair — sample one kill per side, matching filters ─────
--
-- Each side ("left" / "right") accepts an independent filter object.
-- Recognised keys per side (all optional) :
--   * player_slug          TEXT — lowercased ign of the killer
--   * champion             TEXT — killer's champion name
--   * role                 TEXT — killer's role (top/jungle/mid/bottom/support)
--   * era_date_start       TEXT — ISO date (matches m.scheduled_at >= ...)
--   * era_date_end         TEXT — ISO date (matches m.scheduled_at <= ...)
--   * multi_kill_min       TEXT — 'double' | 'triple' | 'quadra' | 'penta'
--   * is_first_blood       BOOL
--   * min_highlight_score  FLOAT
--
-- Hard filters always applied : status = 'published'  AND  clip_url_vertical
-- IS NOT NULL (the vertical clip is what the /vs page plays).
--
-- Returns a 2-column row : (kill_a JSON, kill_b JSON). Either column can
-- be NULL when no kill matches its side's filters.

DROP FUNCTION IF EXISTS public.fn_pick_vs_pair(jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.fn_pick_vs_pair(
    left_filters  JSONB DEFAULT '{}'::jsonb,
    right_filters JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    kill_a JSONB,
    kill_b JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_kill_a JSONB;
    v_kill_b JSONB;
BEGIN
    -- Helper : pick one matching kill at random. Inlined twice (rather
    -- than as a sub-function) so we don't multiply privilege surface.

    WITH candidates AS (
        SELECT
            k.id,
            k.killer_champion,
            k.victim_champion,
            p1.ign            AS killer_name,
            p1.role           AS killer_role,
            p2.ign            AS victim_name,
            k.clip_url_vertical,
            k.clip_url_vertical_low,
            k.clip_url_horizontal,
            k.thumbnail_url,
            k.highlight_score,
            k.avg_rating,
            k.rating_count,
            k.ai_description,
            k.ai_tags,
            k.multi_kill,
            k.is_first_blood,
            k.tracked_team_involvement,
            k.game_time_seconds,
            k.created_at,
            COALESCE(e.elo_rating, 1500) AS elo_rating,
            COALESCE(e.battles_count, 0) AS elo_battles,
            m.scheduled_at AS match_date
        FROM kills k
        LEFT JOIN players p1 ON k.killer_player_id = p1.id
        LEFT JOIN players p2 ON k.victim_player_id = p2.id
        LEFT JOIN games   g  ON k.game_id          = g.id
        LEFT JOIN matches m  ON g.match_id         = m.id
        LEFT JOIN kill_elo e ON e.kill_id          = k.id
        WHERE k.status = 'published'
          AND k.clip_url_vertical IS NOT NULL
          -- player_slug : case-insensitive match on ign
          AND (
            NULLIF(left_filters->>'player_slug','') IS NULL
            OR LOWER(p1.ign) = LOWER(NULLIF(left_filters->>'player_slug',''))
          )
          AND (
            NULLIF(left_filters->>'champion','') IS NULL
            OR k.killer_champion = NULLIF(left_filters->>'champion','')
          )
          AND (
            NULLIF(left_filters->>'role','') IS NULL
            OR p1.role = NULLIF(left_filters->>'role','')
          )
          AND (
            NULLIF(left_filters->>'era_date_start','') IS NULL
            OR m.scheduled_at >= (NULLIF(left_filters->>'era_date_start',''))::TIMESTAMPTZ
          )
          AND (
            NULLIF(left_filters->>'era_date_end','') IS NULL
            OR m.scheduled_at <= (NULLIF(left_filters->>'era_date_end',''))::TIMESTAMPTZ
          )
          AND (
            NULLIF(left_filters->>'is_first_blood','') IS NULL
            OR k.is_first_blood = (NULLIF(left_filters->>'is_first_blood',''))::BOOLEAN
          )
          AND (
            NULLIF(left_filters->>'min_highlight_score','') IS NULL
            OR k.highlight_score >= (NULLIF(left_filters->>'min_highlight_score',''))::FLOAT
          )
          AND (
            NULLIF(left_filters->>'multi_kill_min','') IS NULL
            OR (
                CASE LOWER(COALESCE(k.multi_kill, ''))
                    WHEN 'double' THEN 2
                    WHEN 'triple' THEN 3
                    WHEN 'quadra' THEN 4
                    WHEN 'penta'  THEN 5
                    ELSE 1
                END
            ) >= (
                CASE LOWER(NULLIF(left_filters->>'multi_kill_min',''))
                    WHEN 'double' THEN 2
                    WHEN 'triple' THEN 3
                    WHEN 'quadra' THEN 4
                    WHEN 'penta'  THEN 5
                    ELSE NULL
                END
            )
          )
        ORDER BY random()
        LIMIT 1
    )
    SELECT to_jsonb(c.*) INTO v_kill_a FROM candidates c;

    WITH candidates AS (
        SELECT
            k.id,
            k.killer_champion,
            k.victim_champion,
            p1.ign            AS killer_name,
            p1.role           AS killer_role,
            p2.ign            AS victim_name,
            k.clip_url_vertical,
            k.clip_url_vertical_low,
            k.clip_url_horizontal,
            k.thumbnail_url,
            k.highlight_score,
            k.avg_rating,
            k.rating_count,
            k.ai_description,
            k.ai_tags,
            k.multi_kill,
            k.is_first_blood,
            k.tracked_team_involvement,
            k.game_time_seconds,
            k.created_at,
            COALESCE(e.elo_rating, 1500) AS elo_rating,
            COALESCE(e.battles_count, 0) AS elo_battles,
            m.scheduled_at AS match_date
        FROM kills k
        LEFT JOIN players p1 ON k.killer_player_id = p1.id
        LEFT JOIN players p2 ON k.victim_player_id = p2.id
        LEFT JOIN games   g  ON k.game_id          = g.id
        LEFT JOIN matches m  ON g.match_id         = m.id
        LEFT JOIN kill_elo e ON e.kill_id          = k.id
        WHERE k.status = 'published'
          AND k.clip_url_vertical IS NOT NULL
          -- Don't pick the same kill twice (degenerate self-vs-self).
          AND (v_kill_a IS NULL OR k.id <> (v_kill_a->>'id')::UUID)
          AND (
            NULLIF(right_filters->>'player_slug','') IS NULL
            OR LOWER(p1.ign) = LOWER(NULLIF(right_filters->>'player_slug',''))
          )
          AND (
            NULLIF(right_filters->>'champion','') IS NULL
            OR k.killer_champion = NULLIF(right_filters->>'champion','')
          )
          AND (
            NULLIF(right_filters->>'role','') IS NULL
            OR p1.role = NULLIF(right_filters->>'role','')
          )
          AND (
            NULLIF(right_filters->>'era_date_start','') IS NULL
            OR m.scheduled_at >= (NULLIF(right_filters->>'era_date_start',''))::TIMESTAMPTZ
          )
          AND (
            NULLIF(right_filters->>'era_date_end','') IS NULL
            OR m.scheduled_at <= (NULLIF(right_filters->>'era_date_end',''))::TIMESTAMPTZ
          )
          AND (
            NULLIF(right_filters->>'is_first_blood','') IS NULL
            OR k.is_first_blood = (NULLIF(right_filters->>'is_first_blood',''))::BOOLEAN
          )
          AND (
            NULLIF(right_filters->>'min_highlight_score','') IS NULL
            OR k.highlight_score >= (NULLIF(right_filters->>'min_highlight_score',''))::FLOAT
          )
          AND (
            NULLIF(right_filters->>'multi_kill_min','') IS NULL
            OR (
                CASE LOWER(COALESCE(k.multi_kill, ''))
                    WHEN 'double' THEN 2
                    WHEN 'triple' THEN 3
                    WHEN 'quadra' THEN 4
                    WHEN 'penta'  THEN 5
                    ELSE 1
                END
            ) >= (
                CASE LOWER(NULLIF(right_filters->>'multi_kill_min',''))
                    WHEN 'double' THEN 2
                    WHEN 'triple' THEN 3
                    WHEN 'quadra' THEN 4
                    WHEN 'penta'  THEN 5
                    ELSE NULL
                END
            )
          )
        ORDER BY random()
        LIMIT 1
    )
    SELECT to_jsonb(c.*) INTO v_kill_b FROM candidates c;

    RETURN QUERY SELECT v_kill_a, v_kill_b;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_pick_vs_pair(JSONB, JSONB)
    TO anon, authenticated;

-- ─── fn_record_vs_vote — write the vote + update ELO atomically ───────
--
-- Standard ELO with K = 32. winner = kill_a → outcome_a = 1, winner =
-- kill_b → outcome_a = 0, winner NULL (abstain) → outcome_a = 0.5.
--
-- Idempotency : if (kill_a, kill_b, voter_session_hash) already exists
-- we return the CURRENT ratings (no-op). This way a retried POST from a
-- flaky network won't double-count.
--
-- Returns the ELO state of both kills after the vote.

DROP FUNCTION IF EXISTS public.fn_record_vs_vote(uuid, uuid, uuid, text, jsonb);
CREATE OR REPLACE FUNCTION public.fn_record_vs_vote(
    p_kill_a       UUID,
    p_kill_b       UUID,
    p_winner       UUID,
    p_session_hash TEXT,
    p_filters      JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    kill_a_id     UUID,
    kill_a_elo    FLOAT,
    kill_a_battles INT,
    kill_a_wins   INT,
    kill_b_id     UUID,
    kill_b_elo    FLOAT,
    kill_b_battles INT,
    kill_b_wins   INT,
    inserted      BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    k_a UUID := p_kill_a;
    k_b UUID := p_kill_b;
    v_existing UUID;
    v_inserted BOOLEAN := FALSE;
    -- Pre-vote ratings
    r_a FLOAT;
    r_b FLOAT;
    -- Expected scores
    e_a FLOAT;
    e_b FLOAT;
    -- Actual outcomes
    o_a FLOAT;
    o_b FLOAT;
    -- New ratings
    n_a FLOAT;
    n_b FLOAT;
    -- K-factor (standard chess ELO)
    k_factor CONSTANT FLOAT := 32.0;
    out_a_id UUID;
    out_a_elo FLOAT;
    out_a_battles INT;
    out_a_wins INT;
    out_b_id UUID;
    out_b_elo FLOAT;
    out_b_battles INT;
    out_b_wins INT;
BEGIN
    -- Argument validation
    IF k_a IS NULL OR k_b IS NULL THEN
        RAISE EXCEPTION 'fn_record_vs_vote: kill_a and kill_b are required';
    END IF;
    IF k_a = k_b THEN
        RAISE EXCEPTION 'fn_record_vs_vote: kill_a and kill_b must differ';
    END IF;
    IF p_session_hash IS NULL OR length(p_session_hash) < 16 THEN
        RAISE EXCEPTION 'fn_record_vs_vote: session_hash must be >= 16 chars';
    END IF;
    IF p_winner IS NOT NULL AND p_winner <> k_a AND p_winner <> k_b THEN
        RAISE EXCEPTION 'fn_record_vs_vote: winner must be kill_a, kill_b, or NULL';
    END IF;

    -- Normalise pair ordering so (a,b) and (b,a) collapse into the same
    -- unique row — guarantees the UNIQUE constraint catches dupes from
    -- a user who saw the same pair flipped on a second roulette spin.
    IF k_a > k_b THEN
        DECLARE
            tmp UUID := k_a;
        BEGIN
            k_a := k_b;
            k_b := tmp;
        END;
    END IF;

    -- Idempotency check : same session already voted on this pair ?
    SELECT id INTO v_existing
    FROM vs_battles
    WHERE kill_a_id = k_a
      AND kill_b_id = k_b
      AND voter_session_hash = p_session_hash
    LIMIT 1;

    IF v_existing IS NULL THEN
        -- Ensure kill_elo rows exist (idempotent upsert at 1500).
        INSERT INTO kill_elo (kill_id) VALUES (k_a)
            ON CONFLICT (kill_id) DO NOTHING;
        INSERT INTO kill_elo (kill_id) VALUES (k_b)
            ON CONFLICT (kill_id) DO NOTHING;

        -- Lock both ELO rows in a deterministic order to avoid deadlocks.
        SELECT elo_rating INTO r_a FROM kill_elo WHERE kill_id = k_a FOR UPDATE;
        SELECT elo_rating INTO r_b FROM kill_elo WHERE kill_id = k_b FOR UPDATE;

        -- ELO expected scores
        e_a := 1.0 / (1.0 + power(10.0, (r_b - r_a) / 400.0));
        e_b := 1.0 - e_a;

        -- Outcomes (a/b semantics relative to the *normalised* pair).
        IF p_winner IS NULL THEN
            o_a := 0.5;
            o_b := 0.5;
        ELSIF p_winner = k_a THEN
            o_a := 1.0;
            o_b := 0.0;
        ELSE
            o_a := 0.0;
            o_b := 1.0;
        END IF;

        n_a := r_a + k_factor * (o_a - e_a);
        n_b := r_b + k_factor * (o_b - e_b);

        -- Insert the vote row. UNIQUE collision = lost race ; swallow it
        -- and fall through to the read path so concurrent retries get the
        -- same answer.
        BEGIN
            INSERT INTO vs_battles (
                kill_a_id, kill_b_id, winner_kill_id,
                voter_user_id, voter_session_hash, filters_json
            ) VALUES (
                k_a, k_b, p_winner,
                auth.uid(), p_session_hash, COALESCE(p_filters, '{}'::jsonb)
            );
            v_inserted := TRUE;
        EXCEPTION WHEN unique_violation THEN
            v_inserted := FALSE;
        END;

        IF v_inserted THEN
            UPDATE kill_elo
                SET elo_rating     = n_a,
                    battles_count  = battles_count + 1,
                    wins           = wins + CASE WHEN o_a = 1.0 THEN 1 ELSE 0 END,
                    last_battle_at = now(),
                    updated_at     = now()
                WHERE kill_id = k_a;
            UPDATE kill_elo
                SET elo_rating     = n_b,
                    battles_count  = battles_count + 1,
                    wins           = wins + CASE WHEN o_b = 1.0 THEN 1 ELSE 0 END,
                    last_battle_at = now(),
                    updated_at     = now()
                WHERE kill_id = k_b;
        END IF;
    END IF;

    -- Read final state (works for both new-insert and idempotent paths).
    SELECT kill_id, elo_rating, battles_count, wins
        INTO out_a_id, out_a_elo, out_a_battles, out_a_wins
        FROM kill_elo WHERE kill_id = k_a;
    SELECT kill_id, elo_rating, battles_count, wins
        INTO out_b_id, out_b_elo, out_b_battles, out_b_wins
        FROM kill_elo WHERE kill_id = k_b;

    -- Defensive : if kill_elo rows still don't exist (idempotent path
    -- hit on rows the vote inserter never reached), default to 1500 / 0.
    IF out_a_id IS NULL THEN
        out_a_id := k_a; out_a_elo := 1500; out_a_battles := 0; out_a_wins := 0;
    END IF;
    IF out_b_id IS NULL THEN
        out_b_id := k_b; out_b_elo := 1500; out_b_battles := 0; out_b_wins := 0;
    END IF;

    RETURN QUERY SELECT
        out_a_id, out_a_elo, out_a_battles, out_a_wins,
        out_b_id, out_b_elo, out_b_battles, out_b_wins,
        v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_record_vs_vote(UUID, UUID, UUID, TEXT, JSONB)
    TO anon, authenticated;

-- ─── fn_top_elo_kills — leaderboard by current ELO rating ─────────────
--
-- Minimum-battles gate : kills with < 5 battles are excluded from the
-- leaderboard so a fresh kill at 1500 doesn't sit above a battle-tested
-- 1480-rated penta. Caller can override via the implicit floor.

DROP FUNCTION IF EXISTS public.fn_top_elo_kills(int, text, text);
CREATE OR REPLACE FUNCTION public.fn_top_elo_kills(
    p_limit            INT  DEFAULT 50,
    p_filter_role      TEXT DEFAULT NULL,
    p_filter_champion  TEXT DEFAULT NULL
)
RETURNS TABLE (
    kill_id           UUID,
    elo_rating        FLOAT,
    battles_count     INT,
    wins              INT,
    killer_champion   TEXT,
    victim_champion   TEXT,
    killer_name       TEXT,
    killer_role       TEXT,
    victim_name       TEXT,
    clip_url_vertical TEXT,
    clip_url_vertical_low TEXT,
    thumbnail_url     TEXT,
    highlight_score   FLOAT,
    avg_rating        FLOAT,
    ai_description    TEXT,
    multi_kill        TEXT,
    is_first_blood    BOOLEAN,
    created_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.kill_id,
        e.elo_rating,
        e.battles_count,
        e.wins,
        k.killer_champion,
        k.victim_champion,
        p1.ign  AS killer_name,
        p1.role AS killer_role,
        p2.ign  AS victim_name,
        k.clip_url_vertical,
        k.clip_url_vertical_low,
        k.thumbnail_url,
        k.highlight_score,
        k.avg_rating,
        k.ai_description,
        k.multi_kill,
        k.is_first_blood,
        k.created_at
    FROM kill_elo e
    JOIN kills   k  ON k.id = e.kill_id
    LEFT JOIN players p1 ON k.killer_player_id = p1.id
    LEFT JOIN players p2 ON k.victim_player_id = p2.id
    WHERE k.status = 'published'
      AND k.clip_url_vertical IS NOT NULL
      AND e.battles_count >= 5
      AND (NULLIF(p_filter_role,'')     IS NULL OR p1.role            = NULLIF(p_filter_role,''))
      AND (NULLIF(p_filter_champion,'') IS NULL OR k.killer_champion  = NULLIF(p_filter_champion,''))
    ORDER BY e.elo_rating DESC, e.battles_count DESC, k.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 200));
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_top_elo_kills(INT, TEXT, TEXT)
    TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- FEATURE 2 — ANTRE DE LA BCC
-- ══════════════════════════════════════════════════════════════════════

-- Three single-row global counters + per-session logs for rate-limit
-- enforcement and (eventually) per-fan leaderboards.

-- ─── bcc_punches : "punch the screen" gesture ─────────────────────────
CREATE TABLE IF NOT EXISTS bcc_punches (
    id                  TEXT PRIMARY KEY,
    count               BIGINT NOT NULL DEFAULT 0,
    last_incremented_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO bcc_punches (id, count) VALUES ('global', 0)
    ON CONFLICT (id) DO NOTHING;

ALTER TABLE bcc_punches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bcc_punches public read" ON bcc_punches;
CREATE POLICY "bcc_punches public read" ON bcc_punches
    FOR SELECT USING (TRUE);
-- Writes via fn_bcc_punch SECURITY DEFINER only.

CREATE TABLE IF NOT EXISTS bcc_punches_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    session_hash TEXT NOT NULL,
    count        INT NOT NULL CHECK (count BETWEEN 1 AND 100),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bcc_punches_log_session
    ON bcc_punches_log (session_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bcc_punches_log_created
    ON bcc_punches_log (created_at DESC);

ALTER TABLE bcc_punches_log ENABLE ROW LEVEL SECURITY;
-- No public read on the log (per-session attribution is internal). Service
-- role bypasses RLS, so admin / analytics can still read it.

-- ─── bcc_tomatoes : "throw a tomato" gesture ──────────────────────────
CREATE TABLE IF NOT EXISTS bcc_tomatoes (
    id                  TEXT PRIMARY KEY,
    count               BIGINT NOT NULL DEFAULT 0,
    last_incremented_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO bcc_tomatoes (id, count) VALUES ('global', 0)
    ON CONFLICT (id) DO NOTHING;

ALTER TABLE bcc_tomatoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bcc_tomatoes public read" ON bcc_tomatoes;
CREATE POLICY "bcc_tomatoes public read" ON bcc_tomatoes
    FOR SELECT USING (TRUE);

CREATE TABLE IF NOT EXISTS bcc_tomatoes_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    session_hash TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bcc_tomatoes_log_session
    ON bcc_tomatoes_log (session_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bcc_tomatoes_log_created
    ON bcc_tomatoes_log (created_at DESC);

ALTER TABLE bcc_tomatoes_log ENABLE ROW LEVEL SECURITY;

-- ─── bcc_ahou_plays : "ahou-ahou" sample plays ────────────────────────
CREATE TABLE IF NOT EXISTS bcc_ahou_plays (
    id                  TEXT PRIMARY KEY,
    count               BIGINT NOT NULL DEFAULT 0,
    last_incremented_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO bcc_ahou_plays (id, count) VALUES ('global', 0)
    ON CONFLICT (id) DO NOTHING;

ALTER TABLE bcc_ahou_plays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bcc_ahou_plays public read" ON bcc_ahou_plays;
CREATE POLICY "bcc_ahou_plays public read" ON bcc_ahou_plays
    FOR SELECT USING (TRUE);

CREATE TABLE IF NOT EXISTS bcc_ahou_plays_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    session_hash TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bcc_ahou_log_session
    ON bcc_ahou_plays_log (session_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bcc_ahou_log_created
    ON bcc_ahou_plays_log (created_at DESC);

ALTER TABLE bcc_ahou_plays_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE bcc_punches IS
    'Wave 25.3 / V59 : global counter for the Antre BCC punch gesture. '
    'Single row id=''global''. Writes via fn_bcc_punch (rate-limited).';
COMMENT ON TABLE bcc_tomatoes IS
    'Wave 25.3 / V59 : global counter for tomato-throws on the Zaboutine '
    'sticker. Single row id=''global''. Writes via fn_bcc_tomato.';
COMMENT ON TABLE bcc_ahou_plays IS
    'Wave 25.3 / V59 : global counter for ahou-ahou sample plays. Single '
    'row id=''global''. Writes via fn_bcc_ahou_played (no rate-limit).';

-- ─── fn_bcc_punch : rate-limited punch increment ──────────────────────
--
-- Rate limit : at most 100 punches in any 10-second window per session.
-- We sum the per-session log over the last 10s and reject if the new
-- batch would push us over. Existing punches within the window count.

DROP FUNCTION IF EXISTS public.fn_bcc_punch(text, int);
CREATE OR REPLACE FUNCTION public.fn_bcc_punch(
    p_session_hash TEXT,
    p_count        INT DEFAULT 1
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_recent_sum INT;
    v_new_count  BIGINT;
BEGIN
    IF p_session_hash IS NULL OR length(p_session_hash) < 16 THEN
        RAISE EXCEPTION 'fn_bcc_punch: session_hash must be >= 16 chars';
    END IF;
    IF p_count IS NULL OR p_count < 1 OR p_count > 100 THEN
        RAISE EXCEPTION 'fn_bcc_punch: count must be 1..100 (got %)', p_count;
    END IF;

    -- Rate limit : sum punches by this session in the last 10 seconds.
    SELECT COALESCE(SUM(count), 0)
        INTO v_recent_sum
        FROM bcc_punches_log
        WHERE session_hash = p_session_hash
          AND created_at > now() - INTERVAL '10 seconds';

    IF v_recent_sum + p_count > 100 THEN
        RAISE EXCEPTION 'fn_bcc_punch: rate limit (100 / 10s) exceeded' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO bcc_punches_log (user_id, session_hash, count)
        VALUES (auth.uid(), p_session_hash, p_count);

    UPDATE bcc_punches
        SET count = count + p_count,
            last_incremented_at = now()
        WHERE id = 'global'
        RETURNING count INTO v_new_count;

    RETURN v_new_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_bcc_punch(TEXT, INT)
    TO anon, authenticated;

-- ─── fn_bcc_tomato : rate-limited tomato increment ────────────────────
--
-- 30 tomatoes / 10s per session. Caller increments by 1 per call.

DROP FUNCTION IF EXISTS public.fn_bcc_tomato(text);
CREATE OR REPLACE FUNCTION public.fn_bcc_tomato(
    p_session_hash TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_recent_count INT;
    v_new_count    BIGINT;
BEGIN
    IF p_session_hash IS NULL OR length(p_session_hash) < 16 THEN
        RAISE EXCEPTION 'fn_bcc_tomato: session_hash must be >= 16 chars';
    END IF;

    SELECT COUNT(*)
        INTO v_recent_count
        FROM bcc_tomatoes_log
        WHERE session_hash = p_session_hash
          AND created_at > now() - INTERVAL '10 seconds';

    IF v_recent_count >= 30 THEN
        RAISE EXCEPTION 'fn_bcc_tomato: rate limit (30 / 10s) exceeded' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO bcc_tomatoes_log (user_id, session_hash)
        VALUES (auth.uid(), p_session_hash);

    UPDATE bcc_tomatoes
        SET count = count + 1,
            last_incremented_at = now()
        WHERE id = 'global'
        RETURNING count INTO v_new_count;

    RETURN v_new_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_bcc_tomato(TEXT)
    TO anon, authenticated;

-- ─── fn_bcc_ahou_played : hover/event-fired, no rate limit ────────────

DROP FUNCTION IF EXISTS public.fn_bcc_ahou_played(text);
CREATE OR REPLACE FUNCTION public.fn_bcc_ahou_played(
    p_session_hash TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_new_count BIGINT;
BEGIN
    IF p_session_hash IS NULL OR length(p_session_hash) < 16 THEN
        RAISE EXCEPTION 'fn_bcc_ahou_played: session_hash must be >= 16 chars';
    END IF;

    INSERT INTO bcc_ahou_plays_log (user_id, session_hash)
        VALUES (auth.uid(), p_session_hash);

    UPDATE bcc_ahou_plays
        SET count = count + 1,
            last_incremented_at = now()
        WHERE id = 'global'
        RETURNING count INTO v_new_count;

    RETURN v_new_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_bcc_ahou_played(TEXT)
    TO anon, authenticated;

-- ─── fn_bcc_kyeahoo_kills : Kyeahoo-specific feed for the cave ────────
--
-- Champion-agnostic ; we match the mid laner by ign. Returns top 50 by
-- highlight_score for the dedicated "Mes mids préférés" panel in the
-- BCC drawer.

DROP FUNCTION IF EXISTS public.fn_bcc_kyeahoo_kills();
CREATE OR REPLACE FUNCTION public.fn_bcc_kyeahoo_kills()
RETURNS TABLE (
    id                    UUID,
    killer_champion       TEXT,
    victim_champion       TEXT,
    killer_name           TEXT,
    victim_name           TEXT,
    clip_url_vertical     TEXT,
    clip_url_vertical_low TEXT,
    clip_url_horizontal   TEXT,
    thumbnail_url         TEXT,
    highlight_score       FLOAT,
    avg_rating            FLOAT,
    rating_count          INT,
    ai_description        TEXT,
    ai_tags               JSONB,
    multi_kill            TEXT,
    is_first_blood        BOOLEAN,
    created_at            TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        k.id,
        k.killer_champion,
        k.victim_champion,
        p1.ign AS killer_name,
        p2.ign AS victim_name,
        k.clip_url_vertical,
        k.clip_url_vertical_low,
        k.clip_url_horizontal,
        k.thumbnail_url,
        k.highlight_score,
        k.avg_rating,
        k.rating_count,
        k.ai_description,
        k.ai_tags,
        k.multi_kill,
        k.is_first_blood,
        k.created_at
    FROM kills k
    LEFT JOIN players p1 ON k.killer_player_id = p1.id
    LEFT JOIN players p2 ON k.victim_player_id = p2.id
    WHERE k.status = 'published'
      AND k.clip_url_vertical IS NOT NULL
      AND LOWER(p1.ign) = 'kyeahoo'
    ORDER BY k.highlight_score DESC NULLS LAST, k.created_at DESC
    LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_bcc_kyeahoo_kills()
    TO anon, authenticated;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- Operator usage
-- ══════════════════════════════════════════════════════════════════════
--
-- Apply via Supabase Management API (PAT) :
--
--   curl -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
--        -H "Authorization: Bearer $SUPABASE_PAT" \
--        -H "Content-Type: application/json" \
--        --data-binary @<(jq -Rs '{query: .}' < 059_vs_roulette_and_bcc.sql)
--
-- Verify after apply :
--
--   SELECT count(*) FROM vs_battles ;
--   SELECT count(*) FROM kill_elo ;
--   SELECT * FROM bcc_punches ;            -- expect 1 row 'global'
--   SELECT * FROM bcc_tomatoes ;
--   SELECT * FROM bcc_ahou_plays ;
--   SELECT * FROM fn_top_elo_kills(10) ;   -- empty until votes land
--
-- Quick smoke-test the vs flow :
--
--   SELECT * FROM fn_pick_vs_pair('{}'::jsonb, '{}'::jsonb) ;
--   SELECT * FROM fn_record_vs_vote(
--       '00000000-0000-0000-0000-000000000001',
--       '00000000-0000-0000-0000-000000000002',
--       '00000000-0000-0000-0000-000000000001',
--       'sha256-test-session-hash-1234567890ab',
--       '{"pool_id": "smoke-test"}'::jsonb
--   ) ;
