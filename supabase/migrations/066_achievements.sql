-- Migration 066 — Achievements / Badge system (Wave 31a, 2026-05-14)
--
-- Habit-formation gamification layer. Every action that touches the
-- existing community surfaces (ratings, comments, vs_battles,
-- bracket_votes, face_off_votes, compilations, bcc_punches_log,
-- bcc_tomatoes_log, bcc_ahou_plays_log, user_events) feeds a single
-- evaluation function that hands out badges.
--
-- Layout :
--   * achievements              — catalogue (seeded in this file)
--   * user_achievements         — per-user earned badges
--   * session_achievements      — per-session badges for anonymous users
--                                 (mirrors the session_hash pattern used
--                                 by bcc_punches_log + bracket_votes)
--   * fn_user_achievement_stats — single aggregate query that pulls every
--                                 counter the criteria evaluator needs
--                                 (one round trip, no fan-out)
--   * fn_evaluate_user_achievements(p_user_id)        — awards new badges
--   * fn_evaluate_session_achievements(p_session)     — same for anon
--   * fn_award_achievement(...)                       — direct (admin)
--   * fn_user_achievements(p_user_id)                 — list earned + locked
--   * fn_session_achievements(p_session)              — same for anon
--   * fn_global_recent_unlocks(p_limit)               — community feed
--
-- The legacy `profiles.badges JSONB` column from migration 001 is left
-- untouched. New surfaces read `user_achievements` ; the old column stays
-- alive as a denormalised fallback (and so the BadgeChip component on
-- /settings keeps rendering until everything migrates).
--
-- Conventions (matches migrations 051 / 057 / 061 / 062 / 063 / 065) :
--   * SECURITY DEFINER + `SET search_path = public, pg_catalog`
--   * RLS enabled on every new table
--   * Idempotent : safe to re-run
--   * Public reads on the catalogue + earned counts only
--
-- Apply :
--   curl -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
--        -H "Authorization: Bearer $SUPABASE_PAT" \
--        -H "Content-Type: application/json" \
--        --data-binary @<(jq -Rs '{query: .}' < 066_achievements.sql)

BEGIN;

