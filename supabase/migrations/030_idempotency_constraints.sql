-- Migration 030 — Idempotency UNIQUE constraints
--
-- Prevents duplicate work / rows when modules retry. The original
-- review called out :
--   "If the same job runs twice, does anything bad happen?"
--
-- Today : harvester re-running on a game CAN insert duplicate kills
-- (no UNIQUE constraint). Channel discoverer COULD insert duplicate
-- channel_videos (relies on app-side dedup).
--
-- This migration locks all those gates with DB-level constraints.

-- ─── kills : (game_id, killer_player_id, victim_player_id, event_epoch) ────
-- A kill is uniquely identified by game + killer + victim + timing.
-- Multi-source ingestion (livestats + gol_gg) on the same game would
-- otherwise produce 2 rows for the same kill. Use a partial index
-- because killer_player_id can be NULL (data-only entries) — those
-- get deduped by content_hash on the asset side.
--
-- WHY event_epoch (not game_time_seconds) — see CLAUDE.md §5.4. The
-- canonical timing is the absolute frame timestamp from the live
-- stats feed (rfc460Timestamp parsed → epoch). game_time_seconds is
-- a derived value (event_epoch − game_start_epoch) and CAN drift on
-- re-ingest if game_start_epoch is recomputed (e.g. when the
-- harvester picks a different draft-phase frame as t=0). epoch is
-- the fixed reference point and is what makes ingestion pause-proof
-- in the first place.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kills_unique_event
    ON kills(game_id, killer_player_id, victim_player_id, event_epoch)
    WHERE killer_player_id IS NOT NULL
      AND victim_player_id IS NOT NULL
      AND event_epoch IS NOT NULL;

-- ─── channel_videos : (id is already UUID YouTube video id, just enforce) ───
-- Already implicit via PK, just here for clarity.

-- ─── push_subscriptions : (subscription_json's endpoint must be unique) ───
-- Today the /api/push/subscribe endpoint dedupes app-side via ILIKE on
-- subscription_json. That's brittle — race condition produces dupes.
-- Add a generated column extracting the endpoint and constrain it.
ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS endpoint TEXT GENERATED ALWAYS AS (
        (subscription_json::jsonb ->> 'endpoint')
    ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
    ON push_subscriptions(endpoint)
    WHERE endpoint IS NOT NULL;

-- ─── ratings : (kill_id, user_id) ──────────────────────────────────
-- Already enforced via UNIQUE in migration 001 — this is just a noop guard.
-- (Defensive : if migration 001 was edited / re-run on a system that
-- skipped the constraint, this re-creates it.)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename = 'ratings'
           AND indexdef LIKE '%kill_id%user_id%'
    ) THEN
        CREATE UNIQUE INDEX idx_ratings_unique_user_kill
            ON ratings(kill_id, user_id);
    END IF;
END $$;

-- ─── matches : (external_id) ─────────────────────────────────────
-- Migration 001 already declared UNIQUE on external_id. Defensive re-add.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename = 'matches'
           AND indexdef LIKE '%external_id%'
           AND indexdef LIKE '%UNIQUE%'
    ) THEN
        CREATE UNIQUE INDEX idx_matches_external_id
            ON matches(external_id);
    END IF;
END $$;

-- ─── games : (external_id) ───────────────────────────────────────
-- Same defensive guard.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename = 'games'
           AND indexdef LIKE '%external_id%'
           AND indexdef LIKE '%UNIQUE%'
    ) THEN
        CREATE UNIQUE INDEX idx_games_external_id
            ON games(external_id);
    END IF;
END $$;

COMMENT ON INDEX idx_kills_unique_event IS
    'Idempotency : multi-source ingestion of the same game cannot insert '
    'duplicate kill rows for the same (game, killer, victim, time) tuple.';
