-- Migration 042 — Push throttle metadata (Wave 9 / PR-arch P2)
--
-- Adds the columns + indexes needed by the new throttle policy in
-- worker/services/push_throttle.py :
--
--   1. push_subscriptions.quiet_hours_start_utc / quiet_hours_end_utc
--      (INT 0-23, default 23 → 7 = 23h-7h UTC = 00h-08h Paris).
--      A NULL value means "no quiet hours configured" — the worker
--      falls back to the defaults.
--
--   2. push_deliveries.kind (TEXT) — denormalised copy of
--      push_notifications.kind so the throttle's "max N per window
--      per kind" lookback can be a single-table query without a join.
--      Backfilled from the parent row.
--
--   3. push_deliveries.coalesced_count (INT default 1) — when the
--      publisher batches K events into 1 notification, this is set
--      to K so analytics can recover the underlying event count.
--
--   4. INDEX idx_push_deliveries_throttle on
--      (subscription_id, kind, sent_at DESC) — the hot path query
--      from PushThrottle.should_send() : "how many pushes did this
--      subscription receive in the last N minutes for this kind?".
--
-- The migration is idempotent (`IF NOT EXISTS` everywhere) and
-- BACKWARDS COMPATIBLE — push_throttle.py probes for the columns
-- and degrades gracefully when 042 hasn't been applied yet (the
-- HTTP error or empty result from PostgREST short-circuits the
-- check and the throttle uses defaults).

-- ─── 1. Quiet hours on push_subscriptions ──────────────────
ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS quiet_hours_start_utc INT
        CHECK (quiet_hours_start_utc IS NULL OR (quiet_hours_start_utc BETWEEN 0 AND 23))
        DEFAULT 23;

ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS quiet_hours_end_utc INT
        CHECK (quiet_hours_end_utc IS NULL OR (quiet_hours_end_utc BETWEEN 0 AND 23))
        DEFAULT 7;

COMMENT ON COLUMN push_subscriptions.quiet_hours_start_utc IS
    'Hour-of-day UTC at which to silence pushes (0-23). Defaults to '
    '23 → 23h-7h UTC = 00h-08h Paris. NULL = no quiet hours.';
COMMENT ON COLUMN push_subscriptions.quiet_hours_end_utc IS
    'Hour-of-day UTC at which quiet hours end (0-23). Defaults to 7. '
    'Wrap-around supported (start=23, end=7 means 23h-7h).';

-- ─── 2. Denormalised kind on push_deliveries ───────────────
ALTER TABLE push_deliveries
    ADD COLUMN IF NOT EXISTS kind TEXT;

-- One-time backfill from the parent row. Cheap because push_deliveries
-- is small at this stage (a few hundred rows max in the pilot).
UPDATE push_deliveries d
   SET kind = n.kind
  FROM push_notifications n
 WHERE d.notification_id = n.id
   AND d.kind IS NULL;

COMMENT ON COLUMN push_deliveries.kind IS
    'Denormalised copy of push_notifications.kind so the throttle '
    'lookback can be a single-table query without a join.';

-- ─── 3. Coalescing counter ─────────────────────────────────
ALTER TABLE push_deliveries
    ADD COLUMN IF NOT EXISTS coalesced_count INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN push_deliveries.coalesced_count IS
    'How many real events this delivery represents (≥1). Set to N when '
    'the publisher batched N close-in-time kills into a single push.';

-- ─── 4. Hot-path lookback index ────────────────────────────
-- The throttle calls "SELECT count(*) FROM push_deliveries
--   WHERE subscription_id = $1 AND kind = $2 AND sent_at > now() - interval '15m'"
-- on every send attempt. With idx_push_deliveries_recent and
-- idx_push_deliveries_failed already present, this targeted index
-- on (subscription_id, kind, sent_at DESC) is the missing piece for
-- a sub-millisecond planner pick.
CREATE INDEX IF NOT EXISTS idx_push_deliveries_throttle
    ON push_deliveries(subscription_id, kind, sent_at DESC)
 WHERE status = 'sent';