-- ══════════════════════════════════════════════════════════════════════
-- achievements — the catalogue
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.achievements (
    slug        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    /** Emoji or short string. Kept as TEXT so we can swap in an SVG icon
     *  name later without a migration. */
    icon        TEXT NOT NULL,
    rarity      TEXT NOT NULL CHECK (rarity IN ('common','rare','epic','legendary')),
    category    TEXT NOT NULL CHECK (category IN (
                    'engagement','curator','social','collector','predictor','community'
                )),
    points      INT NOT NULL DEFAULT 10 CHECK (points >= 0),
    /** Criteria as JSONB. Each top-level key is one threshold the
     *  evaluator understands ; see fn_evaluate_user_achievements for the
     *  full set of recognised keys. */
    criteria    JSONB NOT NULL DEFAULT '{}'::jsonb,
    /** Sort order inside its category, low to high. NULL → name DESC. */
    sort_order  INT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_achievements_category
    ON public.achievements (category, sort_order NULLS LAST, points);
CREATE INDEX IF NOT EXISTS idx_achievements_rarity
    ON public.achievements (rarity, points);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "achievements public read" ON public.achievements;
CREATE POLICY "achievements public read" ON public.achievements
    FOR SELECT USING (TRUE);
-- No INSERT/UPDATE policy — service role only (seeded here, edited via SQL).

COMMENT ON TABLE public.achievements IS
    'Migration 066 : Catalogue of badges users can earn. Public read. '
    'Service role writes only. Seed data lives at the bottom of this file.';

-- ══════════════════════════════════════════════════════════════════════
-- user_achievements — earned per user
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_achievements (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    achievement_slug TEXT NOT NULL REFERENCES public.achievements(slug) ON DELETE CASCADE,
    earned_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    /** Snapshot of the counters at evaluation time. Used by the UI to
     *  show "tu as obtenu ce badge à 100/100 votes". */
    progress         JSONB,
    UNIQUE (user_id, achievement_slug)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user
    ON public.user_achievements (user_id, earned_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_achievements_slug
    ON public.user_achievements (achievement_slug);
CREATE INDEX IF NOT EXISTS idx_user_achievements_recent
    ON public.user_achievements (earned_at DESC);

ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_achievements own read" ON public.user_achievements;
CREATE POLICY "user_achievements own read" ON public.user_achievements
    FOR SELECT USING (auth.uid() = user_id);
-- No INSERT/UPDATE policy — writes go exclusively through the SECURITY
-- DEFINER evaluator. Service role bypasses RLS for admin tooling.

COMMENT ON TABLE public.user_achievements IS
    'Migration 066 : Earned badges per user. Writes via SECURITY DEFINER '
    'RPCs only. Own-row read policy ; service role bypasses for admin. '
    'Public aggregates (rarity counts) exposed via fn_global_recent_unlocks.';

-- ══════════════════════════════════════════════════════════════════════
-- session_achievements — earned per anon session
-- ══════════════════════════════════════════════════════════════════════
--
-- The /scroll feed, /vs roulette, /face-off and the BCC actions all work
-- without auth — they use the session_hash convention (>=16 char random
-- hex client-side, deduped server-side). The achievement system mirrors
-- that : anon users still progress and unlock badges, which makes the
-- system reachable from day one.

CREATE TABLE IF NOT EXISTS public.session_achievements (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_hash     TEXT NOT NULL CHECK (length(session_hash) >= 16),
    achievement_slug TEXT NOT NULL REFERENCES public.achievements(slug) ON DELETE CASCADE,
    earned_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    progress         JSONB,
    UNIQUE (session_hash, achievement_slug)
);

CREATE INDEX IF NOT EXISTS idx_session_achievements_hash
    ON public.session_achievements (session_hash, earned_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_achievements_slug
    ON public.session_achievements (achievement_slug);
CREATE INDEX IF NOT EXISTS idx_session_achievements_recent
    ON public.session_achievements (earned_at DESC);

ALTER TABLE public.session_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "session_achievements public read" ON public.session_achievements;
CREATE POLICY "session_achievements public read" ON public.session_achievements
    FOR SELECT USING (TRUE);
-- Public read is fine — the session_hash is a client-side random salt,
-- not an identifier of a person. No INSERT policy : writes via RPC only.

COMMENT ON TABLE public.session_achievements IS
    'Migration 066 : Per-session badges for anonymous users. Public read '
    'because session_hash is a random client salt. Writes via RPC only.';

-- ══════════════════════════════════════════════════════════════════════
-- fn_user_achievement_stats — single-query counters bundle
-- ══════════════════════════════════════════════════════════════════════
--
-- One aggregate scan that returns every counter the evaluator might check.
-- Putting all the SUMs in one CTE keeps the evaluator cheap (single round
-- trip per user) AND lets the catalogue page show progress bars without
-- a second query.
--
-- Counters returned :
--   ratings_count            — public.ratings rows where user_id matches
--   ratings_5star_count      — ratings of 5 where the clip is now top 10%
--                              by highlight_score (the "trend_predictor"
--                              criterion)
--   comments_count           — non-deleted, moderation_status='approved'
--   vs_battles_count         — public.vs_battles rows for this user
--   face_off_votes_count     — public.face_off_votes
--   bracket_votes_count      — public.bracket_votes
--   compilations_count       — public.compilations
--   bcc_punches_count        — sum(count) from public.bcc_punches_log
--   bcc_tomatoes_count       — count of bcc_tomatoes_log rows
--   bcc_ahou_plays_count     — count of bcc_ahou_plays_log rows
--   shares_count             — user_events of type 'clip.shared'
--   distinct_eras_visited    — distinct metadata->>'era_slug' on
--                              'page.viewed' user_events
--   distinct_visit_days      — distinct date_trunc('day') across all
--                              user_events
--   completed_clip_views     — user_events of type 'clip.completed'
--   first_hour_votes_count   — votes cast within 60 min of clip creation
--   bcc_unlocked             — user_events with event_type='page.viewed'
--                              and metadata->>'page'='bcc'
--   completed_bracket        — has voted in every match of at least one
--                              bracket_tournament (bracket_voter)
--
-- Identity model :
--   * if p_user_id is NOT NULL → counters come from user_id columns
--   * if p_session_hash is NOT NULL → counters come from session_hash
--   * if BOTH are set we UNION the two (a logged-in user who used the
--     site anonymously earlier gets both lifetimes credited)
--   * if NEITHER is set → returns zeros

DROP FUNCTION IF EXISTS public.fn_user_achievement_stats(uuid, text);
CREATE OR REPLACE FUNCTION public.fn_user_achievement_stats(
    p_user_id      UUID DEFAULT NULL,
    p_session_hash TEXT DEFAULT NULL
)
RETURNS TABLE (
    ratings_count          INT,
    ratings_5star_count    INT,
    comments_count         INT,
    vs_battles_count       INT,
    face_off_votes_count   INT,
    bracket_votes_count    INT,
    compilations_count     INT,
    bcc_punches_count      INT,
    bcc_tomatoes_count     INT,
    bcc_ahou_plays_count   INT,
    shares_count           INT,
    distinct_eras_visited  INT,
    distinct_visit_days    INT,
    completed_clip_views   INT,
    first_hour_votes_count INT,
    bcc_unlocked           BOOLEAN,
    completed_bracket      BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
    v_has_user    BOOLEAN := p_user_id IS NOT NULL;
    v_has_session BOOLEAN := p_session_hash IS NOT NULL AND length(p_session_hash) >= 16;
BEGIN
    IF NOT v_has_user AND NOT v_has_session THEN
        RETURN QUERY SELECT
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, FALSE, FALSE;
        RETURN;
    END IF;

    RETURN QUERY
    WITH
    -- ratings ---------------------------------------------------------
    r_ratings AS (
        SELECT COUNT(*)::INT AS n
        FROM public.ratings
        WHERE v_has_user AND user_id = p_user_id
    ),
    -- 5-star ratings on clips that turned out to be top 10% by
    -- highlight_score. The /10% threshold is computed as a fixed cut
    -- (anything >= 8.5 qualifies — simpler than a percentile join,
    -- close enough for "top 10% of published clips").
    r_5star_top AS (
        SELECT COUNT(*)::INT AS n
        FROM public.ratings r
        JOIN public.kills   k ON k.id = r.kill_id
        WHERE v_has_user
          AND r.user_id = p_user_id
          AND r.score = 5
          AND COALESCE(k.highlight_score, 0) >= 8.5
    ),
    -- comments --------------------------------------------------------
    r_comments AS (
        SELECT COUNT(*)::INT AS n
        FROM public.comments
        WHERE v_has_user
          AND user_id = p_user_id
          AND COALESCE(is_deleted, FALSE) = FALSE
          AND moderation_status IN ('approved','pending')
    ),
    -- vs roulette + face-off + bracket --------------------------------
    r_vs AS (
        SELECT COUNT(*)::INT AS n FROM public.vs_battles
        WHERE (v_has_user AND voter_user_id = p_user_id)
           OR (v_has_session AND voter_session_hash = p_session_hash)
    ),
    r_face AS (
        SELECT COUNT(*)::INT AS n FROM public.face_off_votes
        WHERE (v_has_user AND voter_user_id = p_user_id)
           OR (v_has_session AND voter_session_hash = p_session_hash)
    ),
    r_bracket AS (
        SELECT COUNT(*)::INT AS n FROM public.bracket_votes
        WHERE (v_has_user AND voter_user_id = p_user_id)
           OR (v_has_session AND voter_session_hash = p_session_hash)
    ),
    -- compilations ----------------------------------------------------
    r_comp AS (
        SELECT COUNT(*)::INT AS n FROM public.compilations
        WHERE (v_has_user AND user_id = p_user_id)
           OR (v_has_session AND session_hash = p_session_hash)
    ),
    -- bcc actions ----------------------------------------------------
    r_punches AS (
        SELECT COALESCE(SUM(count), 0)::INT AS n
        FROM public.bcc_punches_log
        WHERE (v_has_user AND user_id = p_user_id)
           OR (v_has_session AND session_hash = p_session_hash)
    ),
    r_tomatoes AS (
        SELECT COUNT(*)::INT AS n
        FROM public.bcc_tomatoes_log
        WHERE (v_has_user AND user_id = p_user_id)
           OR (v_has_session AND session_hash = p_session_hash)
    ),
    r_ahou AS (
        SELECT COUNT(*)::INT AS n
        FROM public.bcc_ahou_plays_log
        WHERE (v_has_user AND user_id = p_user_id)
           OR (v_has_session AND session_hash = p_session_hash)
    ),
    -- user_events derived counters -----------------------------------
    -- We OR the user_id and anonymous_user_id columns since the
    -- analytics pipeline writes whichever is available.
    r_shares AS (
        SELECT COUNT(*)::INT AS n
        FROM public.user_events
        WHERE event_type = 'clip.shared'
          AND (
              (v_has_user AND user_id = p_user_id)
              OR (v_has_session AND anonymous_user_id = p_session_hash)
          )
    ),
    r_eras AS (
        SELECT COUNT(DISTINCT (metadata->>'era_slug'))::INT AS n
        FROM public.user_events
        WHERE event_type IN ('page.viewed','match.opened')
          AND metadata ? 'era_slug'
          AND (
              (v_has_user AND user_id = p_user_id)
              OR (v_has_session AND anonymous_user_id = p_session_hash)
          )
    ),
    r_visit_days AS (
        SELECT COUNT(DISTINCT date_trunc('day', created_at))::INT AS n
        FROM public.user_events
        WHERE (
            (v_has_user AND user_id = p_user_id)
            OR (v_has_session AND anonymous_user_id = p_session_hash)
        )
    ),
    r_completes AS (
        SELECT COUNT(*)::INT AS n
        FROM public.user_events
        WHERE event_type = 'clip.completed'
          AND (
              (v_has_user AND user_id = p_user_id)
              OR (v_has_session AND anonymous_user_id = p_session_hash)
          )
    ),
    r_first_hour AS (
        SELECT COUNT(*)::INT AS n
        FROM public.ratings rr
        JOIN public.kills   kk ON kk.id = rr.kill_id
        WHERE v_has_user
          AND rr.user_id = p_user_id
          AND rr.created_at <= kk.created_at + INTERVAL '60 minutes'
    ),
    r_bcc_unlocked AS (
        SELECT EXISTS (
            SELECT 1 FROM public.user_events
            WHERE event_type = 'page.viewed'
              AND (
                  metadata->>'page' = 'bcc'
                  OR metadata->>'feature' = 'bcc_unlock'
              )
              AND (
                  (v_has_user AND user_id = p_user_id)
                  OR (v_has_session AND anonymous_user_id = p_session_hash)
              )
        ) AS yes
    ),
    -- completed_bracket : did the caller cast a vote on every match
    -- of at least one tournament ? We pick the tournament with the
    -- highest match coverage and check it equals 100%.
    r_completed_bracket AS (
        SELECT EXISTS (
            SELECT 1
            FROM public.bracket_matches bm
            WHERE bm.tournament_id IN (
                SELECT m.tournament_id
                FROM public.bracket_matches m
                LEFT JOIN public.bracket_votes bv
                  ON  bv.match_id = m.id
                  AND ((v_has_user AND bv.voter_user_id = p_user_id)
                       OR (v_has_session AND bv.voter_session_hash = p_session_hash))
                GROUP BY m.tournament_id
                HAVING COUNT(*) > 0
                   AND COUNT(*) = COUNT(bv.id)
            )
        ) AS yes
    )
    SELECT
        (SELECT n FROM r_ratings),
        (SELECT n FROM r_5star_top),
        (SELECT n FROM r_comments),
        (SELECT n FROM r_vs),
        (SELECT n FROM r_face),
        (SELECT n FROM r_bracket),
        (SELECT n FROM r_comp),
        (SELECT n FROM r_punches),
        (SELECT n FROM r_tomatoes),
        (SELECT n FROM r_ahou),
        (SELECT n FROM r_shares),
        (SELECT n FROM r_eras),
        (SELECT n FROM r_visit_days),
        (SELECT n FROM r_completes),
        (SELECT n FROM r_first_hour),
        (SELECT yes FROM r_bcc_unlocked),
        (SELECT yes FROM r_completed_bracket);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_user_achievement_stats(uuid, text)
    TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- _fn_match_criterion — boolean check on one (criterion, stats) pair
-- ══════════════════════════════════════════════════════════════════════
--
-- Internal helper. Walks one JSONB criterion object and decides whether
-- the current counters bundle satisfies every key. Keys that aren't
-- recognised cause the criterion to fail closed (no badge) so a typo in
-- a seed row can't accidentally award everything.

DROP FUNCTION IF EXISTS public._fn_match_criterion(jsonb, jsonb);
CREATE OR REPLACE FUNCTION public._fn_match_criterion(
    p_criteria JSONB,
    p_stats    JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    k TEXT;
    v JSONB;
    actual NUMERIC;
    needed NUMERIC;
BEGIN
    IF p_criteria IS NULL OR jsonb_typeof(p_criteria) <> 'object' THEN
        RETURN FALSE;
    END IF;

    FOR k, v IN SELECT * FROM jsonb_each(p_criteria) LOOP
        CASE k
            WHEN 'min_ratings'             THEN actual := COALESCE((p_stats->>'ratings_count')::NUMERIC, 0);
            WHEN 'min_comments'            THEN actual := COALESCE((p_stats->>'comments_count')::NUMERIC, 0);
            WHEN 'min_vs_battles'          THEN actual := COALESCE((p_stats->>'vs_battles_count')::NUMERIC, 0);
            WHEN 'min_face_off_votes'      THEN actual := COALESCE((p_stats->>'face_off_votes_count')::NUMERIC, 0);
            WHEN 'min_bracket_votes'       THEN actual := COALESCE((p_stats->>'bracket_votes_count')::NUMERIC, 0);
            WHEN 'min_compilations'        THEN actual := COALESCE((p_stats->>'compilations_count')::NUMERIC, 0);
            WHEN 'min_punches'             THEN actual := COALESCE((p_stats->>'bcc_punches_count')::NUMERIC, 0);
            WHEN 'min_tomatoes'            THEN actual := COALESCE((p_stats->>'bcc_tomatoes_count')::NUMERIC, 0);
            WHEN 'min_ahou_plays'          THEN actual := COALESCE((p_stats->>'bcc_ahou_plays_count')::NUMERIC, 0);
            WHEN 'min_shares'              THEN actual := COALESCE((p_stats->>'shares_count')::NUMERIC, 0);
            WHEN 'distinct_visit_days'     THEN actual := COALESCE((p_stats->>'distinct_visit_days')::NUMERIC, 0);
            WHEN 'distinct_eras_visited'   THEN actual := COALESCE((p_stats->>'distinct_eras_visited')::NUMERIC, 0);
            WHEN 'completed_clip_views'    THEN actual := COALESCE((p_stats->>'completed_clip_views')::NUMERIC, 0);
            WHEN 'vote_within_minutes'     THEN
                -- minute threshold is currently ignored — we just need at
                -- least one vote cast within the 60-min window. The
                -- counter `first_hour_votes_count` is precomputed against
                -- 60 min and the threshold key acts as a flag rather than
                -- a tunable knob (changing it would change the stat).
                actual := COALESCE((p_stats->>'first_hour_votes_count')::NUMERIC, 0);
                needed := 1;
                IF actual < needed THEN RETURN FALSE; END IF;
                CONTINUE;
            WHEN 'high_rating_on_top'      THEN
                IF NOT COALESCE((p_stats->>'ratings_5star_count')::NUMERIC, 0) > 0 THEN
                    RETURN FALSE;
                END IF;
                CONTINUE;
            WHEN 'bcc_unlocked'            THEN
                IF NOT COALESCE((p_stats->>'bcc_unlocked')::BOOLEAN, FALSE) THEN
                    RETURN FALSE;
                END IF;
                CONTINUE;
            WHEN 'completed_bracket'       THEN
                IF NOT COALESCE((p_stats->>'completed_bracket')::BOOLEAN, FALSE) THEN
                    RETURN FALSE;
                END IF;
                CONTINUE;
            ELSE
                -- unknown key → fail closed
                RETURN FALSE;
        END CASE;

        -- For threshold-style criteria we read the JSON value as numeric
        -- and compare. ON jsonb_typeof(v) <> 'number' we coerce ; if that
        -- fails the badge stays locked rather than auto-awarding.
        BEGIN
            needed := (v#>>'{}')::NUMERIC;
        EXCEPTION WHEN OTHERS THEN
            RETURN FALSE;
        END;
        IF actual < needed THEN
            RETURN FALSE;
        END IF;
    END LOOP;

    RETURN TRUE;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════
-- fn_evaluate_user_achievements — award + return newly earned
-- ══════════════════════════════════════════════════════════════════════
--
-- The user-side entrypoint. Computes the counters bundle once, walks
-- every catalogue row whose criteria matches, INSERTs into
-- user_achievements with ON CONFLICT DO NOTHING, and returns the list of
-- slugs that were *newly* earned by this call (the worker pipes that to
-- the push-notifier so users get a "Tu as débloqué : X" toast).

DROP FUNCTION IF EXISTS public.fn_evaluate_user_achievements(uuid);
CREATE OR REPLACE FUNCTION public.fn_evaluate_user_achievements(
    p_user_id UUID
)
RETURNS TABLE (
    slug    TEXT,
    name    TEXT,
    rarity  TEXT,
    points  INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_stats_row RECORD;
    v_stats     JSONB;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN;
    END IF;

    -- One round-trip to gather every counter.
    SELECT * INTO v_stats_row
    FROM public.fn_user_achievement_stats(p_user_id, NULL);

    v_stats := to_jsonb(v_stats_row);

    -- Walk the catalogue + insert the matches. RETURNING * lets us
    -- collect ONLY the rows that were newly inserted (ON CONFLICT
    -- collisions don't appear in the returning set).
    RETURN QUERY
    WITH eligible AS (
        SELECT a.slug, a.name, a.rarity, a.points
        FROM public.achievements a
        WHERE public._fn_match_criterion(a.criteria, v_stats)
    ),
    inserted AS (
        INSERT INTO public.user_achievements (user_id, achievement_slug, progress)
        SELECT p_user_id, e.slug, v_stats
        FROM eligible e
        ON CONFLICT (user_id, achievement_slug) DO NOTHING
        RETURNING achievement_slug
    )
    SELECT e.slug, e.name, e.rarity, e.points
    FROM eligible e
    JOIN inserted i ON i.achievement_slug = e.slug;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_evaluate_user_achievements(uuid)
    TO anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════
-- fn_evaluate_session_achievements — anon mirror
-- ══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.fn_evaluate_session_achievements(text);
CREATE OR REPLACE FUNCTION public.fn_evaluate_session_achievements(
    p_session_hash TEXT
)
RETURNS TABLE (
    slug    TEXT,
    name    TEXT,
    rarity  TEXT,
    points  INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_stats_row RECORD;
    v_stats     JSONB;
BEGIN
    IF p_session_hash IS NULL OR length(p_session_hash) < 16 THEN
        RETURN;
    END IF;

    SELECT * INTO v_stats_row
    FROM public.fn_user_achievement_stats(NULL, p_session_hash);

    v_stats := to_jsonb(v_stats_row);

    RETURN QUERY
    WITH eligible AS (
        SELECT a.slug, a.name, a.rarity, a.points
        FROM public.achievements a
        WHERE public._fn_match_criterion(a.criteria, v_stats)
    ),
    inserted AS (
        INSERT INTO public.session_achievements (session_hash, achievement_slug, progress)
        SELECT p_session_hash, e.slug, v_stats
        FROM eligible e
        ON CONFLICT (session_hash, achievement_slug) DO NOTHING
        RETURNING achievement_slug
    )
    SELECT e.slug, e.name, e.rarity, e.points
    FROM eligible e
    JOIN inserted i ON i.achievement_slug = e.slug;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_evaluate_session_achievements(text)
    TO anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════
-- fn_award_achievement — direct award (admin / event-triggered)
-- ══════════════════════════════════════════════════════════════════════
--
-- Bypasses the criteria check : useful when we want to award a badge
-- from a server-side hook (e.g. the konami code already grants
-- 'blue_wall' on the client — the equivalent achievement-table entry
-- can be inserted by calling this RPC with the slug directly).

DROP FUNCTION IF EXISTS public.fn_award_achievement(uuid, text, text);
CREATE OR REPLACE FUNCTION public.fn_award_achievement(
    p_user_id      UUID,
    p_session_hash TEXT,
    p_slug         TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_exists BOOLEAN;
    v_inserted BOOLEAN := FALSE;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.achievements WHERE slug = p_slug)
      INTO v_exists;
    IF NOT v_exists THEN
        RETURN FALSE;
    END IF;

    IF p_user_id IS NOT NULL THEN
        INSERT INTO public.user_achievements (user_id, achievement_slug, progress)
        VALUES (p_user_id, p_slug, jsonb_build_object('awarded', true))
        ON CONFLICT (user_id, achievement_slug) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        RETURN v_inserted > 0;
    END IF;

    IF p_session_hash IS NOT NULL AND length(p_session_hash) >= 16 THEN
        INSERT INTO public.session_achievements (session_hash, achievement_slug, progress)
        VALUES (p_session_hash, p_slug, jsonb_build_object('awarded', true))
        ON CONFLICT (session_hash, achievement_slug) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        RETURN v_inserted > 0;
    END IF;

    RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_award_achievement(uuid, text, text)
    TO anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════
-- fn_user_achievements — catalogue + earned state for one user
-- ══════════════════════════════════════════════════════════════════════
--
-- The catalogue page reads this. Returns one row per catalogue entry
-- with `earned_at` set to NULL for locked badges, plus a per-badge
-- progress dict that the UI uses to draw the progress bar.

DROP FUNCTION IF EXISTS public.fn_user_achievements(uuid, text);
CREATE OR REPLACE FUNCTION public.fn_user_achievements(
    p_user_id      UUID DEFAULT NULL,
    p_session_hash TEXT DEFAULT NULL
)
RETURNS TABLE (
    slug        TEXT,
    name        TEXT,
    description TEXT,
    icon        TEXT,
    rarity      TEXT,
    category    TEXT,
    points      INT,
    criteria    JSONB,
    earned_at   TIMESTAMPTZ,
    progress    JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
    v_stats_row RECORD;
    v_stats     JSONB;
BEGIN
    -- Always compute live stats so the unearned rows can show "X / Y"
    -- progress bars without a follow-up RPC.
    SELECT * INTO v_stats_row
    FROM public.fn_user_achievement_stats(p_user_id, p_session_hash);
    v_stats := to_jsonb(v_stats_row);

    RETURN QUERY
    SELECT
        a.slug,
        a.name,
        a.description,
        a.icon,
        a.rarity,
        a.category,
        a.points,
        a.criteria,
        COALESCE(ua.earned_at, sa.earned_at) AS earned_at,
        CASE
            WHEN ua.earned_at IS NOT NULL OR sa.earned_at IS NOT NULL
                THEN COALESCE(ua.progress, sa.progress)
            ELSE v_stats
        END AS progress
    FROM public.achievements a
    LEFT JOIN public.user_achievements ua
        ON ua.achievement_slug = a.slug
       AND p_user_id IS NOT NULL
       AND ua.user_id = p_user_id
    LEFT JOIN public.session_achievements sa
        ON sa.achievement_slug = a.slug
       AND p_session_hash IS NOT NULL
       AND sa.session_hash = p_session_hash
    ORDER BY
        a.category,
        a.sort_order NULLS LAST,
        a.points,
        a.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_user_achievements(uuid, text)
    TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- fn_global_recent_unlocks — community feed
-- ══════════════════════════════════════════════════════════════════════
--
-- "Récemment débloqué par la BCC" : last N unlocks across all users.
-- Anonymous-friendly — we never expose the raw user_id ; we surface
-- profile.discord_username when available (already public via the
-- profiles RLS policy) and fall back to "Un membre de la BCC".

DROP FUNCTION IF EXISTS public.fn_global_recent_unlocks(int);
CREATE OR REPLACE FUNCTION public.fn_global_recent_unlocks(
    p_limit INT DEFAULT 10
)
RETURNS TABLE (
    slug         TEXT,
    name         TEXT,
    icon         TEXT,
    rarity       TEXT,
    earned_at    TIMESTAMPTZ,
    display_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
    v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
BEGIN
    RETURN QUERY
    WITH combined AS (
        SELECT
            ua.achievement_slug AS slug,
            ua.earned_at,
            COALESCE(p.discord_username, NULL) AS display_name
        FROM public.user_achievements ua
        LEFT JOIN public.profiles p ON p.id = ua.user_id
        UNION ALL
        SELECT
            sa.achievement_slug AS slug,
            sa.earned_at,
            NULL::TEXT AS display_name
        FROM public.session_achievements sa
    )
    SELECT
        c.slug,
        a.name,
        a.icon,
        a.rarity,
        c.earned_at,
        c.display_name
    FROM combined c
    JOIN public.achievements a ON a.slug = c.slug
    ORDER BY c.earned_at DESC
    LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_global_recent_unlocks(int)
    TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- fn_users_with_recent_activity — feed for the worker evaluator
-- ══════════════════════════════════════════════════════════════════════
--
-- Returns the user_ids that touched anything in the last 7 days, capped
-- at 500 per call so the worker doesn't spend 30 minutes on a single
-- evaluation cycle.

DROP FUNCTION IF EXISTS public.fn_users_with_recent_activity(int, int);
CREATE OR REPLACE FUNCTION public.fn_users_with_recent_activity(
    p_lookback_days INT DEFAULT 7,
    p_limit         INT DEFAULT 500
)
RETURNS TABLE (
    user_id UUID,
    last_active_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
    v_since TIMESTAMPTZ := now() - (GREATEST(1, p_lookback_days) || ' days')::INTERVAL;
    v_limit INT := GREATEST(10, LEAST(COALESCE(p_limit, 500), 5000));
BEGIN
    RETURN QUERY
    WITH activity AS (
        SELECT user_id, MAX(created_at) AS last_active_at
        FROM public.ratings
        WHERE user_id IS NOT NULL AND created_at >= v_since
        GROUP BY user_id
        UNION ALL
        SELECT user_id, MAX(created_at)
        FROM public.comments
        WHERE user_id IS NOT NULL AND created_at >= v_since
        GROUP BY user_id
        UNION ALL
        SELECT voter_user_id, MAX(created_at)
        FROM public.vs_battles
        WHERE voter_user_id IS NOT NULL AND created_at >= v_since
        GROUP BY voter_user_id
        UNION ALL
        SELECT voter_user_id, MAX(created_at)
        FROM public.face_off_votes
        WHERE voter_user_id IS NOT NULL AND created_at >= v_since
        GROUP BY voter_user_id
        UNION ALL
        SELECT voter_user_id, MAX(created_at)
        FROM public.bracket_votes
        WHERE voter_user_id IS NOT NULL AND created_at >= v_since
        GROUP BY voter_user_id
        UNION ALL
        SELECT user_id, MAX(created_at)
        FROM public.user_events
        WHERE user_id IS NOT NULL AND created_at >= v_since
        GROUP BY user_id
    )
    SELECT activity.user_id, MAX(activity.last_active_at) AS last_active_at
    FROM activity
    GROUP BY activity.user_id
    ORDER BY MAX(activity.last_active_at) DESC
    LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_users_with_recent_activity(int, int)
    TO service_role;

-- ══════════════════════════════════════════════════════════════════════
-- Seed catalogue — the 20 starter badges
-- ══════════════════════════════════════════════════════════════════════
--
-- ON CONFLICT (slug) DO UPDATE so editing this seed list and re-running
-- the migration keeps the catalogue in sync (criteria + description
-- changes propagate). Re-runs do NOT clear `user_achievements` rows.

INSERT INTO public.achievements (slug, name, description, icon, rarity, category, points, criteria, sort_order) VALUES
    ('first_rating',          'Premier vote',           'Ta première note sur un kill.',                                  '⭐',  'common',    'engagement', 10,  '{"min_ratings": 1}'::jsonb,           10),
    ('rater_10',              'Voteur en série',        '10 notes données aux clips de la BCC.',                          '🎯',  'common',    'engagement', 20,  '{"min_ratings": 10}'::jsonb,          20),
    ('rater_100',             'Critique reconnu',       '100 notes données. Tu connais tes clips.',                       '🏆',  'rare',      'engagement', 50,  '{"min_ratings": 100}'::jsonb,         30),
    ('rater_1000',            'Légende du vote',        '1000 notes données. Statue dans l''Antre.',                      '🏛️',  'legendary', 'engagement', 500, '{"min_ratings": 1000}'::jsonb,        40),
    ('first_comment',         'Première parole',        'Ton premier commentaire posté.',                                 '💬',  'common',    'social',     10,  '{"min_comments": 1}'::jsonb,          10),
    ('commenter_50',          'Animateur',              '50 commentaires posés sur les clips.',                           '💭',  'rare',      'social',     50,  '{"min_comments": 50}'::jsonb,         20),
    ('early_bird',            'Lève-tôt',               'Vote dans l''heure qui suit la publi d''un clip.',               '🐦',  'rare',      'engagement', 30,  '{"vote_within_minutes": 60}'::jsonb,  50),
    ('trend_predictor',       'Visionnaire',            'Tu as mis 5★ à un clip ensuite passé top 10 highlight_score.',   '🔮',  'epic',      'predictor',  100, '{"high_rating_on_top": true}'::jsonb, 10),
    ('bcc_member',            'Membre BCC',             'Tu as découvert l''Antre de la BCC.',                            '◆',   'epic',      'community',  100, '{"bcc_unlocked": true}'::jsonb,       10),
    ('compilation_creator',   'Réalisateur',            'Ta première compilation publiée sur /c/...',                     '🎬',  'rare',      'curator',    30,  '{"min_compilations": 1}'::jsonb,      10),
    ('vs_voter_50',           'Juge de duels',          '50 votes dans le VS Roulette.',                                  '⚔️',  'rare',      'engagement', 40,  '{"min_vs_battles": 50}'::jsonb,       60),
    ('face_off_voter',        'Arbitre',                'Tu as voté sur 10 face-offs joueurs.',                           '👔',  'common',    'engagement', 20,  '{"min_face_off_votes": 10}'::jsonb,   70),
    ('bracket_voter',         'Participant du tournoi', 'Tu as voté sur tous les matchs d''un bracket.',                  '🏟️',  'rare',      'engagement', 50,  '{"completed_bracket": true}'::jsonb,  80),
    ('tomato_thrower',        'Lanceur de tomates',     '100 tomates lancées sur Zaboutine.',                             '🍅',  'common',    'community',  10,  '{"min_tomatoes": 100}'::jsonb,        20),
    ('puncher_1000',          'Cogneur',                '1000 coups de poing dans l''Antre.',                             '🥊',  'rare',      'community',  30,  '{"min_punches": 1000}'::jsonb,        30),
    ('ahou_hearer',           'Initié au cri',          'Tu as écouté 50 fois Ahou Ahou.',                                '🐺',  'rare',      'community',  30,  '{"min_ahou_plays": 50}'::jsonb,       40),
    ('kc_loyalist',           'Loyaliste KC',           'Tu as visité kckills.com 30 jours différents.',                  '💛',  'epic',      'engagement', 200, '{"distinct_visit_days": 30}'::jsonb,  90),
    ('share_a_clip',          'Partageur',              'Ton premier partage de clip.',                                   '📲',  'common',    'social',     10,  '{"min_shares": 1}'::jsonb,            30),
    ('era_explorer',          'Explorateur d''ères',    'Tu as visité chaque ère KC de 2021 à 2026.',                     '🗺️',  'epic',      'collector',  100, '{"distinct_eras_visited": 9}'::jsonb, 10),
    ('clip_completionist',    'Cinéphile',              'Tu as regardé 500 clips en entier.',                             '🎥',  'legendary', 'collector',  300, '{"completed_clip_views": 500}'::jsonb, 20)
ON CONFLICT (slug) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    icon        = EXCLUDED.icon,
    rarity      = EXCLUDED.rarity,
    category    = EXCLUDED.category,
    points      = EXCLUDED.points,
    criteria    = EXCLUDED.criteria,
    sort_order  = EXCLUDED.sort_order;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- Operator notes
-- ══════════════════════════════════════════════════════════════════════
--
-- Verify after apply :
--   SELECT count(*) FROM achievements ;             -- expect 20
--   SELECT category, count(*)
--     FROM achievements GROUP BY category ORDER BY 1 ;
--   SELECT * FROM fn_user_achievements(NULL, NULL) ; -- catalogue + nulls
--
-- Try a synthetic award :
--   SELECT fn_award_achievement(
--       '<some-user-uuid>'::uuid, NULL, 'first_rating');
--   SELECT * FROM fn_user_achievements('<some-user-uuid>'::uuid, NULL);
--
-- Smoke evaluator :
--   SELECT * FROM fn_evaluate_user_achievements('<some-user-uuid>'::uuid);
