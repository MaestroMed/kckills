-- Migration 032 — User-triggered reports table
--
-- Powers the "..." report button on each kill, comment and community
-- clip. Replaces the partial coverage today : `comment_reports` exists
-- (migration 009-ish) but has no kill / community_clip equivalent, and
-- the architecture review's "user-triggered QC" + "self-healing" loop
-- needs a unified queue admins can triage from one page.
--
-- Wiring :
--   1. Frontend ReportButton POSTs to /api/report
--   2. Endpoint INSERTs a row here AND enqueues a `qc.verify`
--      pipeline_jobs row so the worker re-checks the target
--   3. qc_sampler.compute_qc_risk reads pending count → +1.0 risk bump
--      (+0.5 extra at >= 3 reports, "very confident bad")
--   4. Admin page /admin/moderation/reports groups by target so 5
--      reports of the same kill show as 1 row with "5 reports".
--
-- Rate-limit strategy : the unique partial index below blocks duplicate
-- pending reports from the same (auth user OR localStorage anon id) for
-- the same target. Future improvement = per-IP throttle in the API
-- layer.
--
-- RLS : INSERT is fully open (anon allowed). No public READ policy is
-- defined, which means the anon role gets nothing back from SELECT.
-- The admin endpoint uses requireAdmin() and reads via the cookie-
-- bound service client.

CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- What is being reported
    target_type TEXT NOT NULL CHECK (target_type IN ('kill', 'comment', 'community_clip')),
    target_id TEXT NOT NULL,
    -- Reporter (anon allowed — at least one of these must be set,
    -- enforced at the API layer not at the DB level so a future
    -- "anonymous-anonymous" path stays open if needed).
    reporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reporter_anon_id TEXT,           -- localStorage UUID
    reporter_ip_hash TEXT,           -- SHA-256 of remote IP, never raw
    -- Reason
    reason_code TEXT NOT NULL CHECK (reason_code IN (
        'wrong_clip',          -- the clip doesn't show what's claimed
        'no_kill_visible',     -- says "kill" but you can't see it
        'wrong_player',        -- killer/victim mislabeled
        'spam',                -- comment spam
        'toxic',               -- toxic comment
        'other'
    )),
    reason_text TEXT,                -- optional free-form, max 500 chars
    -- Triage
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'actioned', 'dismissed'
    )),
    actioned_by TEXT,                -- admin label
    actioned_at TIMESTAMPTZ,
    action_taken TEXT,               -- what they did : 'hide' | 'requeue' | 'dismiss'
    --
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cap free-form text length (also enforced at the API layer).
ALTER TABLE reports
    DROP CONSTRAINT IF EXISTS reports_reason_text_length;
ALTER TABLE reports
    ADD CONSTRAINT reports_reason_text_length
    CHECK (reason_text IS NULL OR length(reason_text) <= 500);

-- ─── Indexes ─────────────────────────────────────────────────────────
-- Pending feed for the admin moderation page : "what should I look at
-- right now". Filtered partial index keeps it tiny since most rows
-- eventually transition out of `pending`.
CREATE INDEX IF NOT EXISTS idx_reports_pending
    ON reports(target_type, created_at DESC)
    WHERE status = 'pending';

-- Lookup by target — used by qc_sampler.compute_qc_risk and by
-- admin "show all reports for this kill" drill-in.
CREATE INDEX IF NOT EXISTS idx_reports_target
    ON reports(target_type, target_id);

-- Rate limit : prevent spam — one *pending* report per (target, reporter).
-- COALESCE so the index treats a logged-in user's UUID and an anon's
-- localStorage id as equivalent identity tokens. After triage the row
-- moves out of `pending` (action_taken set) and the user can re-report
-- if the issue recurs — which is exactly the self-healing loop we want.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_one_per_user_per_target
    ON reports(target_type, target_id, COALESCE(reporter_id::text, reporter_anon_id))
    WHERE status = 'pending';

-- ─── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone insert reports" ON reports;
CREATE POLICY "Anyone insert reports" ON reports
    FOR INSERT
    WITH CHECK (true);

-- No public SELECT policy — anon users get nothing back.
-- Admin endpoint reads via cookie-bound service-role client which
-- bypasses RLS.

COMMENT ON TABLE reports IS
    'PR-reports — user-triggered reports for kills, comments, and '
    'community clips. Powers the self-healing QC loop (qc_sampler '
    'reads pending count) and the admin moderation surface.';

COMMENT ON COLUMN reports.reason_code IS
    'Enum of reasons. wrong_clip / no_kill_visible / wrong_player '
    'apply to kills ; spam / toxic apply to comments ; other is the '
    'catch-all.';

COMMENT ON COLUMN reports.reporter_anon_id IS
    'localStorage UUID for anonymous reporters. Paired with '
    'reporter_id in the unique index so logged-in and anon reporters '
    'are treated as the same identity token for rate-limit purposes.';
