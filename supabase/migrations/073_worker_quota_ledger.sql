-- Migration 073 (Wave 34 T3.1) — Cross-process worker quota ledger
--
-- Pre-Wave-34 : LoLTokScheduler.{_daily_counts, _daily_cost_usd} étaient
-- in-process dict. Avec orchestrator.py spawn 4 enfants Python, chacun
-- avait son propre ledger isolé → daily quota 950 RPD pouvait overshooter
-- à 3800/jour, cost cap $20 idem.
--
-- Fix : table Postgres partagée. Upsert atomique pour incrémenter
-- count + cost. Tous les enfants voient le même état réel.

BEGIN;

CREATE TABLE IF NOT EXISTS worker_quota_ledger (
    service     TEXT NOT NULL,
    -- ISO date YYYY-MM-DD du window 07:00 UTC reset
    quota_date  DATE NOT NULL,
    call_count  INT NOT NULL DEFAULT 0,
    cost_usd    NUMERIC(12, 6) NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (service, quota_date)
);

COMMENT ON TABLE worker_quota_ledger IS
    'Wave 34 T3.1 — shared quota ledger across orchestrator child processes.';

-- Index pour lookups par service (utilisé partout dans le worker)
CREATE INDEX IF NOT EXISTS idx_worker_quota_ledger_service
    ON worker_quota_ledger (service, quota_date DESC);

-- RPC atomique : insert + increment dans une seule transaction.
-- Service-role only — pas de policy anon.
CREATE OR REPLACE FUNCTION public.fn_worker_quota_record(
    p_service TEXT,
    p_quota_date DATE,
    p_cost_usd NUMERIC DEFAULT 0
)
RETURNS TABLE (call_count INT, cost_usd NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
    INSERT INTO worker_quota_ledger (service, quota_date, call_count, cost_usd)
    VALUES (p_service, p_quota_date, 1, COALESCE(p_cost_usd, 0))
    ON CONFLICT (service, quota_date) DO UPDATE
    SET
        call_count = worker_quota_ledger.call_count + 1,
        cost_usd = worker_quota_ledger.cost_usd + COALESCE(EXCLUDED.cost_usd, 0),
        updated_at = now()
    RETURNING worker_quota_ledger.call_count, worker_quota_ledger.cost_usd
    INTO call_count, cost_usd;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_worker_quota_record(TEXT, DATE, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_worker_quota_record(TEXT, DATE, NUMERIC) TO service_role;

-- Helper read : current count + cost pour un service à une date donnée
CREATE OR REPLACE FUNCTION public.fn_worker_quota_get(
    p_service TEXT,
    p_quota_date DATE
)
RETURNS TABLE (call_count INT, cost_usd NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(w.call_count, 0)::INT,
        COALESCE(w.cost_usd, 0)::NUMERIC
    FROM worker_quota_ledger w
    WHERE w.service = p_service AND w.quota_date = p_quota_date;
    -- Si rien trouvé, retour 0/0
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0::INT, 0::NUMERIC;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_worker_quota_get(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_worker_quota_get(TEXT, DATE) TO service_role;

COMMIT;
