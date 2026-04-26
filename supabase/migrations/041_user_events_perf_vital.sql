-- Migration 041 — Extend user_events.event_type CHECK whitelist (Wave 9)
--
-- Wave 9 / Agent AL ships the Real User Monitoring (RUM) Web Vitals
-- reporter (LCP / CLS / INP / FCP / TTFB / FID). The new analytics event
-- (perf.vital) is wired into the API allowlist (web/src/app/api/track/route.ts)
-- and the EventType union (web/src/lib/analytics/track.ts), but the DB
-- CHECK constraint from migrations 029 / 034 / 037 / 040 silently rejects
-- it — the tracker is best-effort and Postgres drops the row, so the gap
-- is invisible until this migration runs.
--
-- Why RUM matters : Phase 4 of CLAUDE.md targets Lighthouse > 90 but
-- Lighthouse is a synthetic, throttled-3G simulation. Real users on
-- real networks (mostly mobile in France) tell us how the site actually
-- performs. Field data > lab data for ranking signals + UX decisions.
--
-- Single new event :
--   perf.vital
--     metadata: {
--       name: 'CLS' | 'FCP' | 'FID' | 'INP' | 'LCP' | 'TTFB',
--       value: number,
--       rating: 'good' | 'needs-improvement' | 'poor',
--       id: string,                    // unique per metric instance
--       navigation_type?: string,      // navigate / back-forward-cache / …
--       page_path?: string             // window.location.pathname
--     }
--
-- Idempotent : DROP CONSTRAINT IF EXISTS handles re-runs.
-- Same pattern as migrations 034 / 037 / 040.

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
        -- Fired by WebVitalsReporter (mounted once in the root layout)
        -- with metadata { name, value, rating, id, navigation_type,
        -- page_path }. One event per metric per page load — Google's
        -- web-vitals lib already de-duplicates internally (each metric
        -- has a unique id, callback fires once per visit unless
        -- reportAllChanges is set).
        'perf.vital'
    ));

COMMENT ON CONSTRAINT user_events_event_type_check ON user_events IS
    'Whitelist of supported analytics event types. Keep in sync with '
    'web/src/lib/analytics/track.ts EventType union AND '
    'web/src/app/api/track/route.ts ALLOWED_EVENT_TYPES set. '
    'Adding a value to one without the others creates a silent drop.';

-- ─── Helper index for /api/admin/perf/vitals aggregation ────────────
-- The admin perf endpoint queries user_events filtered by
-- event_type='perf.vital' AND created_at > now() - interval '24 hours',
-- grouped by metadata->>'page_path' and metadata->>'name'. The existing
-- idx_user_events_type_recent (event_type, created_at DESC) covers the
-- WHERE clause efficiently. JSONB lookups via metadata->>'name' / 'page_path'
-- are computed in-memory after the recent rows are fetched — for 24h of
-- traffic at free-tier scale (a few thousand events) this is plenty fast
-- without a dedicated GIN index. Re-evaluate if perf.vital volume crosses
-- ~50k/day.
COMMENT ON INDEX idx_user_events_type_recent IS
    'Covers the perf.vital RUM aggregation query (Agent AL, Wave 9) — '
    'WHERE event_type = ''perf.vital'' AND created_at > now() - 24h.';
