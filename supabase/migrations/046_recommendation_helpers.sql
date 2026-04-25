-- Migration 046 — Recommendation engine helpers (PR-loltok DI)
--
-- Wave 11 / Agent DI ships the personalised /scroll feed v0 :
--   * Per-session anchor list = last N kill_ids the user actively viewed
--   * Query vector = AVG(embedding) of those anchors
--   * Candidates = published kills nearest to the query vector by cosine
--   * Excluded = anchors themselves + already-watched in last 24h
--
-- This migration provides the SQL surface :
--   1. An IVFFlat index on kills.embedding (HNSW already exists from
--      migration 018, but the recommender's bulk lookups benefit from
--      the IVFFlat secondary). Both can coexist — the planner picks
--      whichever is cheaper for the query.
--   2. fn_recommend_kills() RPC : the read path.
--   3. GRANT to anon / authenticated so the edge route can call it
--      with the public anon key (RLS policy `Public kills` already
--      restricts the underlying SELECT to status='published').
--
-- Performance target : <50 ms for top-20 nearest at 1.2 M kills.
-- IVFFlat with lists=100 hits that comfortably for 768-d vectors.
--
-- Backwards-compat : the loader (web/src/lib/supabase/recommendations.ts)
-- detects "function fn_recommend_kills does not exist" and falls back to
-- the existing getRecentPublishedKills() RPC. So this migration can
-- land before or after the worker / web bits without breaking the feed.

-- ─── 1. IVFFlat secondary index ────────────────────────────────────────
-- Migration 018 already created idx_kills_embedding_hnsw
-- (USING hnsw (embedding vector_cosine_ops)). HNSW is great for low-N
-- top-K queries but the recommender does AVG(embedding) over N anchors
-- + KNN on the result, which is amortised better by IVFFlat at scale.
--
-- IF NOT EXISTS guards re-runs. lists=100 is the standard pgvector
-- recommendation for ≤ 1 M rows ; we'd bump to ~sqrt(N)/4 only if
-- volume crosses 5 M.
CREATE INDEX IF NOT EXISTS idx_kills_embedding_ivfflat
    ON kills USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

COMMENT ON INDEX idx_kills_embedding_ivfflat IS
    'IVFFlat secondary index for fn_recommend_kills() bulk KNN. '
    'Coexists with idx_kills_embedding_hnsw (migration 018) — the '
    'planner picks whichever is cheaper for the workload.';

-- ─── 2. fn_recommend_kills() — the read path ───────────────────────────
-- Inputs :
--   p_anchor_kill_ids       : last N kill_ids the user watched (or [] for cold start).
--   p_session_id            : analytics session id (TEXT) — used to look up
--                             watched-history in user_events for last 24h.
--   p_limit                 : how many recommendations to return.
--   p_exclude_recent_hours  : how far back to look in user_events for the
--                             watched-list exclusion. Default 24h.
--
-- Algorithm :
--   1. Resolve the anchor embeddings ; AVG them into a query vector.
--      If no embeddings found, return 0 rows (loader falls back).
--   2. Build the exclusion set = anchors + watched in last N hours.
--   3. Cosine-sort published kills (with embedding + thumbnail + clip)
--      against the query vector ; LIMIT p_limit.
--
-- Why SECURITY DEFINER : the function reads user_events (admin-only RLS)
-- to compute the watched-set. We sandwich the read in this function so
-- the anon client never gets table-level access. The function is GRANTed
-- to anon, but it can only return the recommendation rows — not the raw
-- analytics history.

CREATE OR REPLACE FUNCTION fn_recommend_kills(
    p_anchor_kill_ids UUID[],
    p_session_id TEXT,
    p_limit INT DEFAULT 10,
    p_exclude_recent_hours INT DEFAULT 24
)
RETURNS TABLE (
    id UUID,
    similarity FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    query_vec vector(768);
    anchor_count INT;
BEGIN
    -- Defensive defaults — NULL inputs become safe values.
    p_anchor_kill_ids := COALESCE(p_anchor_kill_ids, ARRAY[]::UUID[]);
    p_limit := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
    p_exclude_recent_hours :=
        GREATEST(1, LEAST(COALESCE(p_exclude_recent_hours, 24), 168));
    anchor_count := COALESCE(array_length(p_anchor_kill_ids, 1), 0);

    -- Cold start : no anchors → loader will see empty TABLE and fall back
    -- to getRecentPublishedKills(). We don't try to be clever here.
    IF anchor_count = 0 THEN
        RETURN;
    END IF;

    -- Compute the centroid of the anchor embeddings. NULL embeddings
    -- are filtered out — if every anchor lacks an embedding, the AVG
    -- comes back NULL and we bail.
    --
    -- pgvector's avg() aggregate (vector_avg) is available since 0.5.0
    -- (released 2023). We call it via a subquery so the planner can
    -- short-circuit when there are no rows.
    SELECT AVG(k.embedding)::vector(768)
      INTO query_vec
      FROM kills k
     WHERE k.id = ANY(p_anchor_kill_ids)
       AND k.embedding IS NOT NULL;

    IF query_vec IS NULL THEN
        RETURN;
    END IF;

    -- The KNN scan. Exclusions are pushed into the WHERE clause so the
    -- planner can use the IVFFlat / HNSW index for the cosine ORDER BY.
    --
    -- The watched-list subquery hits idx_user_events_session
    -- (session_id, created_at) — bounded scan, fast even at 100k events.
    RETURN QUERY
    SELECT
        k.id,
        (1.0 - (k.embedding <=> query_vec) / 2.0)::FLOAT AS similarity
      FROM kills k
     WHERE k.embedding IS NOT NULL
       AND k.thumbnail_url IS NOT NULL
       AND k.clip_url_vertical IS NOT NULL
       AND k.kill_visible = TRUE
       -- PR23 split-status fallback (mirrors getPublishedKills).
       AND (
           k.publication_status = 'published'
           OR (k.publication_status IS NULL AND k.status = 'published')
       )
       -- Exclude the anchors themselves so we don't recommend what the
       -- user just watched.
       AND NOT (k.id = ANY(p_anchor_kill_ids))
       -- Exclude watched-in-recent-window. NULLIF guards an empty
       -- session_id (which would otherwise match every row with a NULL
       -- session in user_events).
       AND (
           NULLIF(p_session_id, '') IS NULL
           OR NOT EXISTS (
               SELECT 1
                 FROM user_events ue
                WHERE ue.session_id = p_session_id
                  AND ue.entity_type = 'kill'
                  AND ue.entity_id = k.id::TEXT
                  AND ue.event_type IN ('clip.viewed', 'clip.completed', 'clip.replayed')
                  AND ue.created_at > now() - make_interval(hours => p_exclude_recent_hours)
           )
       )
     ORDER BY k.embedding <=> query_vec ASC
     LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION fn_recommend_kills IS
    'Per-session similarity-based kill recommender. Returns kill_id + '
    'cosine similarity (0-1) for the top-N published clips closest to '
    'the AVG embedding of the caller-supplied anchor kills, excluding '
    'anchors + watched-in-last-24h. Cold start (empty anchors) returns '
    'an empty table — caller is expected to fall back to recency feed.';

GRANT EXECUTE ON FUNCTION fn_recommend_kills(UUID[], TEXT, INT, INT)
    TO anon, authenticated;
