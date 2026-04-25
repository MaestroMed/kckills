-- Migration 038 — Comment voting (Reddit-style upvote/downvote) + analytics
--
-- Adds the missing voting layer for `comments`. The `comments.upvotes`
-- column has existed since migration 001 but nothing actually wrote to it
-- and there was no per-user vote tracking, so the feed/sheet had no way
-- to render a "you voted" state or to enforce one-vote-per-user-per-comment.
--
-- Design :
--   * `comment_votes` carries a single row per (user, comment) pair with
--     vote_value ∈ {-1, +1}. A removed vote = DELETE the row (rather than
--     setting vote_value = 0) — keeps the table small and the trigger
--     logic linear.
--   * Trigger `fn_recompute_comment_upvotes` runs AFTER INSERT/UPDATE/DELETE
--     and recomputes `comments.upvotes` as the SUM(vote_value). This turns
--     the existing column into a denormalised score (positive = upvoted
--     more than downvoted, negative = inverse) that the feed sort can
--     consume without a JOIN.
--   * RLS : SELECT public (anyone can see the vote breakdown), INSERT
--     auth-only, UPDATE/DELETE only on own rows.
--   * Index on (comment_id) so the trigger's recompute SUM is index-only.
--   * UNIQUE (comment_id, user_id) enforces one vote per user per comment;
--     callers either INSERT-fresh or UPDATE the existing row.
--
-- Companion changes :
--   1. Extend pipeline_jobs.type CHECK — `comment.moderate` was added in
--      migration 033 but wasn't claimed by anything. The moderator daemon
--      (worker/modules/moderator.py) now claims it queue-first; no schema
--      change needed there since 033 already whitelisted the type.
--   2. Extend user_events.event_type CHECK to allow `comment.voted` so
--      the per-vote analytics signal isn't silently dropped (see migration
--      029 for the silent-drop pattern).
--
-- Idempotent : every CREATE has IF NOT EXISTS, every DROP CONSTRAINT/
-- POLICY uses IF EXISTS. Safe to re-run.

-- ─── Table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comment_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vote_value INT NOT NULL CHECK (vote_value IN (-1, 1)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (comment_id, user_id)
);

COMMENT ON TABLE comment_votes IS
    'PR-arch P2 community — per-user vote on a comment. vote_value ∈ {-1,+1}; '
    'a removed vote is a DELETE. Trigger `trg_comment_votes_recompute` keeps '
    'comments.upvotes in sync as the running SUM(vote_value).';

COMMENT ON COLUMN comment_votes.vote_value IS
    '+1 = upvote, -1 = downvote. To remove a vote, DELETE the row. The '
    'CHECK constraint forbids 0 (neutral) — neutral = no row.';

-- ─── Index ───────────────────────────────────────────────────────────
-- The trigger does SELECT SUM(vote_value) WHERE comment_id = X — having
-- (comment_id) as a btree index lets the planner satisfy the SUM with an
-- index-only scan when comment_id has few votes (the common case). The
-- UNIQUE constraint above already creates a (comment_id, user_id) index;
-- this dedicated single-column one is for the recompute SUM only.
CREATE INDEX IF NOT EXISTS idx_comment_votes_comment
    ON comment_votes(comment_id);

-- Used by the API to resolve "what did THIS user vote on these comments"
-- in one query when rendering the sheet — we batch-fetch all votes for
-- the visible comment ids in a single round trip.
CREATE INDEX IF NOT EXISTS idx_comment_votes_user
    ON comment_votes(user_id, comment_id);

-- ─── Recompute trigger ──────────────────────────────────────────────
-- AFTER INSERT/UPDATE/DELETE on comment_votes recomputes the parent
-- comment's `upvotes` column as the running SUM(vote_value). We use
-- COALESCE so an empty result set yields 0 instead of NULL.
--
-- SECURITY DEFINER lets the trigger update `comments.upvotes` even when
-- the calling role only has INSERT on comment_votes (e.g. an authenticated
-- user voting via the API). RLS on the comments table doesn't block the
-- trigger because the function runs as the table owner.
CREATE OR REPLACE FUNCTION fn_recompute_comment_upvotes()
RETURNS TRIGGER AS $$
DECLARE
    affected_comment_id UUID;
