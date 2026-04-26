-- Migration 022 — Per-subscription push preferences (PR21)
--
-- Adds a JSONB `preferences` column to push_subscriptions so each
-- browser/device can opt OUT of specific notification kinds without
-- unsubscribing entirely.
--
-- Shape :
--   {
--     "all": true,                  -- master switch
--     "kill_of_the_week": true,
--     "kill": true,                 -- highlight clip published
--     "editorial_pin": true,
--     "live_match": true,
--     "broadcast": true,            -- generic admin broadcast
--     "system": true                -- maintenance / downtime
--   }
--
-- Defaults to {"all": true}. The push_notifier honours this :
--   * preferences.all === false                  → skip every kind
--   * preferences[notification.kind] === false   → skip THIS kind only
--   * key missing                                → opt-IN by default
--
-- We keep it as JSONB (not boolean columns) because the notification
-- kind list grows organically — adding "first_blood_alert" tomorrow
-- doesn't need a schema migration.

ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{"all": true}'::jsonb;

-- Backfill any pre-PR21 row that already had NULL.
UPDATE push_subscriptions
   SET preferences = '{"all": true}'::jsonb
 WHERE preferences IS NULL;

COMMENT ON COLUMN push_subscriptions.preferences IS
    'Per-subscription opt-out map. "all":false silences everything ; '
    '"<kind>":false silences only that kind. Missing key = opt-in.';

-- Helpful index for the worker query that filters out fully-silenced subs.
-- Predicate index keeps it tiny (only stores rows where all=false).
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_silenced
    ON push_subscriptions ((preferences->>'all'))
 WHERE (preferences->>'all') = 'false';
