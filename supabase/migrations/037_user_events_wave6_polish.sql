-- Migration 037 — Extend user_events.event_type CHECK whitelist (Wave 6)
--
-- Wave 6 / Agent AB introduces new client-side analytics events for the
-- scroll feed UX polish (skeleton, error state, double-tap-like, swipe-share,
-- scroll restore, offline fallback). The API allowlist (web/src/app/api/track/route.ts)
-- already accepts them, but the DB CHECK constraint from migrations 029 + 034
-- silently rejects them (the row hits the table, the constraint fails, the
-- row is dropped → analytics gap with no errors visible to the operator).
--
-- New events :
--   clip.error               (Agent AB — video element 404 / decode error)
--   feed.scroll_restored     (Agent AB — sessionStorage scroll position
--                             rehydrated on /scroll mount after back-nav)
--   feed.offline_entered     (Agent AB — navigator.onLine flipped to false)
--   feed.offline_exited      (Agent AB — navigator.onLine flipped back true)
--
-- Idempotent : DROP CONSTRAINT IF EXISTS handles re-runs.
-- Same pattern as migration 034.

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
        -- ─── Wave 4 additions ────────────────────────────────────
        'feed.mode_live_entered',
        'feed.mode_live_exited',
        'timeline.era_selected',
        'push.subscribed',
        'push.unsubscribed',
        'push.permission_denied',
        'push.preferences_updated',
        -- ─── Wave 6 additions (Agent AB — scroll UX polish) ─────
        -- Video element error from R2 / network / decode (FeedItemError).
        'clip.error',
        -- /scroll mount restores last-seen kill from sessionStorage
        -- after back-navigation from /kill/[id].
        'feed.scroll_restored',
        -- navigator.onLine transitions — drives the offline banner +
        -- pauses SSR auto-refresh until connection returns.
        'feed.offline_entered',
        'feed.offline_exited'
    ));

COMMENT ON CONSTRAINT user_events_event_type_check ON user_events IS
    'Whitelist of supported analytics event types. Keep in sync with '
    'web/src/lib/analytics/track.ts EventType union AND '
    'web/src/app/api/track/route.ts ALLOWED_EVENT_TYPES set. '
    'Adding a value to one without the others creates a silent drop.';
