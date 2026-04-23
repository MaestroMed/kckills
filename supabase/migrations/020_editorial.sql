-- Migration 020 — Editorial layer (PR15)

-- ─── 1. Extend featured_clips with a time-range model ─────────────
ALTER TABLE featured_clips
    ADD COLUMN IF NOT EXISTS valid_from   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS valid_to     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS custom_note  TEXT,
    ADD COLUMN IF NOT EXISTS set_by       TEXT;

UPDATE featured_clips
   SET valid_from = (feature_date::timestamptz AT TIME ZONE 'UTC'),
       valid_to   = ((feature_date::timestamptz AT TIME ZONE 'UTC')
                     + INTERVAL '23 hours 59 minutes 59 seconds')
 WHERE valid_from IS NULL;

CREATE INDEX IF NOT EXISTS idx_featured_window
    ON featured_clips(valid_from, valid_to);

COMMENT ON COLUMN featured_clips.valid_from IS
    'Editorial window start (UTC). Range-based featured eligibility.';
COMMENT ON COLUMN featured_clips.valid_to IS
    'Editorial window end (UTC). NULL = open-ended (rare).';
COMMENT ON COLUMN featured_clips.custom_note IS
    'Optional editor blurb shown on the homepage hero.';
COMMENT ON COLUMN featured_clips.set_by IS
    'Identifier of who pinned this : "admin", "kill_of_the_week", or '
    'an admin email/discord-id when available.';

-- ─── 2. editorial_actions audit trail ─────────────────────────────
CREATE TABLE IF NOT EXISTS editorial_actions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action        TEXT NOT NULL CHECK (action IN (
                      'feature.pin',
                      'feature.unpin',
                      'discord.push',
                      'kill.hide',
                      'kill.unhide',
                      'kotw.auto_pick'
                  )),
    kill_id       UUID REFERENCES kills(id) ON DELETE SET NULL,
    performed_by  TEXT,
    performed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload       JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_editorial_actions_recent
    ON editorial_actions(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_editorial_actions_kill
    ON editorial_actions(kill_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_editorial_actions_action
    ON editorial_actions(action, performed_at DESC);

ALTER TABLE editorial_actions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE editorial_actions IS
    'Editorial-specific audit trail (feature pin, Discord push, hide). '
    'Separate from admin_actions so editor activity stays queryable '
    'without scanning generic admin events.';
