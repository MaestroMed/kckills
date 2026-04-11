-- ════════════════════════════════════════════════════════════════════════════
-- KCKILLS — Schema initial
-- ════════════════════════════════════════════════════════════════════════════
-- A executer dans le SQL Editor de Supabase en une seule fois.
-- Idempotent : peut etre re-execute sans erreur (DROP IF EXISTS au debut).
-- ════════════════════════════════════════════════════════════════════════════

-- Riot disclaimer (oblige par la "Legal Jibber Jabber")
-- "KCKILLS was created under Riot Games' 'Legal Jibber Jabber' policy using
--  assets owned by Riot Games. Riot Games does not endorse or sponsor this project."

-- ────────────────────────────────────────────────────────────────────────────
-- SAFETY : drop existing objects (dev only — a retirer en prod)
-- ────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS health_checks CASCADE;
DROP TABLE IF EXISTS push_subscriptions CASCADE;
DROP TABLE IF EXISTS community_clips CASCADE;
DROP TABLE IF EXISTS kill_tags CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS ratings CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS kills CASCADE;
DROP TABLE IF EXISTS game_vod_sources CASCADE;
DROP TABLE IF EXISTS game_participants CASCADE;
DROP TABLE IF EXISTS games CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS tournaments CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP FUNCTION IF EXISTS fn_update_kill_rating() CASCADE;
DROP FUNCTION IF EXISTS fn_update_comment_count() CASCADE;
DROP FUNCTION IF EXISTS fn_update_kill_search_vector() CASCADE;
DROP FUNCTION IF EXISTS fn_record_impression(UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_get_feed_kills(INT, TIMESTAMPTZ) CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- DONNEES ESPORT (publiques, read-only pour l'app, ecrites par le worker)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    code TEXT NOT NULL,
    logo_url TEXT,
    region TEXT,
    is_tracked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    ign TEXT NOT NULL,
    real_name TEXT,
    role TEXT CHECK (role IN ('top','jungle','mid','bottom','support')),
    nationality TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    league_id TEXT,
    year INT,
    split TEXT,
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE NOT NULL,
    tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
    team_blue_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    team_red_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    winner_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    format TEXT DEFAULT 'bo1',
    stage TEXT,
    scheduled_at TIMESTAMPTZ,
    state TEXT DEFAULT 'upcoming',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE NOT NULL,
    match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    game_number INT NOT NULL,
    winner_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    duration_seconds INT,
    patch TEXT,
    -- VOD officiel (depuis getEventDetails)
    vod_youtube_id TEXT,
    vod_offset_seconds INT,
    -- VOD alternatif (Kameto, Eto, etc.)
    alt_vod_youtube_id TEXT,
    alt_vod_platform TEXT,
    alt_vod_stream_start_epoch BIGINT,
    alt_vod_delay_seconds INT DEFAULT 12,
    -- Processing
    kills_extracted BOOLEAN DEFAULT FALSE,
    data_source TEXT DEFAULT 'livestats',
    state TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE game_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) ON DELETE CASCADE,
    player_id UUID REFERENCES players(id) ON DELETE SET NULL,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    participant_id INT NOT NULL,
    champion TEXT NOT NULL,
    role TEXT,
    side TEXT CHECK (side IN ('blue','red')),
    kills INT DEFAULT 0,
    deaths INT DEFAULT 0,
    assists INT DEFAULT 0,
    UNIQUE(game_id, participant_id)
);

CREATE TABLE game_vod_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
    source_type TEXT CHECK (source_type IN ('official_lec','kameto','etostark','other')),
    platform TEXT CHECK (platform IN ('youtube','twitch')),
    video_id TEXT NOT NULL,
    offset_seconds INT,
    stream_start_epoch BIGINT,
    stream_delay_seconds INT DEFAULT 12,
    sync_validated BOOLEAN DEFAULT FALSE,
    priority INT DEFAULT 0,
    added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(game_id, source_type)
);

-- ════════════════════════════════════════════════════════════════════════════
-- KILLS — le coeur du produit
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE kills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
    -- Timing (epoch-based = pause-proof)
    event_epoch BIGINT NOT NULL,
    game_time_seconds INT,
    -- Kill info
    killer_player_id UUID REFERENCES players(id) ON DELETE SET NULL,
    killer_champion TEXT,
    victim_player_id UUID REFERENCES players(id) ON DELETE SET NULL,
    victim_champion TEXT,
    assistants JSONB DEFAULT '[]',
    -- Confidence du mapping killer -> victim
    confidence TEXT DEFAULT 'high' CHECK (confidence IN ('high','medium','low','estimated','verified')),
    -- Team involvement
    tracked_team_involvement TEXT CHECK (tracked_team_involvement IN ('team_killer','team_victim','team_assist')),
    -- Context
    is_first_blood BOOLEAN DEFAULT FALSE,
    multi_kill TEXT,
    shutdown_bounty INT DEFAULT 0,
    -- Clips (3 formats + thumb + OG)
    clip_url_horizontal TEXT,
    clip_url_vertical TEXT,
    clip_url_vertical_low TEXT,
    thumbnail_url TEXT,
    og_image_url TEXT,
    clip_source TEXT DEFAULT 'official',
    clip_validated BOOLEAN DEFAULT FALSE,
    -- AI Analysis (Gemini Flash-Lite)
    highlight_score FLOAT,
    ai_tags JSONB DEFAULT '[]',
    ai_description TEXT,
    kill_visible BOOLEAN,
    caster_hype_level INT,
    -- Community
    avg_rating FLOAT,
    rating_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    impression_count INT DEFAULT 0,
    -- Data source
    data_source TEXT DEFAULT 'livestats',
    -- Processing state machine
    status TEXT DEFAULT 'raw' CHECK (status IN (
        'raw','enriched','vod_found','clipping','clipped',
        'analyzed','published','clip_error','manual_review'
    )),
    retry_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    -- Full-text search
    search_vector tsvector
);

