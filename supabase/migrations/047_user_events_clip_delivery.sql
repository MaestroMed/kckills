-- Migration 047 — Extend user_events.event_type CHECK whitelist (Wave 11)
--
-- Wave 11 / Agent DE wires HLS adaptive bitrate into the scroll player
-- (FeedPlayerPool + useHlsPlayer hook). The new analytics event
-- `clip.delivery` is fired once per kill the pool successfully attaches
-- a source to, with metadata { delivery: 'hls' | 'mp4' }. Lets the admin
-- RUM dashboard measure HLS adoption over time and spot regressions
-- where the MP4 fallback is hit too often (e.g. CDN issues with the
-- .m3u8 manifest, hls.js failed to load, etc.).
--
-- The event is wired into the API allowlist
-- (web/src/app/api/track/route.ts ALLOWED_EVENT_TYPES) and the EventType
-- union (web/src/lib/analytics/track.ts), but the DB CHECK constraint
-- from migrations 029 / 034 / 037 / 040 / 041 silently rejects it — the
-- tracker is best-effort and Postgres drops the row, so the gap is
-- invisible until this migration runs.
--
-- New event :
--   clip.delivery
--     metadata: { delivery: 'hls' | 'mp4' }
--
-- Slot note : 045 was originally reserved for this migration in Agent
-- DE's spec but was claimed in parallel by another wave-11 agent's
-- 045_rename_kc_involvement.sql, so we shifted to 047 (044 / 046 are
-- also taken). Migration content is otherwise unchanged.
--
-- Idempotent : DROP CONSTRAINT IF EXISTS handles re-runs.
-- Same pattern as migrations 034 / 037 / 040 / 041.

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
        -- Auth (Discord OAuth via Supabase)
        'auth.signup',
        'auth.login',
        'auth.logout',
        -- ─── Wave 4 additions ────────────────────────────────────
        'feed.mode_live_entered',
        'feed.mode_live_exited',
        'timeline.era_selected',
        'push.subscribed',
        'push.unsubscribed',
        'push.permission_denied',
        'push.preferences_updated',
        -- ─── Wave 6 additions (Agent AB — scroll UX polish) ─────
        'clip.error',
        'feed.scroll_restored',
        'feed.offline_entered',
        'feed.offline_exited',
        -- ─── Wave 7 additions (Agent AG — Riot OAuth linking) ───
        'riot.link_started',
        'auth.riot_linked',
        'auth.riot_unlinked',
        -- ─── Wave 7 additions (Agent AF — comment voting) ───────
        'comment.voted',
        -- ─── Wave 9 additions (Agent AL — Web Vitals RUM) ───────
        'perf.vital',
        -- ─── Wave 11 additions (Agent DE — HLS adaptive bitrate) ─
        -- Fired once per kill the FeedPlayerPool successfully
        -- attaches a source to (Safari native HLS, hls.js MSE, or
        -- the MP4 fallback when neither HLS path is available).
        -- metadata: { delivery: 'hls' | 'mp4' }.
        'clip.delivery'
    ));

COMMENT ON CONSTRAINT user_events_event_type_check ON user_events IS
    'Whitelist of supported analytics event types. Keep in sync with '
    'web/src/lib/analytics/track.ts EventType union AND '
    'web/src/app/api/track/route.ts ALLOWED_EVENT_TYPES set. '
    'Adding a value to one without the others creates a silent drop.';
