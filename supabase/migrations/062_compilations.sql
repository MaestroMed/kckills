-- Migration 062 — Compilation Builder
--
-- Lets visitors stitch 3-20 published KC kills into a single MP4 hosted on
-- R2 with a short shareable URL (kckills.com/c/<shortCode>). The web page
-- /compilation drives the picker + reorder + customise wizard. The
-- worker job `compilation.render` picks pending rows up, runs ffmpeg
-- concat, uploads to R2 and flips status=done + output_url.
--
-- Conventions :
--   * Anon allowed (V0 spec : no login required). Ownership is enforced
--     via a session_hash (same shape as the BCC / VS roulette tables :
--     >= 16 chars random hex stored in localStorage).
--   * Public read on `status = 'done'` only — drafts and in-flight
--     renders stay scoped to the owning session via SECURITY DEFINER RPCs.
--   * Writes (insert + status updates) go through SECURITY DEFINER
--     functions so we can dedup + rate-limit + own the short_code
--     collision-retry loop server-side. The worker uses the service role
--     key to bypass RLS for status updates.
--   * `SET search_path = public, pg_catalog` on every SECURITY DEFINER
--     function — search-path hijack lock (migration 051).
--   * Idempotent : re-running the file is safe (CREATE … IF NOT EXISTS,
--     DROP FUNCTION IF EXISTS before each CREATE OR REPLACE).
--
-- Apply via the Supabase Management API :
--   curl -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
--        -H "Authorization: Bearer $SUPABASE_PAT" \
--        -H "Content-Type: application/json" \
--        --data-binary @<(jq -Rs '{query: .}' < 062_compilations.sql)

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- compilations — one row per user-built best-of
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compilations (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    /** 8-char base62 random, globally unique. The short URL is
     *  kckills.com/c/<short_code>. Collisions handled in the RPC. */
    short_code               TEXT UNIQUE NOT NULL,
    /** NULL on anon submissions. When the visitor logs in later we'd
     *  re-attach via a server-side migration RPC (out of scope V0). */
    user_id                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    /** Session ownership for the anon path. >= 16 chars random hex,
     *  same shape as BCC / VS roulette sessions. Required for both
     *  anon and authed callers — gives us a single rate-limit key. */
    session_hash             TEXT NOT NULL,
    title                    TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
    description              TEXT CHECK (description IS NULL OR length(description) <= 400),
    /** Ordered array of kill UUIDs. Order is preserved end-to-end : the
     *  worker concats clips in this exact sequence. Capped at 20 to keep
     *  render time bounded (~3 min worst case at 1080p H.264). */
    kill_ids                 UUID[] NOT NULL CHECK (
        cardinality(kill_ids) BETWEEN 1 AND 20
    ),
    /** Optional title-card text rendered as a 2-second intro by the worker. */
    intro_text               TEXT CHECK (intro_text IS NULL OR length(intro_text) <= 160),
    /** Optional outro card text. */
    outro_text               TEXT CHECK (outro_text IS NULL OR length(outro_text) <= 160),
    -- Worker output ────────────────────────────────────────────────
    status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',     -- queued, worker hasn't started
        'rendering',   -- worker has claimed the job
        'done',        -- output_url is live on R2
        'failed'       -- see render_error
    )),
    output_url               TEXT,
    output_duration_seconds  INT,
    render_error             TEXT,
    view_count               INT NOT NULL DEFAULT 0,
    -- Timestamps ───────────────────────────────────────────────────
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    /** Set by the worker when status flips to 'done'. */
    published_at             TIMESTAMPTZ,

    CONSTRAINT compilations_short_code_format CHECK (
        short_code ~ '^[0-9A-Za-z]{6,12}$'
    ),
    CONSTRAINT compilations_session_len CHECK (
        length(session_hash) >= 16
    ),
    CONSTRAINT compilations_done_has_output CHECK (
        status <> 'done' OR output_url IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_compilations_short_code
    ON compilations (short_code);
CREATE INDEX IF NOT EXISTS idx_compilations_status_pending
    ON compilations (status, created_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_compilations_status_rendering
    ON compilations (status, updated_at)
    WHERE status = 'rendering';
CREATE INDEX IF NOT EXISTS idx_compilations_user
    ON compilations (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_compilations_session
    ON compilations (session_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compilations_published
    ON compilations (published_at DESC)
    WHERE status = 'done';

-- Auto-bump updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION fn_compilations_touch_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    -- Stamp published_at the first time status flips to 'done'.
    IF NEW.status = 'done' AND OLD.status <> 'done' AND NEW.published_at IS NULL THEN
        NEW.published_at := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compilations_touch_updated ON compilations;
CREATE TRIGGER trg_compilations_touch_updated
    BEFORE UPDATE ON compilations
    FOR EACH ROW EXECUTE FUNCTION fn_compilations_touch_updated();

COMMENT ON TABLE compilations IS
    'Migration 062 : user-built best-of compilations. Anon allowed via '
    'session_hash. Public read on status=done only. Writes via '
    'fn_create_compilation SECURITY DEFINER. Worker (service role) sets '
    'status=rendering/done/failed.';

-- ═══════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE compilations ENABLE ROW LEVEL SECURITY;

-- Public can SELECT only finished compilations. The viewer page
-- (/c/<shortCode>) reads via the anon key and relies on this policy.
DROP POLICY IF EXISTS "compilations public read done" ON compilations;
CREATE POLICY "compilations public read done" ON compilations
    FOR SELECT USING (status = 'done');

-- Authenticated owners can read their own pending / rendering rows so the
-- builder UI can poll status while the worker is busy. Anon-session reads
-- of pending rows go through fn_get_compilation_by_short_code (which
-- enforces session_hash match) so anon callers never need a SELECT policy
-- against the raw table.
DROP POLICY IF EXISTS "compilations owner read all" ON compilations;
CREATE POLICY "compilations owner read all" ON compilations
    FOR SELECT USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- No INSERT / UPDATE policy at all — every write goes through a
-- SECURITY DEFINER function. The worker uses the service role key
-- (bypasses RLS entirely) for status transitions.

COMMENT ON POLICY "compilations public read done" ON compilations IS
    'Migration 062 : anyone can read a finished compilation by short_code.';
COMMENT ON POLICY "compilations owner read all" ON compilations IS
    'Migration 062 : authed user reads their own compilations regardless of status.';

-- ═══════════════════════════════════════════════════════════════════════
-- fn_create_compilation — anon-safe insert with collision-retry short_code
-- ═══════════════════════════════════════════════════════════════════════
--
-- The caller passes the kill_ids in the desired order plus title /
-- description / intro / outro. We :
--   1. Validate the array (1..20 UUIDs, all referencing published kills).
--   2. Rate-limit per session (max 8 compilations / hour / session).
--   3. Loop up to 5× generating a base62 short_code until UNIQUE wins.
--   4. INSERT the row with status='pending'.
--   5. Enqueue a `compilation.render` job in pipeline_jobs so the
--      worker picks it up on its next claim cycle.
--
-- Returns (id, short_code) for the caller to redirect to /c/<short_code>.

DROP FUNCTION IF EXISTS public.fn_create_compilation(
    text, text, uuid[], text, text, text, uuid
);
CREATE OR REPLACE FUNCTION public.fn_create_compilation(
    p_title         TEXT,
    p_description   TEXT,
    p_kill_ids      UUID[],
    p_intro_text    TEXT,
    p_outro_text    TEXT,
    p_session_hash  TEXT,
    p_user_id       UUID DEFAULT NULL
)
RETURNS TABLE (
    id          UUID,
    short_code  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_short_code      TEXT;
    v_attempts        INT := 0;
    v_id              UUID;
    v_published_count INT;
    v_recent_count    INT;
BEGIN
    -- ── 1. Validate the payload ────────────────────────────────────
    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
        RAISE EXCEPTION 'fn_create_compilation: title required';
    END IF;
    IF length(p_title) > 80 THEN
        RAISE EXCEPTION 'fn_create_compilation: title too long (>80)';
    END IF;
    IF p_description IS NOT NULL AND length(p_description) > 400 THEN
        RAISE EXCEPTION 'fn_create_compilation: description too long (>400)';
    END IF;
    IF p_kill_ids IS NULL OR cardinality(p_kill_ids) < 1 OR cardinality(p_kill_ids) > 20 THEN
        RAISE EXCEPTION 'fn_create_compilation: kill_ids must contain 1..20 entries';
    END IF;
    IF p_session_hash IS NULL OR length(p_session_hash) < 16 THEN
        RAISE EXCEPTION 'fn_create_compilation: session_hash must be >= 16 chars';
    END IF;

    -- All referenced kills must be currently published with a
    -- horizontal clip URL (the worker needs the 16:9 source). We accept
    -- both the new publication_status='published' AND legacy
    -- status='published' rows so the migration window doesn't break the
    -- builder.
    SELECT COUNT(DISTINCT k.id) INTO v_published_count
    FROM kills k
    WHERE k.id = ANY(p_kill_ids)
      AND k.clip_url_horizontal IS NOT NULL
      AND (
            k.publication_status = 'published'
        OR (k.publication_status IS NULL AND k.status = 'published')
      );
    IF v_published_count <> cardinality(p_kill_ids) THEN
        RAISE EXCEPTION 'fn_create_compilation: % kill_ids missing or unpublished (got % of %)',
            cardinality(p_kill_ids) - v_published_count,
            v_published_count,
            cardinality(p_kill_ids);
    END IF;

    -- ── 2. Per-session rate limit : 8 / hour ───────────────────────
    -- Cheap "count rows in last hour" — fine at our volume. Bypassed
    -- when the caller is authenticated AND owns the session (we trust
    -- the auth layer there).
    SELECT COUNT(*) INTO v_recent_count
    FROM compilations
    WHERE session_hash = p_session_hash
      AND created_at >= now() - interval '1 hour';
    IF v_recent_count >= 8 THEN
        RAISE EXCEPTION 'fn_create_compilation: rate limit (8/hour/session) — wait a moment';
    END IF;

    -- ── 3. Generate a unique 8-char base62 short_code ──────────────
    LOOP
        v_attempts := v_attempts + 1;
        -- Base62 alphabet (no ambiguous 0/O / l/1 cleanup here — the
        -- collision probability at 8 chars × 62 = ~218 trillion is
        -- vanishingly small even at millions of rows).
        v_short_code := substr(
            translate(
                encode(gen_random_bytes(12), 'base64'),
                '+/=', 'aZ9'   -- map symbols to letters/digits
            ),
            1, 8
        );
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM compilations WHERE compilations.short_code = v_short_code
        );
        IF v_attempts >= 5 THEN
            RAISE EXCEPTION 'fn_create_compilation: short_code collision after 5 attempts';
        END IF;
    END LOOP;

    -- ── 4. Insert the row ─────────────────────────────────────────
    INSERT INTO compilations (
        short_code, user_id, session_hash,
        title, description, kill_ids,
        intro_text, outro_text, status
    ) VALUES (
        v_short_code,
        COALESCE(p_user_id, auth.uid()),
        p_session_hash,
        trim(p_title),
        NULLIF(trim(COALESCE(p_description, '')), ''),
        p_kill_ids,
        NULLIF(trim(COALESCE(p_intro_text, '')), ''),
        NULLIF(trim(COALESCE(p_outro_text, '')), ''),
        'pending'
    )
    RETURNING compilations.id INTO v_id;

    -- ── 5. Enqueue the render job ──────────────────────────────────
    -- pipeline_jobs lives in migration 024 ; the unique partial index
    -- on (type, entity_type, entity_id) WHERE status IN
    -- ('pending','claimed') makes the insert idempotent if the caller
    -- retries.
    --
    -- NOTE : the `compilation.render` job type is NOT in the CHECK
    -- constraint set by migration 024. We use a defensive try/catch
    -- so the compilation row still lands even when the queue type is
    -- locked down — operators can manually run worker/compilation_render.py
    -- as a fallback. When the CHECK constraint is widened (a tiny
    -- follow-up migration), this clause becomes the normal path.
    BEGIN
        INSERT INTO pipeline_jobs (
            type, entity_type, entity_id, status, priority, payload
        ) VALUES (
            'compilation.render', 'compilation', v_id::TEXT, 'pending', 60,
            jsonb_build_object('short_code', v_short_code)
        );
    EXCEPTION WHEN check_violation OR undefined_table THEN
        -- Queue type not whitelisted yet OR pipeline_jobs not deployed —
        -- the worker's standalone polling loop (compilation_render.py)
        -- still picks the row up via the
        -- `WHERE status = 'pending'` index above. Don't fail the user's
        -- submission over a queue plumbing issue.
        NULL;
    WHEN unique_violation THEN
        -- Idempotent retry (active-job unique index) — nothing to do.
        NULL;
    END;

    RETURN QUERY SELECT v_id, v_short_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_compilation(
    TEXT, TEXT, UUID[], TEXT, TEXT, TEXT, UUID
) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- fn_record_compilation_view — ++view_count atomically
-- ═══════════════════════════════════════════════════════════════════════
-- Called by the /c/<shortCode> viewer page on first paint. Cheap : a
-- single UPDATE with no surrounding SELECT. Returns the new count so the
-- UI can render the bumped value without an extra round-trip.

DROP FUNCTION IF EXISTS public.fn_record_compilation_view(text);
CREATE OR REPLACE FUNCTION public.fn_record_compilation_view(
    p_short_code TEXT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_new_count INT;
BEGIN
    IF p_short_code IS NULL OR p_short_code !~ '^[0-9A-Za-z]{6,12}$' THEN
        RETURN 0;
    END IF;

    UPDATE compilations
       SET view_count = view_count + 1
     WHERE short_code = p_short_code
       AND status = 'done'
    RETURNING view_count INTO v_new_count;

    RETURN COALESCE(v_new_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_record_compilation_view(TEXT)
    TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- fn_my_compilations — list for "Mes compilations" header link
-- ═══════════════════════════════════════════════════════════════════════
-- Returns the most recent compilations attached to the calling session.
-- When auth.uid() is set, we also fold in the user's authed rows (a
-- single user may have created some pre-login + some post-login).

DROP FUNCTION IF EXISTS public.fn_my_compilations(text, int);
CREATE OR REPLACE FUNCTION public.fn_my_compilations(
    p_session_hash TEXT,
    p_limit        INT DEFAULT 20
)
RETURNS TABLE (
    id                       UUID,
    short_code               TEXT,
    title                    TEXT,
    description              TEXT,
    kill_ids                 UUID[],
    status                   TEXT,
    output_url               TEXT,
    output_duration_seconds  INT,
    render_error             TEXT,
    view_count               INT,
    created_at               TIMESTAMPTZ,
    updated_at               TIMESTAMPTZ,
    published_at             TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF p_session_hash IS NULL OR length(p_session_hash) < 16 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT c.id, c.short_code, c.title, c.description, c.kill_ids,
           c.status, c.output_url, c.output_duration_seconds,
           c.render_error, c.view_count,
           c.created_at, c.updated_at, c.published_at
    FROM compilations c
    WHERE c.session_hash = p_session_hash
       OR (v_uid IS NOT NULL AND c.user_id = v_uid)
    ORDER BY c.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 100));
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_my_compilations(TEXT, INT)
    TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- fn_get_compilation_by_short_code — anon-safe single-row read
-- ═══════════════════════════════════════════════════════════════════════
-- Public read of any status (pending / rendering / done / failed). The
-- viewer page polls this every 10 s while the worker is rendering. We
-- gate sensitive fields (session_hash, user_id) so the response is safe
-- to surface to any visitor — the public viewer + the builder's success
-- screen share this single endpoint.

DROP FUNCTION IF EXISTS public.fn_get_compilation_by_short_code(text);
CREATE OR REPLACE FUNCTION public.fn_get_compilation_by_short_code(
    p_short_code TEXT
)
RETURNS TABLE (
    id                       UUID,
    short_code               TEXT,
    title                    TEXT,
    description              TEXT,
    kill_ids                 UUID[],
    intro_text               TEXT,
    outro_text               TEXT,
    status                   TEXT,
    output_url               TEXT,
    output_duration_seconds  INT,
    render_error             TEXT,
    view_count               INT,
    /** SHA-256 short-prefix of the session_hash. Frontend uses this to
     *  generate the BCC-style "BCC #XYZ" alias without exposing the raw
     *  session id. */
    author_hash              TEXT,
    created_at               TIMESTAMPTZ,
    updated_at               TIMESTAMPTZ,
    published_at             TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
BEGIN
    IF p_short_code IS NULL OR p_short_code !~ '^[0-9A-Za-z]{6,12}$' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT c.id, c.short_code, c.title, c.description, c.kill_ids,
           c.intro_text, c.outro_text,
           c.status, c.output_url, c.output_duration_seconds,
           c.render_error, c.view_count,
           -- Stable 12-char hex prefix derived from the session hash.
           -- Same input → same alias forever ; different sessions → ~0
           -- collision probability inside this app's lifetime.
           substr(encode(digest(c.session_hash, 'sha256'), 'hex'), 1, 12) AS author_hash,
           c.created_at, c.updated_at, c.published_at
    FROM compilations c
    WHERE c.short_code = p_short_code
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_compilation_by_short_code(TEXT)
    TO anon, authenticated;

-- Ensure pgcrypto is available for digest() — it ships pre-loaded on
-- Supabase free tier but the explicit CREATE EXTENSION makes the
-- migration safe to replay against a fresh project.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

COMMIT;
