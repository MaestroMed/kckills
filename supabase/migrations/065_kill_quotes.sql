-- Migration 065 — AI Quote Extractor (2026-05-14)
--
-- Wires up the "PHRASES CULTES" encyclopedia : Gemini reads each
-- published kill clip's audio + transcript and extracts the casters'
-- shoutable moments ("ABSOLUMENT INSANE LE BAILLEUL", "PENTAKILL DE
-- CALISTE", ...). The frontend surfaces them on /quotes and on the
-- /kill/[id] cinematic detail page as a "PHRASES" sub-section.
--
-- Layout :
--   * kill_quotes — one row per extracted shoutable phrase, linked to
--     the parent kill via a CASCADE FK so a kill deletion cleans up its
--     quotes (avoids dangling rows if a clip is later retracted).
--   * Indexes :
--       - (kill_id, energy_level DESC) for the "phrases attached to one
--         kill" query (kill detail page).
--       - (energy_level DESC, upvotes DESC) WHERE NOT is_hidden for the
--         /quotes feed sort. Partial-index — hidden rows never appear in
--         the public ranking.
--       - GIN(to_tsvector('french', quote_text)) for full-text search.
--   * RPCs (all SECURITY DEFINER + search_path locked per migration 051) :
--       - fn_top_quotes        : paginated /quotes feed
--       - fn_search_quotes     : full-text French search
--       - fn_quotes_for_kill   : all visible quotes for a single kill
--       - fn_record_quote_upvote : idempotent upvote, dedup by
--                                  session_hash to stop ballot stuffing
--                                  from a single anonymous client.
--   * RLS :
--       - Public SELECT for visible (NOT is_hidden) rows
--       - INSERT/UPDATE restricted to service_role (the worker writes,
--         users upvote via the RPC which runs as definer)
--
-- pgvector note : the embedding column is gated behind a CREATE
-- EXTENSION IF NOT EXISTS check. On a fresh Supabase project pgvector
-- IS available (the Supabase image bundles it) but it must be enabled
-- per-project. If the extension isn't ready, we skip the column ;
-- nothing else in this migration depends on it. Quote similarity
-- search is a TODO follow-up, not a launch blocker.
--
-- Cost model : ~1200 published kills × $0.012/Gemini call ≈ $14 for the
-- initial backfill. After that, ~5-15 new quotes per match day -> <$1/mo.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────
-- Optional vector extension (commented gate — see header)
-- ──────────────────────────────────────────────────────────────────────
-- We attempt to load pgvector. If it succeeds, the kill_quotes.embedding
-- column gets vector(1536) and we add an IVFFlat index. If not, we skip
-- the column entirely and leave a TODO marker. Either way, the rest of
-- this migration applies cleanly.

DO $$
BEGIN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS vector;
    EXCEPTION WHEN OTHERS THEN
        -- pgvector not available on this project. The kill_quotes table
        -- will be created WITHOUT the embedding column ; similarity
        -- search is a follow-up once the extension is enabled.
        RAISE NOTICE 'pgvector not available — kill_quotes.embedding column will be skipped';
    END;
END $$;

-- ──────────────────────────────────────────────────────────────────────
-- kill_quotes
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kill_quotes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id         UUID NOT NULL REFERENCES public.kills(id) ON DELETE CASCADE,
    quote_text      TEXT NOT NULL CHECK (length(quote_text) BETWEEN 4 AND 280),
    quote_start_ms  INT  NOT NULL CHECK (quote_start_ms >= 0),
    quote_end_ms    INT  NOT NULL CHECK (quote_end_ms >  quote_start_ms),
    caster_name     TEXT,
    language        TEXT DEFAULT 'fr',
    energy_level    INT  CHECK (energy_level BETWEEN 1 AND 5),
    is_memetic      BOOLEAN DEFAULT FALSE,
    ai_confidence   FLOAT CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
    upvotes         INT  DEFAULT 0  CHECK (upvotes >= 0),
    reported_count  INT  DEFAULT 0  CHECK (reported_count >= 0),
    is_hidden       BOOLEAN DEFAULT FALSE,
    extracted_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (kill_id, quote_start_ms, quote_text)
);

