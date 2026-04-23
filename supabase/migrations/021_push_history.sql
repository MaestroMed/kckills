-- Migration 021 — Push notification history (PR16)
--
-- Adds two tables that turn the existing one-shot push system
-- (push_subscriptions + sw.js push handler) into an auditable,
-- de-dupable broadcast pipeline :
--
--   1. push_notifications  — one row PER NOTIFICATION SENT (broadcast).
--                            Lets the editor see what went out, when,
--                            and who clicked through.
--
--   2. push_deliveries     — one row PER (notification × subscription)
--                            pair. Tracks per-recipient outcome :
--                            sent / failed / 410-gone (subscription
--                            expired, prune from push_subscriptions).
--
-- Idempotency : push_notifications carries a `dedupe_key` (e.g.
-- "kotw:2026-w17", "kill:<uuid>") so we can refuse to re-broadcast the
-- same logical event twice — the worker module checks this before
-- sending Sunday's KOTW push.

-- ─── 1. Notifications (one per broadcast) ──────────────────
CREATE TABLE IF NOT EXISTS push_notifications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Editorial categorisation
    kind          TEXT NOT NULL CHECK (kind IN (
                      'kill',           -- highlight clip published
                      'kill_of_the_week',
                      'editorial_pin',  -- admin manual pin
                      'live_match',     -- KC entered a live game
                      'broadcast',      -- generic admin broadcast
                      'system'          -- maintenance, downtime, etc.
                  )),
    dedupe_key    TEXT UNIQUE,           -- NULL = no dedupe (per-event broadcast)
    -- Payload
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    url           TEXT NOT NULL,         -- click-through target
    icon_url      TEXT,                  -- optional override (default = /icons/icon-192x192.png)
    image_url     TEXT,                  -- optional rich preview (Web Push image)
    -- Metadata
    kill_id       UUID REFERENCES kills(id) ON DELETE SET NULL,
    sent_by       TEXT,                  -- "admin" | "kill_of_the_week" | etc.
    -- Aggregate stats (denormalised — updated by worker after a send)
    target_count  INT NOT NULL DEFAULT 0,
    sent_count    INT NOT NULL DEFAULT 0,
    failed_count  INT NOT NULL DEFAULT 0,
    expired_count INT NOT NULL DEFAULT 0,
    -- Timestamps
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_notifications_recent
    ON push_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_notifications_kind
    ON push_notifications(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_notifications_kill
    ON push_notifications(kill_id) WHERE kill_id IS NOT NULL;

COMMENT ON TABLE push_notifications IS
    'One row per push broadcast. Carries dedupe_key for idempotency '
    '(e.g. "kotw:2026-w17") and aggregate per-broadcast stats.';

-- ─── 2. Deliveries (one per recipient) ─────────────────────
CREATE TABLE IF NOT EXISTS push_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID REFERENCES push_notifications(id) ON DELETE CASCADE NOT NULL,
    subscription_id UUID REFERENCES push_subscriptions(id) ON DELETE CASCADE,
    -- Outcome
    status          TEXT NOT NULL CHECK (status IN ('sent','failed','expired')),
    http_status     INT,
    error_message   TEXT,
    -- Timestamps
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_deliveries_notif
    ON push_deliveries(notification_id);
CREATE INDEX IF NOT EXISTS idx_push_deliveries_recent
    ON push_deliveries(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_deliveries_failed
    ON push_deliveries(status, sent_at DESC) WHERE status != 'sent';

COMMENT ON TABLE push_deliveries IS
    'One row per (notification × subscription) pair. status=expired '
    'means the subscription returned HTTP 404/410 — its row in '
    'push_subscriptions should be pruned.';

-- ─── 3. Enable RLS on the new tables ───────────────────────
ALTER TABLE push_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_deliveries ENABLE ROW LEVEL SECURITY;

-- ─── 4. Convenience view for the admin dashboard ───────────
-- Latest 50 broadcasts with their kill context (if any).
CREATE OR REPLACE VIEW v_recent_push_notifications AS
SELECT n.id, n.kind, n.title, n.body, n.url, n.kill_id,
       n.sent_by, n.target_count, n.sent_count, n.failed_count,
       n.expired_count, n.created_at, n.sent_at,
       k.killer_champion, k.victim_champion, k.thumbnail_url
  FROM push_notifications n
  LEFT JOIN kills k ON k.id = n.kill_id
 ORDER BY n.created_at DESC
 LIMIT 50;
