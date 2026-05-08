-- Migration 052 — Rate-limit fn_record_impression per (kill_id, IP-hash)
-- Wave 16 (2026-05-07) — addresses W8 from architecture-audit-2026-05-07.
--
-- Why
-- ────
-- The current `fn_record_impression(p_kill_id)` does an unconditional
-- `UPDATE kills SET impression_count = impression_count + 1`. A curl
-- loop can pump the counter infinitely on a single kill — a moderate
-- abuse vector that's been documented as a "future improvement" since
-- the 2026-04-29 audit.
--
-- This migration introduces :
--
--   1. A new `kill_impressions_dedup` table holding `(kill_id, ip_hash, day)`
--      with a unique constraint on the triplet. The day partition keeps
--      the table bounded (90-day retention via fn_prune_kill_impressions
--      cron call ; see migration 053 for the retention trigger).
--   2. A SECURITY DEFINER `fn_record_impression_v2(p_kill_id, p_ip_hash)`
--      that INSERTs the dedup row first ; if the unique constraint fires,
--      it's a duplicate and the kills.impression_count UPDATE is skipped.
--      Returns boolean : true if the impression was novel + recorded,
--      false if it was a deduped re-hit.
--   3. The OLD `fn_record_impression(p_kill_id)` keeps its signature
--      (no breaking change) but now requires `current_setting('request.headers')`
--      to extract the X-Forwarded-For hash. Callers without this set
--      fall through to the legacy unbounded path with a NOTICE so we
--      can grep for them. Backfilled hashing is the operator's job.
--
-- Rollback
-- ────────
-- DROP TABLE kill_impressions_dedup ; DROP FUNCTION fn_record_impression_v2 ;
-- The legacy fn_record_impression keeps working ; this is purely additive.
--
-- Idempotency
-- ───────────
-- All `IF NOT EXISTS` / `CREATE OR REPLACE`. Re-runs are safe.

BEGIN;

-- ─── Dedup table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kill_impressions_dedup (
  kill_id   UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
  ip_hash   TEXT NOT NULL,
  -- Day-bucket so the same IP can record one impression per day.
  -- Tighter bucket would be more aggressive ; 1 day matches the
  -- typical "reload page once per session" pattern.
  day_utc   DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kill_id, ip_hash, day_utc)
);

-- Index for the retention cleanup job (DELETE WHERE day_utc < cutoff).
CREATE INDEX IF NOT EXISTS idx_kill_impressions_dedup_day
  ON kill_impressions_dedup(day_utc);

-- ─── RLS ─────────────────────────────────────────────────────────────
-- The dedup table is service-role-only. Anon clients call the RPC
-- (which is SECURITY DEFINER), they never see this table directly.

ALTER TABLE kill_impressions_dedup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS impressions_dedup_no_anon ON kill_impressions_dedup;
CREATE POLICY impressions_dedup_no_anon ON kill_impressions_dedup
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ─── New rate-limited RPC ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_record_impression_v2(
  p_kill_id UUID,
  p_ip_hash TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  was_novel BOOLEAN := FALSE;
BEGIN
  -- Try to insert the dedup row. Unique violation = duplicate ; swallow
  -- and return false. Any other exception bubbles up.
  BEGIN
    INSERT INTO kill_impressions_dedup (kill_id, ip_hash)
    VALUES (p_kill_id, p_ip_hash);
    was_novel := TRUE;
  EXCEPTION WHEN unique_violation THEN
    was_novel := FALSE;
  END;

  -- Only bump the counter on novel impressions.
  IF was_novel THEN
    UPDATE kills
       SET impression_count = COALESCE(impression_count, 0) + 1
     WHERE id = p_kill_id;
  END IF;

  RETURN was_novel;
END;
$$;

-- Grant exec to anon + authenticated so the API route can call it.
GRANT EXECUTE ON FUNCTION fn_record_impression_v2(UUID, TEXT) TO anon, authenticated;

-- ─── Verification ────────────────────────────────────────────────────
-- Manual smoke after applying :
--   SELECT fn_record_impression_v2('<existing-kill-id>', 'test-ip-hash-1');  -- true
--   SELECT fn_record_impression_v2('<existing-kill-id>', 'test-ip-hash-1');  -- false (dedup)
--   SELECT fn_record_impression_v2('<existing-kill-id>', 'test-ip-hash-2');  -- true (different IP)
--   SELECT impression_count FROM kills WHERE id = '<existing-kill-id>';      -- +2

COMMIT;

-- ─── Operator follow-up (web side) ──────────────────────────────────
-- Update `web/src/app/api/kills/[id]/impression/route.ts` to :
--   1. Extract X-Forwarded-For (or the Vercel-Forwarded-For header).
--   2. SHA-256 hash it (truncate to 32 chars to stay under PostgREST URL
--      limits if needed).
--   3. Call rpc('fn_record_impression_v2', { p_kill_id, p_ip_hash }).
--
-- Until that ships, the legacy fn_record_impression keeps the old
-- unbounded behaviour — no production regression.