BEGIN
    affected_comment_id := COALESCE(NEW.comment_id, OLD.comment_id);
    IF affected_comment_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    UPDATE comments
       SET upvotes = COALESCE((
               SELECT SUM(vote_value)
                 FROM comment_votes
                WHERE comment_id = affected_comment_id
           ), 0)
     WHERE id = affected_comment_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_comment_votes_recompute ON comment_votes;
CREATE TRIGGER trg_comment_votes_recompute
AFTER INSERT OR UPDATE OR DELETE ON comment_votes
FOR EACH ROW EXECUTE FUNCTION fn_recompute_comment_upvotes();

-- Bump updated_at on UPDATE so the API can detect "vote was flipped".
CREATE OR REPLACE FUNCTION fn_comment_votes_touch_updated()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_votes_touch_updated ON comment_votes;
CREATE TRIGGER trg_comment_votes_touch_updated
BEFORE UPDATE ON comment_votes
FOR EACH ROW EXECUTE FUNCTION fn_comment_votes_touch_updated();

-- ─── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE comment_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read votes" ON comment_votes;
CREATE POLICY "Public read votes" ON comment_votes
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Auth insert own vote" ON comment_votes;
CREATE POLICY "Auth insert own vote" ON comment_votes
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Auth update own vote" ON comment_votes;
CREATE POLICY "Auth update own vote" ON comment_votes
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Auth delete own vote" ON comment_votes;
CREATE POLICY "Auth delete own vote" ON comment_votes
    FOR DELETE USING (auth.uid() = user_id);

-- ─── user_events whitelist extension ────────────────────────────────
-- `comment.voted` is the new analytics signal fired client-side from
-- the vote button. Same pattern as migration 037 — keep this in lockstep
-- with web/src/lib/analytics/track.ts EventType union AND
-- web/src/app/api/track/route.ts ALLOWED_EVENT_TYPES set, otherwise
-- the row hits the table, the constraint fails, and the row silently
-- vanishes (analytics gap with no visible error).
ALTER TABLE user_events
    DROP CONSTRAINT IF EXISTS user_events_event_type_check;

ALTER TABLE user_events
    ADD CONSTRAINT user_events_event_type_check
    CHECK (event_type IN (
        -- Scroll feed events (migration 029 baseline)
        'feed.view',
        'clip.viewed',
        'clip.started',
        'clip.completed',
        'clip.replayed',
        'clip.skipped',
        'clip.shared',
        'clip.liked',
        'clip.rated',
        'clip.opened',
        -- Browse
        'page.viewed',
        'player.opened',
        'match.opened',
        'tournament.opened',
        'search.executed',
        -- Interaction
        'comment.created',
        'language.changed',
        'quality.changed',
        'mute.toggled',
        'install.prompted',
        'install.accepted',
        -- Auth
        'auth.signup',
        'auth.login',
        'auth.logout',
        -- Wave 4
        'feed.mode_live_entered',
        'feed.mode_live_exited',
        'timeline.era_selected',
        'push.subscribed',
        'push.unsubscribed',
        'push.permission_denied',
        'push.preferences_updated',
        -- Wave 6
        'clip.error',
        'feed.scroll_restored',
        'feed.offline_entered',
        'feed.offline_exited',
        -- ─── Wave 7 — comment voting (Agent AF) ─────────────────
        -- Fired by CommentSheetV2 + KillInteractions when a user
        -- toggles a vote (vote=+1, vote=-1, or vote=0 to remove).
        -- metadata: { vote: -1 | 0 | 1, prev: -1 | 0 | 1 }
        'comment.voted'
    ));

COMMENT ON CONSTRAINT user_events_event_type_check ON user_events IS
    'Whitelist of supported analytics event types. Keep in sync with '
    'web/src/lib/analytics/track.ts EventType union AND '
    'web/src/app/api/track/route.ts ALLOWED_EVENT_TYPES set. '
    'Adding a value to one without the others creates a silent drop.';