-- ════════════════════════════════════════════════════════════════════════════
-- UTILISATEURS (zero-knowledge : on stocke le strict minimum)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    discord_username TEXT,
    discord_avatar_url TEXT,
    discord_id_hash TEXT,  -- SHA-256 du Discord ID
    -- Riot (optionnel)
    riot_puuid_hash TEXT,
    riot_summoner_name TEXT,
    riot_tag TEXT,
    riot_rank TEXT,
    riot_top_champions JSONB DEFAULT '[]',
    riot_linked_at TIMESTAMPTZ,
    -- Stats
    total_ratings INT DEFAULT 0,
    total_comments INT DEFAULT 0,
    badges JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    last_seen_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id UUID REFERENCES kills(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    score INT CHECK (score BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(kill_id, user_id)
);

CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id UUID REFERENCES kills(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    parent_id UUID REFERENCES comments(id) ON DELETE SET NULL,
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

CREATE TABLE kill_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id UUID REFERENCES kills(id) ON DELETE CASCADE NOT NULL,
    tag TEXT NOT NULL,
    source TEXT DEFAULT 'auto' CHECK (source IN ('auto','ai','community')),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(kill_id, tag)
);

CREATE TABLE community_clips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id UUID REFERENCES kills(id) ON DELETE SET NULL,
    submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    platform TEXT CHECK (platform IN ('youtube','tiktok','twitter')),
    external_url TEXT NOT NULL,
    title TEXT,
    approved BOOLEAN DEFAULT FALSE,
    upvotes INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    subscription_json TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE health_checks (
    id TEXT PRIMARY KEY,
    last_seen TIMESTAMPTZ DEFAULT now(),
    metrics JSONB DEFAULT '{}'
);

-- ════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX idx_kills_game ON kills(game_id, game_time_seconds);
CREATE INDEX idx_kills_killer ON kills(killer_player_id, created_at DESC);
CREATE INDEX idx_kills_status ON kills(status) WHERE status != 'published';
CREATE INDEX idx_kills_highlight ON kills(highlight_score DESC NULLS LAST) WHERE status = 'published';
CREATE INDEX idx_kills_team ON kills(tracked_team_involvement, avg_rating DESC NULLS LAST);
CREATE INDEX idx_kills_multi ON kills(multi_kill) WHERE multi_kill IS NOT NULL;
CREATE INDEX idx_kills_published ON kills(created_at DESC) WHERE status = 'published';
CREATE INDEX idx_kills_search ON kills USING GIN(search_vector);
CREATE INDEX idx_ratings_kill ON ratings(kill_id);
CREATE INDEX idx_comments_kill ON comments(kill_id, created_at)
    WHERE is_deleted = false AND moderation_status = 'approved';
CREATE INDEX idx_games_match ON games(match_id);
CREATE INDEX idx_participants_game ON game_participants(game_id);

-- ════════════════════════════════════════════════════════════════════════════
-- TRIGGERS — compteurs auto
-- ════════════════════════════════════════════════════════════════════════════

-- Recalcule avg_rating + rating_count a chaque changement
CREATE OR REPLACE FUNCTION fn_update_kill_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE kills SET
        avg_rating = (
            SELECT ROUND(AVG(score)::numeric, 1)
            FROM ratings
            WHERE kill_id = COALESCE(NEW.kill_id, OLD.kill_id)
        ),
        rating_count = (
            SELECT COUNT(*)
            FROM ratings
            WHERE kill_id = COALESCE(NEW.kill_id, OLD.kill_id)
        ),
        updated_at = now()
    WHERE id = COALESCE(NEW.kill_id, OLD.kill_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_rating_change
AFTER INSERT OR UPDATE OR DELETE ON ratings
FOR EACH ROW EXECUTE FUNCTION fn_update_kill_rating();

-- Recalcule comment_count
CREATE OR REPLACE FUNCTION fn_update_comment_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE kills SET
        comment_count = (
            SELECT COUNT(*) FROM comments
            WHERE kill_id = COALESCE(NEW.kill_id, OLD.kill_id)
              AND is_deleted = false
              AND moderation_status = 'approved'
        ),
        updated_at = now()
    WHERE id = COALESCE(NEW.kill_id, OLD.kill_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_comment_change
AFTER INSERT OR UPDATE OR DELETE ON comments
FOR EACH ROW EXECUTE FUNCTION fn_update_comment_count();

-- Met a jour le vecteur de recherche full-text (francais)
CREATE OR REPLACE FUNCTION fn_update_kill_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('french',
        COALESCE(NEW.killer_champion, '') || ' ' ||
        COALESCE(NEW.victim_champion, '') || ' ' ||
        COALESCE(NEW.ai_description, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kill_search
BEFORE INSERT OR UPDATE ON kills
FOR EACH ROW EXECUTE FUNCTION fn_update_kill_search_vector();

-- ════════════════════════════════════════════════════════════════════════════
-- RPC FUNCTIONS — pour minimiser l'egress Supabase
-- ════════════════════════════════════════════════════════════════════════════

-- Enregistre une impression (write-only, 0 return)
CREATE OR REPLACE FUNCTION fn_record_impression(p_kill_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE kills
    SET impression_count = COALESCE(impression_count, 0) + 1
    WHERE id = p_kill_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Feed kills : retourne UNIQUEMENT les champs necessaires au scroll
CREATE OR REPLACE FUNCTION fn_get_feed_kills(
    p_limit INT,
    p_cursor TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    killer_champion TEXT,
    victim_champion TEXT,
    killer_name TEXT,
    victim_name TEXT,
    clip_url_vertical TEXT,
    clip_url_vertical_low TEXT,
    thumbnail_url TEXT,
    highlight_score FLOAT,
    avg_rating FLOAT,
    rating_count INT,
    ai_description TEXT,
    ai_tags JSONB,
    multi_kill TEXT,
    is_first_blood BOOLEAN,
    tracked_team_involvement TEXT,
    impression_count INT,
    comment_count INT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        k.id,
        k.killer_champion,
        k.victim_champion,
        p1.ign AS killer_name,
        p2.ign AS victim_name,
        k.clip_url_vertical,
        k.clip_url_vertical_low,
        k.thumbnail_url,
        k.highlight_score,
        k.avg_rating,
        k.rating_count,
        k.ai_description,
        k.ai_tags,
        k.multi_kill,
        k.is_first_blood,
        k.tracked_team_involvement,
        k.impression_count,
        k.comment_count,
        k.created_at
    FROM kills k
    LEFT JOIN players p1 ON k.killer_player_id = p1.id
    LEFT JOIN players p2 ON k.victim_player_id = p2.id
    WHERE k.status = 'published'
      AND (p_cursor IS NULL OR k.created_at < p_cursor)
    ORDER BY k.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════════════
-- Regles :
-- - kills  : lisibles par tous SI status = 'published', write = service_role only
-- - profiles : lisibles par tous, write = soi-meme uniquement
-- - ratings : lisibles par tous, insert/update = soi-meme uniquement
-- - comments : lisibles par tous si approved, insert = soi-meme uniquement
-- - community_clips : lisibles si approved, insert = soi-meme uniquement

ALTER TABLE kills ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- kills
CREATE POLICY "Public kills read"
    ON kills FOR SELECT USING (status = 'published');

-- profiles
CREATE POLICY "Public profiles read"
    ON profiles FOR SELECT USING (true);
CREATE POLICY "Own profile insert"
    ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Own profile update"
    ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Own profile delete"
    ON profiles FOR DELETE USING (auth.uid() = id);

-- ratings
CREATE POLICY "Public ratings read"
    ON ratings FOR SELECT USING (true);
CREATE POLICY "Auth ratings insert"
    ON ratings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own rating update"
    ON ratings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Own rating delete"
    ON ratings FOR DELETE USING (auth.uid() = user_id);

-- comments
CREATE POLICY "Public approved comments read"
    ON comments FOR SELECT
    USING (is_deleted = false AND moderation_status = 'approved');
CREATE POLICY "Auth comment insert"
    ON comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own comment update"
    ON comments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Own comment soft-delete"
    ON comments FOR DELETE USING (auth.uid() = user_id);

-- community_clips
CREATE POLICY "Public approved clips read"
    ON community_clips FOR SELECT USING (approved = true);
CREATE POLICY "Auth submit clip"
    ON community_clips FOR INSERT WITH CHECK (auth.uid() = submitted_by);

-- push_subscriptions
CREATE POLICY "Own push subs"
    ON push_subscriptions FOR ALL USING (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════════════════
-- SEED : equipe KC + joueurs actuels (pour que le worker n'ait pas a creer
--        les lignes teams/players a chaque fois)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO teams (external_id, name, slug, code, logo_url, region, is_tracked)
VALUES (
    '103461966951059521',
    'Karmine Corp',
    'karmine-corp',
    'KC',
    'http://static.lolesports.com/teams/1704714951336_KC.png',
    'EMEA',
    TRUE
)
ON CONFLICT (external_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- DONE
-- ════════════════════════════════════════════════════════════════════════════
-- Execution :
-- 1. Supabase Dashboard > SQL Editor > New Query
-- 2. Colle tout le contenu de ce fichier
-- 3. Run (ou Ctrl+Enter)
-- 4. Verifie dans Table Editor que les 15 tables existent
-- 5. Verifie Authentication > Policies que le RLS est active partout
