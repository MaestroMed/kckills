-- ════════════════════════════════════════════════════════════════════
-- 080 — Dedicated `likes` table : decouple the binary LIKE from the 1-5 RATING
-- ════════════════════════════════════════════════════════════════════
--
-- BUG (found 2026-05-30 by the /scroll redesign workflow, verified in
-- web/src/components/community/actions.ts:169-172): `toggleKillLike` upserted
-- {kill_id, user_id, score: 5} into the `ratings` table, whose UNIQUE
-- constraint is (kill_id, user_id). The 1-5 StarRating writes the SAME row,
-- so a LIKE and a STAR RATING mutually OVERWRITE — a like silently becomes a
-- 5★ rating (and pollutes avg_rating / the Wilson feed score), and a rating
-- silently clears the like. The two interactions cannot coexist.
--
-- FIX: a dedicated `likes` table (binary, one row per user per kill). The
-- `ratings` table now holds ONLY genuine 1-5 scores feeding avg_rating /
-- rating_count via the existing fn_update_kill_rating trigger. A trigger
-- maintains a denormalised kills.like_count for cheap feed reads.
--
-- Transaction-safe (no CONCURRENTLY / VACUUM) → applies cleanly in the
-- Supabase SQL Editor. Idempotent (guards on every object).

-- ─── Denormalised counter on kills ───────────────────────────────────
ALTER TABLE kills ADD COLUMN IF NOT EXISTS like_count INT DEFAULT 0;

-- ─── The likes table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS likes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id    UUID REFERENCES kills(id) ON DELETE CASCADE NOT NULL,
    user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (kill_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_kill ON likes(kill_id);
CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id, created_at DESC);

-- ─── RLS : public read, auth writes only its own rows ────────────────
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public likes read"   ON likes;
DROP POLICY IF EXISTS "Auth insert own like" ON likes;
DROP POLICY IF EXISTS "Auth delete own like" ON likes;

CREATE POLICY "Public likes read"    ON likes FOR SELECT USING (true);
CREATE POLICY "Auth insert own like" ON likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth delete own like" ON likes FOR DELETE USING (auth.uid() = user_id);

-- ─── Trigger : maintain kills.like_count ─────────────────────────────
CREATE OR REPLACE FUNCTION fn_update_kill_like_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE kills SET
        like_count = (SELECT COUNT(*) FROM likes WHERE kill_id = COALESCE(NEW.kill_id, OLD.kill_id)),
        updated_at = now()
    WHERE id = COALESCE(NEW.kill_id, OLD.kill_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_like_change ON likes;
CREATE TRIGGER trg_like_change
    AFTER INSERT OR DELETE ON likes
    FOR EACH ROW EXECUTE FUNCTION fn_update_kill_like_count();

-- ─── Backfill : migrate the score=5 "likes" that were really likes ───
-- We CANNOT perfectly distinguish an intentional 5★ rating from a like
-- that was stored as score=5. Conservative choice: copy ALL existing
-- score=5 ratings into likes (so no like is lost), but LEAVE the ratings
-- rows in place (so no genuine 5★ is lost either). Going forward the two
-- paths are independent; this only affects the brief historical overlap.
INSERT INTO likes (kill_id, user_id, created_at)
SELECT r.kill_id, r.user_id, r.created_at
FROM ratings r
WHERE r.score = 5
ON CONFLICT (kill_id, user_id) DO NOTHING;

COMMENT ON TABLE likes IS
    'Wave 36 (migr 080): binary per-user like, split from the 1-5 ratings '
    'table to stop the like/rating mutual-overwrite on UNIQUE(kill_id,user_id). '
    'kills.like_count maintained by trg_like_change.';
