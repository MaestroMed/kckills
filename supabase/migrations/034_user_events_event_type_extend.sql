-- Migration 034 — Extend user_events.event_type CHECK whitelist
--
-- Wave 4 introduces new client-side analytics events that the API
-- allowlist (web/src/app/api/track/route.ts) accepts but the DB CHECK
-- constraint from migration 029 silently rejects (the row hits the
-- table, the constraint fails, the row is dropped → analytics gap
-- with no errors visible to the operator).
--
-- New events :
--   timeline.era_selected             (Agent R — KC Timeline filter)
--   feed.mode_live_entered            (Agent Q — scroll mode live banner)
--   feed.mode_live_exited             (same — fires on transition out)
--   push.subscribed                   (Agent S — PWA push opt-in)
--   push.unsubscribed                 (same — explicit opt-out)
--   push.permission_denied            (same — granular vs unsubscribe)
--   push.preferences_updated          (same — per-kind toggles)
--
-- Idempotent : DROP CONSTRAINT IF EXISTS handles re-runs.
-- Same pattern as migration 033 (worker.backfill type extension).

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
        -- Mode live (Agent Q — scroll feed switches to 15s polling
        -- when a KC match is in progress).
        'feed.mode_live_entered',
        'feed.mode_live_exited',
        -- Timeline filter (Agent R — selecting a KC era filters
        -- the kills feed by date range).
        'timeline.era_selected',
        -- Push notifications (Agent S — PWA subscription lifecycle).
        'push.subscribed',
        'push.unsubscribed',
        'push.permission_denied',
        'push.preferences_updated'
    ));

COMMENT ON CONSTRAINT user_events_event_type_check ON user_events IS
    'Whitelist of supported analytics event types. Keep in sync with '
    'web/src/lib/analytics/track.ts EventType union AND '
    'web/src/app/api/track/route.ts ALLOWED_EVENT_TYPES set. '
    'Adding a value to one without the others creates a silent drop.';
