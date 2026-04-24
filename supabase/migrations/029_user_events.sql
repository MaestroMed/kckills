-- Migration 029 — Product analytics (user_events)
--
-- Today we have ratings + comments but no behavioural analytics.
-- We can't answer :
--   * Which clips are watched fully vs flicked past?
--   * Which players drive engagement?
--   * Does 9:16 desktop or 16:9 desktop perform better?
--   * Where do users drop in the scroll feed?
--   * Which AI score correlates with completion rate?
--
-- This table stores anonymous + authenticated events. PRIVACY :
--   * anonymous_user_id = client-generated UUID stored in localStorage
--   * user_id           = nullable, only set when logged in
--   * NO IP, NO User-Agent string stored beyond a coarse classification
--   * payload sanitised by the API endpoint (no free-form PII)

CREATE TABLE IF NOT EXISTS user_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Identity (one of the two will be set)
    anonymous_user_id TEXT,
    user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    session_id      TEXT,                              -- per-tab session
    -- Event
    event_type      TEXT NOT NULL CHECK (event_type IN (
                        -- Scroll feed events
                        'feed.view',
                        'clip.viewed',
                        'clip.started',           -- video.play fired
                        'clip.completed',         -- watched > 90% duration
                        'clip.replayed',          -- looped past start
                        'clip.skipped',           -- scrolled past < 1.5s
                        'clip.shared',
                        'clip.liked',
                        'clip.rated',
                        'clip.opened',            -- /kill/[id] navigation
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
                        'auth.logout'
                    )),
    -- Target
    entity_type     TEXT,                              -- 'kill' | 'player' | 'match' | etc.
    entity_id       TEXT,
    -- Context
    metadata        JSONB NOT NULL DEFAULT '{}',
    -- Coarse client classification (no PII)
    client_kind     TEXT,                              -- 'mobile' | 'desktop' | 'tablet' | 'pwa'
    network_class   TEXT,                              -- 'fast' | 'medium' | 'slow'
    locale          TEXT,                              -- 'fr' | 'en' | 'ko' | 'es'
    -- Timestamp
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_user_events_recent
    ON user_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_events_type_recent
    ON user_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_events_entity
    ON user_events(entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_events_session
    ON user_events(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_user_events_anonymous
    ON user_events(anonymous_user_id, created_at DESC)
    WHERE anonymous_user_id IS NOT NULL;

-- ─── Aggregation view : per-clip engagement (used by /admin/analytics) ───
CREATE OR REPLACE VIEW v_clip_engagement_24h AS
SELECT
    entity_id                                      AS kill_id,
    SUM(CASE WHEN event_type = 'clip.viewed'    THEN 1 ELSE 0 END) AS views,
    SUM(CASE WHEN event_type = 'clip.started'   THEN 1 ELSE 0 END) AS starts,
    SUM(CASE WHEN event_type = 'clip.completed' THEN 1 ELSE 0 END) AS completes,
    SUM(CASE WHEN event_type = 'clip.replayed'  THEN 1 ELSE 0 END) AS replays,
    SUM(CASE WHEN event_type = 'clip.shared'    THEN 1 ELSE 0 END) AS shares,
    SUM(CASE WHEN event_type = 'clip.liked'     THEN 1 ELSE 0 END) AS likes,
    -- Completion rate : completes / starts
    NULLIF(SUM(CASE WHEN event_type = 'clip.started'   THEN 1 ELSE 0 END), 0)::float
        AS completion_denom,
    SUM(CASE WHEN event_type = 'clip.completed' THEN 1 ELSE 0 END)::float
      / NULLIF(SUM(CASE WHEN event_type = 'clip.started' THEN 1 ELSE 0 END), 0)::float
        AS completion_rate,
    COUNT(DISTINCT COALESCE(user_id::text, anonymous_user_id))   AS unique_viewers
  FROM user_events
 WHERE entity_type = 'kill'
   AND created_at > now() - interval '24 hours'
 GROUP BY entity_id;

-- Top clips by engagement (used by feed-algorithm to boost hot ones)
CREATE OR REPLACE VIEW v_trending_kills_1h AS
SELECT
    entity_id AS kill_id,
    COUNT(*)  AS interactions_1h
  FROM user_events
 WHERE entity_type = 'kill'
   AND event_type IN ('clip.viewed', 'clip.completed', 'clip.replayed', 'clip.liked', 'clip.shared')
   AND created_at > now() - interval '1 hour'
 GROUP BY entity_id
 ORDER BY interactions_1h DESC
 LIMIT 100;

-- ─── RLS ────────────────────────────────────────────────────────────
ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;

-- Anyone can INSERT (anonymous tracking allowed). The /api/track
-- endpoint sanitises payload before persisting.
DROP POLICY IF EXISTS "Anyone insert events" ON user_events;
CREATE POLICY "Anyone insert events" ON user_events
    FOR INSERT WITH CHECK (true);

-- No public read — analytics surface is admin-only.
COMMENT ON TABLE user_events IS
    'Anonymous + auth user events. Powers /admin/analytics + feed ranking. '
    'NO IP / UA stored. Anonymous_user_id is client-side localStorage UUID.';
