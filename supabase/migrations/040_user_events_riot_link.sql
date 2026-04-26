-- Migration 040 — Extend user_events.event_type CHECK whitelist (Wave 7)
--
-- Wave 7 / Agent AG ships the optional Riot OAuth linking flow on
-- /settings + /player/[slug]. The new analytics events (auth.riot_linked,
-- auth.riot_unlinked, riot.link_started) are accepted by the API
-- allowlist (web/src/app/api/track/route.ts) but the DB CHECK constraint
-- from migrations 029 / 034 / 037 silently rejects them — the tracker is
-- best-effort and Postgres drops the row, so the gap is invisible until
-- this migration runs.
--
-- Idempotent : DROP CONSTRAINT IF EXISTS handles re-runs.
-- Same pattern as migrations 034 + 037.
--
-- Coordination note (April 2026) : Agent AF is parallel-shipping
-- migrations 038 + 039 for community clip submissions. This file claims
-- 040 and stays additive — no overlap with their schema.

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
        -- Fired by RiotLinkCard when the user clicks "Lier mon
        -- compte Riot" before the redirect to auth.riotgames.com.
        'riot.link_started',
        -- Fired by /api/auth/riot/callback (one-shot cookie picked
        -- up by AuthEventTracker / RiotLinkCard) on successful
        -- Riot account binding to the kckills profile.
        'auth.riot_linked',
        -- Fired by RiotLinkCard handleUnlink() after a successful
        -- POST /api/auth/riot/unlink that NULL-out the riot_* cols.
        'auth.riot_unlinked'
    ));

COMMENT ON CONSTRAINT user_events_event_type_check ON user_events IS
    'Whitelist of supported analytics event types. Keep in sync with '
    'web/src/lib/analytics/track.ts EventType union AND '
    'web/src/app/api/track/route.ts ALLOWED_EVENT_TYPES set. '
    'Adding a value to one without the others creates a silent drop.';
