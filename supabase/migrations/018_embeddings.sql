-- Migration 018 — Semantic similarity over published clips (PR17)
--
-- pgvector + Gemini text-embedding-004 (768d). Powers /kill/[id]'s
-- "Similar moments" carousel via cosine distance.
--
-- HNSW index : O(log N) lookup vs O(N) seq scan. Builds lazily as
-- vectors get populated by worker/modules/embedder.py.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS embedding vector(768);

COMMENT ON COLUMN kills.embedding IS
    'Gemini text-embedding-004 (768d) of "{killer} kills {victim} | {desc} '
    '| tags: {tags}". Populated by worker/modules/embedder.py. NULL until '
    'first pass — fn_similar_kills tolerates that by returning empty.';

CREATE INDEX IF NOT EXISTS idx_kills_embedding_hnsw
    ON kills USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_kills_embedding_pending
    ON kills (created_at DESC)
    WHERE status = 'published' AND embedding IS NULL;

-- ─── RPC : fn_similar_kills ────────────────────────────────────────────
-- Returns the N most semantically similar published clips to a target.

CREATE OR REPLACE FUNCTION fn_similar_kills(
    target_id UUID,
    match_count INT DEFAULT 6
)
RETURNS TABLE (
    id UUID,
    killer_champion TEXT,
    victim_champion TEXT,
    thumbnail_url TEXT,
    highlight_score FLOAT,
    ai_description_preview TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    target_vec vector(768);
BEGIN
    SELECT embedding INTO target_vec
    FROM kills
    WHERE kills.id = target_id
      AND status = 'published';

    IF target_vec IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        k.id,
        k.killer_champion,
        k.victim_champion,
        k.thumbnail_url,
        k.highlight_score,
        LEFT(COALESCE(k.ai_description, ''), 100) AS ai_description_preview,
        (1.0 - (k.embedding <=> target_vec) / 2.0)::FLOAT AS similarity
    FROM kills k
    WHERE k.id <> target_id
      AND k.status = 'published'
      AND k.kill_visible = TRUE
      AND k.embedding IS NOT NULL
      AND k.thumbnail_url IS NOT NULL
    ORDER BY k.embedding <=> target_vec ASC
    LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_similar_kills(UUID, INT) TO anon, authenticated;
