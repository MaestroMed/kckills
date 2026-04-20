-- ═══════════════════════════════════════════════════════════════════
-- 009 — Admin backoffice foundation
--
-- Phase 1 additions: audit trail + kill re-clip flag.
-- Later phases add: worker_jobs, featured_clips, comment_reports.
-- All tables are additive; no existing column changes.
-- ═══════════════════════════════════════════════════════════════════

-- ─── admin_actions : audit trail ───────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_label TEXT,                 -- fallback identifier ('mehdi' for now)
    action TEXT NOT NULL,             -- 'kill.edit' | 'kill.bulk_hide' | 'comment.approve' | ...
    entity_type TEXT NOT NULL,        -- 'kill' | 'comment' | 'bgm' | 'featured' | ...
    entity_id TEXT,                   -- UUID or natural key
    before JSONB,                     -- snapshot pre-change
    after JSONB,                      -- snapshot post-change
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_recent
    ON admin_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_entity
    ON admin_actions(entity_type, entity_id);

-- RLS: service role only. Public can't read the audit log.
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

-- ─── kills.needs_reclip : re-clip queue flag ───────────────────────
ALTER TABLE kills ADD COLUMN IF NOT EXISTS needs_reclip BOOLEAN DEFAULT FALSE;
ALTER TABLE kills ADD COLUMN IF NOT EXISTS reclip_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_kills_needs_reclip
    ON kills(updated_at DESC)
    WHERE needs_reclip = TRUE;

-- ─── worker_jobs : admin → worker command queue ────────────────────
CREATE TABLE IF NOT EXISTS worker_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN (
        'reanalyze_kill',
        'reclip_kill',
        'regen_og',
        'regen_audit_targets',
        'backfill_assists_game',
        'reanalyze_backlog'
    )),
    payload JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    retry_count INT DEFAULT 0,
    requested_by_actor TEXT,
    requested_at TIMESTAMPTZ DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error TEXT,
    result JSONB
);
CREATE INDEX IF NOT EXISTS idx_worker_jobs_pending
    ON worker_jobs(requested_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_worker_jobs_recent
    ON worker_jobs(requested_at DESC);

ALTER TABLE worker_jobs ENABLE ROW LEVEL SECURITY;

-- ─── featured_clips : daily editorial pick ─────────────────────────
CREATE TABLE IF NOT EXISTS featured_clips (
    feature_date DATE PRIMARY KEY,
    kill_id UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
    set_by_actor TEXT,
    set_at TIMESTAMPTZ DEFAULT now(),
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_featured_kill ON featured_clips(kill_id);

ALTER TABLE featured_clips ENABLE ROW LEVEL SECURITY;

-- Public SELECT allowed — the homepage consumes featured_clips.
CREATE POLICY "Public featured read" ON featured_clips FOR SELECT USING (true);

-- ─── comment_reports : user-reported comments ──────────────────────
CREATE TABLE IF NOT EXISTS comment_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID REFERENCES comments(id) ON DELETE CASCADE NOT NULL,
    reporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL CHECK (reason IN ('toxic', 'spam', 'off_topic', 'other')),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comment_reports_pending
    ON comment_reports(created_at DESC);

ALTER TABLE comment_reports ENABLE ROW LEVEL SECURITY;

-- Authenticated users can insert a report on any comment.
CREATE POLICY "Auth insert comment report" ON comment_reports
    FOR INSERT WITH CHECK (auth.uid() = reporter_id);