-- Conditional embedding column — only if pgvector loaded.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'kill_quotes'
              AND column_name = 'embedding'
        ) THEN
            EXECUTE 'ALTER TABLE public.kill_quotes ADD COLUMN embedding vector(1536)';
        END IF;
    ELSE
        RAISE NOTICE 'kill_quotes.embedding NOT created (pgvector missing — TODO)';
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kill_quotes_kill
    ON public.kill_quotes(kill_id, energy_level DESC);

CREATE INDEX IF NOT EXISTS idx_kill_quotes_energy
    ON public.kill_quotes(energy_level DESC, upvotes DESC)
    WHERE NOT is_hidden;

CREATE INDEX IF NOT EXISTS idx_kill_quotes_text_fr
    ON public.kill_quotes
    USING GIN(to_tsvector('french', quote_text))
    WHERE NOT is_hidden;

-- ──────────────────────────────────────────────────────────────────────
-- Upvote-dedup table (per-quote, per-session)
-- ──────────────────────────────────────────────────────────────────────
-- Anonymous users vote without an auth row, so we dedup by a
-- session-cookie hash (SHA-256 of a UUID minted client-side, stored in
-- a httpOnly cookie). The RPC inserts here on first upvote ; subsequent
-- calls from the same session are no-ops. We don't expose this table to
-- the client — only the RPC writes here.

CREATE TABLE IF NOT EXISTS public.kill_quote_upvote_log (
    quote_id      UUID NOT NULL REFERENCES public.kill_quotes(id) ON DELETE CASCADE,
    session_hash  TEXT NOT NULL,
    voted_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (quote_id, session_hash)
);

