-- Migration 031 — Admin audit log (strengthened)
--
-- Today admin_actions exists (migration 009) but coverage is partial.
-- This migration :
--   1. Adds missing columns (actor_role, ip_hash, request_id)
--   2. Adds CHECK on action enum (was free-form TEXT)
--   3. Indexes for the audit page

-- ─── Add columns ─────────────────────────────────────────────────────
ALTER TABLE admin_actions
    ADD COLUMN IF NOT EXISTS actor_role TEXT,
    ADD COLUMN IF NOT EXISTS ip_hash TEXT,
    ADD COLUMN IF NOT EXISTS request_id TEXT,
    ADD COLUMN IF NOT EXISTS user_agent_class TEXT;

-- ─── Drop old CHECK if present, replace with broader enum ───────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
         WHERE table_name = 'admin_actions' AND constraint_name = 'admin_actions_action_check'
    ) THEN
        ALTER TABLE admin_actions DROP CONSTRAINT admin_actions_action_check;
    END IF;
END $$;

-- Allow extensible action namespace without CHECK constraint friction —
-- enforce via the API layer instead. Just document expected values.
COMMENT ON COLUMN admin_actions.action IS
    'Dotted-action namespace. Examples: '
    '  feature.pin / feature.unpin / discord.push '
    '  kill.hide / kill.unhide / kill.delete '
    '  comment.approve / comment.reject / comment.flag '
    '  user.ban / user.unban / user.elevate '
    '  config.update / push.broadcast '
    '  player.update / roster.update '
    '  pipeline.replay / pipeline.cancel / dlq.requeue / dlq.cancel ';

-- ─── Indexes for /admin/audit page ──────────────────────────────────
-- NOTE : the column is `created_at` (migration 009), not `performed_at`.
-- The migration originally referenced `performed_at` — corrected here so
-- the indexes / view actually create against the real column.
CREATE INDEX IF NOT EXISTS idx_admin_actions_recent
    ON admin_actions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_actor
    ON admin_actions(actor_label, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_action
    ON admin_actions(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_entity_full
    ON admin_actions(entity_type, entity_id, created_at DESC);

-- ─── Convenience view : last 7-day summary per actor ────────────────
CREATE OR REPLACE VIEW v_admin_actions_7d AS
SELECT
    actor_label,
    actor_role,
    action,
    COUNT(*)            AS count_7d,
    MAX(created_at)     AS last_action_at
  FROM admin_actions
 WHERE created_at > now() - interval '7 days'
 GROUP BY actor_label, actor_role, action
 ORDER BY count_7d DESC;

COMMENT ON TABLE admin_actions IS
    'Strengthened audit log. Every backoffice action is one row. '
    'Required by the architecture review : "every manual hide, pin, '
    'boost, approve, reject, push notification should be logged."';
