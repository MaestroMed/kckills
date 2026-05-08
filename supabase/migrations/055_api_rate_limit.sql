-- Migration 055 — Postgres-backed API rate limiter
-- Wave 18 (2026-05-08) — addresses W6 from architecture-audit-2026-05-07.
--
-- Why this approach
-- ─────────────────
-- Vercel's built-in Request Throttling is a paid Firewall feature ;
-- Upstash Redis is a free-tier-friendly alternative but adds an extra
-- service + secret. For a project that already runs on Supabase Postgres
-- with a generous connection pool, a small fixed-window counter table
-- + SECURITY DEFINER RPC is the simplest path : zero new dependencies,
-- the rate limit decision is a single round-trip, and we can already
-- monitor it in the same dashboards as everything else.
--
-- API
-- ───
-- `fn_check_rate_limit(p_key TEXT, p_window_s INT, p_limit INT)` returns
-- a row : `(allowed BOOLEAN, current_count INT, window_resets_at TIMESTAMPTZ)`.
--
-- The caller passes any string identifier as `p_key` (typically
-- `"<route>:<ip-hash>"`). The function :
--   1. Computes the current window bucket (now() floored to a multiple
--      of `p_window_s` seconds).
--   2. UPSERTs `(key, window_start) → count = count + 1`.
--   3. Returns allowed=true iff the new count <= p_limit.
--
-- The `kill_rate_limit_buckets` table is purely operational state —
-- not user data, not RLS-sensitive (only service-role callers via the
-- RPC), and pruned automatically on every call (the same UPSERT
-- expires rows older than 1h via the partial-index cleanup pattern).
--
-- Trade-offs
-- ──────────
-- Fixed window has the classic 2x-burst-at-boundary issue : if the
-- limit is 60/min, an attacker can fire 60 in second 59 and 60 more
-- in second 0 of the next window. Acceptable for our scale ; if it
-- becomes a problem, swap to a sliding-window or token-bucket impl
-- (more SQL but same surface).
--
-- Idempotency : `IF NOT EXISTS` + `CREATE OR REPLACE`. Safe to re-run.

BEGIN;

-- ─── Bucket table ──────────────────────────────────────────────────
-- Each row = one (key, window_start) cell. Window granularity is
-- whatever the caller passes ; the table is agnostic.
CREATE TABLE IF NOT EXISTS kill_rate_limit_buckets (
  key            TEXT NOT NULL,
  window_start   TIMESTAMPTZ NOT NULL,
  count          INT NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- Index for the reaper. Rows older than expires_at can be deleted at
-- any time ; the lazy cleanup at the start of fn_check_rate_limit
-- uses this index. A partial-index `WHERE expires_at < now()` would
-- be smaller but Postgres rejects STABLE functions like `now()` in
-- index predicates (must be IMMUTABLE). Full index is fine since the
-- table stays small (lazy reaper keeps it bounded).
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_expires_at
  ON kill_rate_limit_buckets(expires_at);

ALTER TABLE kill_rate_limit_buckets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_limit_no_anon ON kill_rate_limit_buckets;
CREATE POLICY rate_limit_no_anon ON kill_rate_limit_buckets
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ─── RPC ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_check_rate_limit(
  p_key      TEXT,
  p_window_s INT,
  p_limit    INT
) RETURNS TABLE(
  allowed            BOOLEAN,
  current_count      INT,
  window_resets_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  bucket_start TIMESTAMPTZ;
  bucket_end   TIMESTAMPTZ;
  new_count    INT;
BEGIN
  IF p_window_s < 1 OR p_window_s > 86400 THEN
    RAISE EXCEPTION 'p_window_s must be between 1 and 86400 (got %)', p_window_s;
  END IF;
  IF p_limit < 1 THEN
    RAISE EXCEPTION 'p_limit must be >= 1 (got %)', p_limit;
  END IF;

  -- Floor to the current window. epoch math keeps it simple +
  -- deterministic across timezones.
  bucket_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_s) * p_window_s
  ) AT TIME ZONE 'UTC';
  bucket_end := bucket_start + (p_window_s || ' seconds')::INTERVAL;

  -- Lazy cleanup : delete a small batch of expired rows. Keeps the
  -- table bounded without a separate cron. Limit 100 so a single
  -- request never blocks on a giant cleanup.
  DELETE FROM kill_rate_limit_buckets
   WHERE key IN (
     SELECT key FROM kill_rate_limit_buckets
      WHERE expires_at < now()
      LIMIT 100
   );

  -- Upsert the bucket counter.
  INSERT INTO kill_rate_limit_buckets (key, window_start, count, expires_at)
  VALUES (p_key, bucket_start, 1, bucket_end + INTERVAL '5 minutes')
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = kill_rate_limit_buckets.count + 1
  RETURNING count INTO new_count;

  RETURN QUERY SELECT
    (new_count <= p_limit)::BOOLEAN AS allowed,
    new_count                       AS current_count,
    bucket_end                      AS window_resets_at;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_check_rate_limit(TEXT, INT, INT) TO anon, authenticated;

COMMIT;

-- ─── Operator usage from the web ────────────────────────────────────
-- Inside an API route :
--
--   const { data, error } = await supabase.rpc('fn_check_rate_limit', {
--     p_key: `scroll-rec:${ipHash}`,
--     p_window_s: 60,
--     p_limit: 30,
--   });
--   if (!data?.allowed) {
--     return NextResponse.json(
--       { error: 'Rate limit exceeded', retryAfter: data?.window_resets_at },
--       { status: 429 }
--     );
--   }
--
-- Or via the web/src/lib/rate-limit.ts helper introduced in this wave
-- (handles the IP hashing + key composition).