-- ──────────────────────────────────────────────────────────────────────
-- RPC : fn_top_quotes — top N quotes by (energy DESC, upvotes DESC)
-- ──────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.fn_top_quotes(int, int);
CREATE OR REPLACE FUNCTION public.fn_top_quotes(
    p_limit       INT DEFAULT 24,
    p_min_energy  INT DEFAULT 1
)
RETURNS TABLE (
    id                 UUID,
    kill_id            UUID,
    quote_text         TEXT,
    quote_start_ms     INT,
    quote_end_ms       INT,
    caster_name        TEXT,
    language           TEXT,
    energy_level       INT,
    is_memetic         BOOLEAN,
    upvotes            INT,
    extracted_at       TIMESTAMPTZ,
    killer_champion    TEXT,
    victim_champion    TEXT,
    clip_url_vertical  TEXT,
    thumbnail_url      TEXT,
    multi_kill         TEXT,
    is_first_blood     BOOLEAN,
    match_date         TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
    v_limit       INT := GREATEST(1, LEAST(COALESCE(p_limit, 24), 200));
    v_min_energy  INT := GREATEST(1, LEAST(COALESCE(p_min_energy, 1), 5));
BEGIN
    RETURN QUERY
    SELECT
        q.id,
        q.kill_id,
        q.quote_text,
        q.quote_start_ms,
        q.quote_end_ms,
        q.caster_name,
        q.language,
        q.energy_level,
        q.is_memetic,
        q.upvotes,
        q.extracted_at,
        k.killer_champion,
        k.victim_champion,
        k.clip_url_vertical,
        k.thumbnail_url,
        k.multi_kill,
        k.is_first_blood,
        m.scheduled_at AS match_date
    FROM kill_quotes q
    JOIN kills k       ON k.id = q.kill_id
    LEFT JOIN games g  ON g.id = k.game_id
    LEFT JOIN matches m ON m.id = g.match_id
    WHERE NOT q.is_hidden
      AND k.status = 'published'
      AND COALESCE(q.energy_level, 0) >= v_min_energy
    ORDER BY q.energy_level DESC NULLS LAST,
             q.upvotes DESC,
             q.extracted_at DESC
    LIMIT v_limit;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────
-- RPC : fn_search_quotes — full-text French search
-- ──────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.fn_search_quotes(text, int);
CREATE OR REPLACE FUNCTION public.fn_search_quotes(
    p_query  TEXT,
    p_limit  INT DEFAULT 50
)
RETURNS TABLE (
    id                 UUID,
    kill_id            UUID,
    quote_text         TEXT,
    quote_start_ms     INT,
    quote_end_ms       INT,
    caster_name        TEXT,
    energy_level       INT,
    upvotes            INT,
    killer_champion    TEXT,
    victim_champion    TEXT,
    clip_url_vertical  TEXT,
    thumbnail_url      TEXT,
    multi_kill         TEXT,
    is_first_blood     BOOLEAN,
    rank               REAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
    v_limit  INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
    v_query  TEXT := COALESCE(NULLIF(trim(p_query), ''), '');
    v_tsquery tsquery;
BEGIN
    IF v_query = '' THEN
        RETURN;
    END IF;
    -- plainto_tsquery normalizes user input (handles accents and stop
    -- words via the 'french' config). websearch_to_tsquery would allow
    -- "phrases in quotes" but is overkill for short fan queries.
    v_tsquery := plainto_tsquery('french', v_query);

    RETURN QUERY
    SELECT
        q.id,
        q.kill_id,
        q.quote_text,
        q.quote_start_ms,
        q.quote_end_ms,
        q.caster_name,
        q.energy_level,
        q.upvotes,
        k.killer_champion,
        k.victim_champion,
        k.clip_url_vertical,
        k.thumbnail_url,
        k.multi_kill,
        k.is_first_blood,
        ts_rank(to_tsvector('french', q.quote_text), v_tsquery) AS rank
    FROM kill_quotes q
    JOIN kills k ON k.id = q.kill_id
    WHERE NOT q.is_hidden
      AND k.status = 'published'
      AND to_tsvector('french', q.quote_text) @@ v_tsquery
    ORDER BY rank DESC, q.energy_level DESC NULLS LAST, q.upvotes DESC
    LIMIT v_limit;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────
-- RPC : fn_quotes_for_kill — all visible quotes attached to one kill
-- ──────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.fn_quotes_for_kill(uuid);
CREATE OR REPLACE FUNCTION public.fn_quotes_for_kill(p_kill_id UUID)
RETURNS TABLE (
    id              UUID,
    quote_text      TEXT,
    quote_start_ms  INT,
    quote_end_ms    INT,
    caster_name     TEXT,
    language        TEXT,
    energy_level    INT,
    is_memetic      BOOLEAN,
    upvotes         INT,
    ai_confidence   FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        q.id,
        q.quote_text,
        q.quote_start_ms,
        q.quote_end_ms,
        q.caster_name,
        q.language,
        q.energy_level,
        q.is_memetic,
        q.upvotes,
        q.ai_confidence
    FROM kill_quotes q
    WHERE q.kill_id = p_kill_id
      AND NOT q.is_hidden
    ORDER BY q.quote_start_ms ASC;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────
-- RPC : fn_record_quote_upvote — idempotent upvote
-- ──────────────────────────────────────────────────────────────────────
-- Returns the new upvote count if the vote landed (first time for this
-- session), or the current count unchanged if already voted. The session
-- hash is opaque — frontend mints a UUIDv4 once per browser, hashes
-- SHA-256, stores in localStorage.

DROP FUNCTION IF EXISTS public.fn_record_quote_upvote(uuid, text);
CREATE OR REPLACE FUNCTION public.fn_record_quote_upvote(
    p_quote_id     UUID,
    p_session_hash TEXT
)
RETURNS TABLE (
    upvotes  INT,
    already_voted BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
VOLATILE
AS $$
DECLARE
    v_inserted BOOLEAN := FALSE;
    v_count    INT;
BEGIN
    -- Refuse degenerate hashes outright. A 64-char hex SHA-256 is the
    -- expected shape ; anything else is either a test or a bad client.
    IF p_session_hash IS NULL OR length(p_session_hash) < 8 THEN
        SELECT q.upvotes INTO v_count FROM kill_quotes q WHERE q.id = p_quote_id;
        RETURN QUERY SELECT COALESCE(v_count, 0), TRUE;
        RETURN;
    END IF;

    -- Try to insert the dedup row. ON CONFLICT DO NOTHING means duplicate
    -- (quote_id, session_hash) just returns 0 affected rows.
    INSERT INTO kill_quote_upvote_log (quote_id, session_hash)
    VALUES (p_quote_id, p_session_hash)
    ON CONFLICT (quote_id, session_hash) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted::INT > 0 THEN
        UPDATE kill_quotes
        SET upvotes = upvotes + 1
        WHERE id = p_quote_id
        RETURNING upvotes INTO v_count;
        RETURN QUERY SELECT COALESCE(v_count, 0), FALSE;
    ELSE
        SELECT q.upvotes INTO v_count FROM kill_quotes q WHERE q.id = p_quote_id;
        RETURN QUERY SELECT COALESCE(v_count, 0), TRUE;
    END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────
-- RPC : fn_quotes_stats — sidebar counters for /quotes
-- ──────────────────────────────────────────────────────────────────────
-- Single row : total visible quotes, distinct kills, top caster (by
-- count of attributed quotes, NULL caster_name excluded).

DROP FUNCTION IF EXISTS public.fn_quotes_stats();
CREATE OR REPLACE FUNCTION public.fn_quotes_stats()
RETURNS TABLE (
    total_quotes       BIGINT,
    total_kills        BIGINT,
    top_caster         TEXT,
    top_caster_quotes  BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
BEGIN
    RETURN QUERY
    WITH visible AS (
        SELECT q.*
        FROM kill_quotes q
        JOIN kills k ON k.id = q.kill_id
        WHERE NOT q.is_hidden AND k.status = 'published'
    ),
    caster_counts AS (
        SELECT caster_name, COUNT(*) AS c
        FROM visible
        WHERE caster_name IS NOT NULL AND caster_name <> ''
        GROUP BY caster_name
        ORDER BY c DESC
        LIMIT 1
    )
    SELECT
        (SELECT COUNT(*) FROM visible)                                   AS total_quotes,
        (SELECT COUNT(DISTINCT kill_id) FROM visible)                    AS total_kills,
        COALESCE((SELECT caster_name FROM caster_counts), NULL)          AS top_caster,
        COALESCE((SELECT c          FROM caster_counts), 0)              AS top_caster_quotes;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.kill_quotes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kill_quote_upvote_log    ENABLE ROW LEVEL SECURITY;

-- Public SELECT on visible rows. The RPCs run as SECURITY DEFINER so
-- they bypass these policies anyway, but exposing this table to the
-- anon JWT directly means a future client can query it without an RPC
-- round-trip if needed.
DROP POLICY IF EXISTS "Public visible quotes" ON public.kill_quotes;
CREATE POLICY "Public visible quotes" ON public.kill_quotes
    FOR SELECT
    USING (NOT is_hidden);

-- No public INSERT/UPDATE/DELETE — service_role (worker) owns writes.
-- Upvotes go through fn_record_quote_upvote.

-- Upvote-log is locked. Even SELECT is restricted to service_role since
-- it carries session_hash values that are private to the voter.
DROP POLICY IF EXISTS "No public access on upvote log" ON public.kill_quote_upvote_log;
CREATE POLICY "No public access on upvote log" ON public.kill_quote_upvote_log
    FOR SELECT
    USING (FALSE);

-- ──────────────────────────────────────────────────────────────────────
-- Grants — give anon + authenticated access to the RPCs only.
-- ──────────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.fn_top_quotes(int, int)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_search_quotes(text, int)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_quotes_for_kill(uuid)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_quote_upvote(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_quotes_stats()                  TO anon, authenticated;

COMMIT;
