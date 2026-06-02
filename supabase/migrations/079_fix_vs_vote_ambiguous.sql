-- ════════════════════════════════════════════════════════════════════
-- 079 — Fix `fn_record_vs_vote` ambiguous column reference (Wave 36)
-- ════════════════════════════════════════════════════════════════════
--
-- BUG (live, found 2026-05-29 by testing the VS Roulette vote):
--   Voting failed with 42702 "column reference \"kill_a_id\" is ambiguous".
--   The function RETURNS TABLE (kill_a_id, kill_b_id, ...) — those output
--   columns are in scope as names throughout the body. The idempotency
--   probe `SELECT id FROM vs_battles WHERE kill_a_id = k_a AND kill_b_id =
--   k_b` referenced those columns UNQUALIFIED, so PL/pgSQL could not tell
--   the vs_battles column from the OUT parameter → it raised 42702 and the
--   whole vote (and ELO update) aborted. Net effect: NO vote ever recorded
--   and the /vs ELO ladder was never fed.
--
-- FIX: alias vs_battles AS vb and qualify the probe's columns. Nothing else
--   in the body is ambiguous (the INSERT column-list and the RETURN QUERY
--   use locals/explicit target columns). Signature is unchanged, so a plain
--   CREATE OR REPLACE keeps existing GRANTs; we re-GRANT defensively.
--
-- Transaction-safe (no CONCURRENTLY / VACUUM) → applies cleanly in the
-- Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.fn_record_vs_vote(
    p_kill_a       UUID,
    p_kill_b       UUID,
    p_winner       UUID,
    p_session_hash TEXT,
    p_filters      JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    kill_a_id     UUID,
    kill_a_elo    FLOAT,
    kill_a_battles INT,
    kill_a_wins   INT,
    kill_b_id     UUID,
    kill_b_elo    FLOAT,
    kill_b_battles INT,
    kill_b_wins   INT,
    inserted      BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    k_a UUID := p_kill_a;
    k_b UUID := p_kill_b;
    v_existing UUID;
    v_inserted BOOLEAN := FALSE;
    r_a FLOAT;
    r_b FLOAT;
    e_a FLOAT;
    e_b FLOAT;
    o_a FLOAT;
    o_b FLOAT;
    n_a FLOAT;
    n_b FLOAT;
    k_factor CONSTANT FLOAT := 32.0;
    out_a_id UUID;
    out_a_elo FLOAT;
    out_a_battles INT;
    out_a_wins INT;
    out_b_id UUID;
    out_b_elo FLOAT;
    out_b_battles INT;
    out_b_wins INT;
BEGIN
    IF k_a IS NULL OR k_b IS NULL THEN
        RAISE EXCEPTION 'fn_record_vs_vote: kill_a and kill_b are required';
    END IF;
    IF k_a = k_b THEN
        RAISE EXCEPTION 'fn_record_vs_vote: kill_a and kill_b must differ';
    END IF;
    IF p_session_hash IS NULL OR length(p_session_hash) < 16 THEN
        RAISE EXCEPTION 'fn_record_vs_vote: session_hash must be >= 16 chars';
    END IF;
    IF p_winner IS NOT NULL AND p_winner <> k_a AND p_winner <> k_b THEN
        RAISE EXCEPTION 'fn_record_vs_vote: winner must be kill_a, kill_b, or NULL';
    END IF;

    -- Normalise pair ordering so (a,b) and (b,a) collapse into one row.
    IF k_a > k_b THEN
        DECLARE
            tmp UUID := k_a;
        BEGIN
            k_a := k_b;
            k_b := tmp;
        END;
    END IF;

    -- Idempotency check — FIX: alias + qualify to disambiguate the
    -- vs_battles columns from the RETURNS TABLE output params of the
    -- same name (was the 42702 source).
    SELECT vb.id INTO v_existing
    FROM vs_battles vb
    WHERE vb.kill_a_id = k_a
      AND vb.kill_b_id = k_b
      AND vb.voter_session_hash = p_session_hash
    LIMIT 1;

    IF v_existing IS NULL THEN
        INSERT INTO kill_elo (kill_id) VALUES (k_a)
            ON CONFLICT (kill_id) DO NOTHING;
        INSERT INTO kill_elo (kill_id) VALUES (k_b)
            ON CONFLICT (kill_id) DO NOTHING;

        SELECT elo_rating INTO r_a FROM kill_elo WHERE kill_id = k_a FOR UPDATE;
        SELECT elo_rating INTO r_b FROM kill_elo WHERE kill_id = k_b FOR UPDATE;

        e_a := 1.0 / (1.0 + power(10.0, (r_b - r_a) / 400.0));
        e_b := 1.0 - e_a;

        IF p_winner IS NULL THEN
            o_a := 0.5;
            o_b := 0.5;
        ELSIF p_winner = k_a THEN
            o_a := 1.0;
            o_b := 0.0;
        ELSE
            o_a := 0.0;
            o_b := 1.0;
        END IF;

        n_a := r_a + k_factor * (o_a - e_a);
        n_b := r_b + k_factor * (o_b - e_b);

        BEGIN
            INSERT INTO vs_battles (
                kill_a_id, kill_b_id, winner_kill_id,
                voter_user_id, voter_session_hash, filters_json
            ) VALUES (
                k_a, k_b, p_winner,
                auth.uid(), p_session_hash, COALESCE(p_filters, '{}'::jsonb)
            );
            v_inserted := TRUE;
        EXCEPTION WHEN unique_violation THEN
            v_inserted := FALSE;
        END;

        IF v_inserted THEN
            UPDATE kill_elo
                SET elo_rating     = n_a,
                    battles_count  = battles_count + 1,
                    wins           = wins + CASE WHEN o_a = 1.0 THEN 1 ELSE 0 END,
                    last_battle_at = now(),
                    updated_at     = now()
                WHERE kill_id = k_a;
            UPDATE kill_elo
                SET elo_rating     = n_b,
                    battles_count  = battles_count + 1,
                    wins           = wins + CASE WHEN o_b = 1.0 THEN 1 ELSE 0 END,
                    last_battle_at = now(),
                    updated_at     = now()
                WHERE kill_id = k_b;
        END IF;
    END IF;

    SELECT kill_id, elo_rating, battles_count, wins
        INTO out_a_id, out_a_elo, out_a_battles, out_a_wins
        FROM kill_elo WHERE kill_id = k_a;
    SELECT kill_id, elo_rating, battles_count, wins
        INTO out_b_id, out_b_elo, out_b_battles, out_b_wins
        FROM kill_elo WHERE kill_id = k_b;

    IF out_a_id IS NULL THEN
        out_a_id := k_a; out_a_elo := 1500; out_a_battles := 0; out_a_wins := 0;
    END IF;
    IF out_b_id IS NULL THEN
        out_b_id := k_b; out_b_elo := 1500; out_b_battles := 0; out_b_wins := 0;
    END IF;

    RETURN QUERY SELECT
        out_a_id, out_a_elo, out_a_battles, out_a_wins,
        out_b_id, out_b_elo, out_b_battles, out_b_wins,
        v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_record_vs_vote(UUID, UUID, UUID, TEXT, JSONB)
    TO anon, authenticated;
