-- ════════════════════════════════════════════════════════════════════
-- 002 — MOMENTS: coherent action chunks replacing individual kills as feed unit
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE moments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,

    -- Time window (game-relative seconds)
    start_time_seconds INT NOT NULL,
    end_time_seconds INT NOT NULL,

    -- Classification
    classification TEXT NOT NULL CHECK (classification IN (
        'solo_kill', 'skirmish', 'teamfight', 'ace', 'objective_fight'
    )),

    -- Team stats
    blue_kills INT DEFAULT 0,
    red_kills INT DEFAULT 0,
    winning_side TEXT CHECK (winning_side IN ('blue', 'red') OR winning_side IS NULL),
    kc_involvement TEXT CHECK (kc_involvement IN (
        'kc_aggressor', 'kc_victim', 'kc_both', 'kc_none'
    )),
    kill_count INT DEFAULT 0,
    participants_involved INT DEFAULT 0,

    -- Economy
    gold_swing INT DEFAULT 0,

    -- Clips (3 formats + thumb, same as kills)
    clip_url_horizontal TEXT,
    clip_url_vertical TEXT,
    clip_url_vertical_low TEXT,
    thumbnail_url TEXT,
    og_image_url TEXT,

    -- AI Analysis
    moment_score FLOAT,
    ai_tags JSONB DEFAULT '[]',
    ai_description TEXT,
    caster_hype_level INT,

    -- Community
    avg_rating FLOAT,
    rating_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    impression_count INT DEFAULT 0,

    -- State machine
    status TEXT DEFAULT 'raw' CHECK (status IN (
        'raw','enriched','vod_found','clipping','clipped',
        'analyzed','published','clip_error','manual_review'
    )),
    retry_count INT DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    search_vector tsvector
);

-- FK: link kills to their parent moment
ALTER TABLE kills ADD COLUMN IF NOT EXISTS moment_id UUID REFERENCES moments(id) ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════════════
-- INDEXES
-- ════════════════════════════════════════════════════════════════════

CREATE INDEX idx_moments_game ON moments(game_id, start_time_seconds);
CREATE INDEX idx_moments_status ON moments(status) WHERE status != 'published';
CREATE INDEX idx_moments_score ON moments(moment_score DESC NULLS LAST) WHERE status = 'published';
CREATE INDEX idx_moments_published ON moments(created_at DESC) WHERE status = 'published';
CREATE INDEX idx_moments_classification ON moments(classification);
CREATE INDEX idx_moments_kc ON moments(kc_involvement, avg_rating DESC NULLS LAST);
CREATE INDEX idx_kills_moment ON kills(moment_id) WHERE moment_id IS NOT NULL;
CREATE INDEX idx_moments_search ON moments USING GIN(search_vector);

-- ════════════════════════════════════════════════════════════════════
-- COMMUNITY TABLES
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE moment_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moment_id UUID REFERENCES moments(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    score INT CHECK (score BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(moment_id, user_id)
);

CREATE TABLE moment_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moment_id UUID REFERENCES moments(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    parent_id UUID REFERENCES moment_comments(id) ON DELETE SET NULL,
    content TEXT NOT NULL CHECK (length(content) <= 500),
    moderation_status TEXT DEFAULT 'pending'
        CHECK (moderation_status IN ('pending','approved','flagged','rejected')),
    moderation_reason TEXT,
    toxicity_score FLOAT,
    upvotes INT DEFAULT 0,
    report_count INT DEFAULT 0,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ════════════════════════════════════════════════════════════════════

-- Auto-update avg_rating on moments
CREATE OR REPLACE FUNCTION fn_update_moment_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE moments SET
        avg_rating = (SELECT ROUND(AVG(score)::numeric, 1) FROM moment_ratings WHERE moment_id = COALESCE(NEW.moment_id, OLD.moment_id)),
        rating_count = (SELECT COUNT(*) FROM moment_ratings WHERE moment_id = COALESCE(NEW.moment_id, OLD.moment_id)),
        updated_at = now()
    WHERE id = COALESCE(NEW.moment_id, OLD.moment_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_moment_rating_change
AFTER INSERT OR UPDATE OR DELETE ON moment_ratings
FOR EACH ROW EXECUTE FUNCTION fn_update_moment_rating();

-- Auto-update comment_count on moments
CREATE OR REPLACE FUNCTION fn_update_moment_comment_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE moments SET
        comment_count = (SELECT COUNT(*) FROM moment_comments
            WHERE moment_id = COALESCE(NEW.moment_id, OLD.moment_id)
            AND is_deleted = false AND moderation_status = 'approved'),
        updated_at = now()
    WHERE id = COALESCE(NEW.moment_id, OLD.moment_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_moment_comment_change
AFTER INSERT OR UPDATE OR DELETE ON moment_comments
FOR EACH ROW EXECUTE FUNCTION fn_update_moment_comment_count();

-- Auto-update search_vector on moments
CREATE OR REPLACE FUNCTION fn_update_moment_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('french',
        COALESCE(NEW.classification, '') || ' ' ||
        COALESCE(NEW.ai_description, '') || ' ' ||
        COALESCE(NEW.kc_involvement, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_moment_search
BEFORE INSERT OR UPDATE ON moments
FOR EACH ROW EXECUTE FUNCTION fn_update_moment_search_vector();

-- ════════════════════════════════════════════════════════════════════
-- RPC: feed moments (minimal egress)
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_get_feed_moments(
    p_limit INT,
    p_cursor TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    game_id UUID,
    classification TEXT,
    kill_count INT,
    blue_kills INT,
    red_kills INT,
    kc_involvement TEXT,
    gold_swing INT,
    clip_url_vertical TEXT,
    clip_url_vertical_low TEXT,
    thumbnail_url TEXT,
    moment_score FLOAT,
    avg_rating FLOAT,
    rating_count INT,
    ai_description TEXT,
    ai_tags JSONB,
    impression_count INT,
    comment_count INT,
    start_time_seconds INT,
    end_time_seconds INT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id, m.game_id, m.classification, m.kill_count,
        m.blue_kills, m.red_kills, m.kc_involvement,
        m.gold_swing,
        m.clip_url_vertical, m.clip_url_vertical_low,
        m.thumbnail_url, m.moment_score,
        m.avg_rating, m.rating_count,
        m.ai_description, m.ai_tags,
        m.impression_count, m.comment_count,
        m.start_time_seconds, m.end_time_seconds,
        m.created_at
    FROM moments m
    WHERE m.status = 'published'
    AND (p_cursor IS NULL OR m.created_at < p_cursor)
    ORDER BY m.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: record impression on moment (minimal egress)
CREATE OR REPLACE FUNCTION fn_record_moment_impression(p_moment_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE moments SET impression_count = COALESCE(impression_count, 0) + 1
    WHERE id = p_moment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE moment_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE moment_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public moments" ON moments FOR SELECT USING (status = 'published');
CREATE POLICY "Public moment ratings" ON moment_ratings FOR SELECT USING (true);
CREATE POLICY "Auth insert moment rating" ON moment_ratings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own moment rating update" ON moment_ratings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Public approved moment comments" ON moment_comments FOR SELECT
    USING (is_deleted = false AND moderation_status = 'approved');
CREATE POLICY "Auth insert moment comment" ON moment_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own moment comment update" ON moment_comments FOR UPDATE USING (auth.uid() = user_id);
