-- KCKills Database Schema for Supabase
-- Run this in the Supabase SQL Editor

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE kill_status AS ENUM (
  'pending',        -- kill detected, no clip yet
  'vod_searching',  -- looking for VOD
  'vod_found',      -- VOD located, awaiting clipping
  'clipping',       -- ffmpeg processing
  'uploading',      -- uploading to R2
  'ready',          -- clip available
  'failed',         -- processing failed
  'no_vod'          -- VOD not available
);

CREATE TYPE kill_type AS ENUM (
  'solo_kill',
  'first_blood',
  'double_kill',
  'triple_kill',
  'quadra_kill',
  'penta_kill',
  'ace',
  'shutdown',
  'regular'
);

CREATE TYPE camera_status AS ENUM (
  'on_camera',
  'off_camera',
  'unknown'
);

-- ============================================
-- TABLES
-- ============================================

-- Tournaments (LEC Spring 2026, LEC Versus 2026, etc.)
CREATE TABLE tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  riot_tournament_id TEXT UNIQUE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  region TEXT NOT NULL DEFAULT 'LEC',
  split TEXT,
  year INT NOT NULL,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Teams
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  riot_team_id TEXT UNIQUE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  short_name TEXT NOT NULL,
  logo_url TEXT,
  is_tracked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Players
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  riot_puuid TEXT UNIQUE,
  summoner_name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  real_name TEXT,
  role TEXT CHECK (role IN ('top', 'jungle', 'mid', 'adc', 'support')),
  team_id UUID REFERENCES teams(id),
  profile_image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Matches (Bo3/Bo5 series)
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  riot_match_id TEXT UNIQUE,
  tournament_id UUID REFERENCES tournaments(id),
  team_blue_id UUID REFERENCES teams(id),
  team_red_id UUID REFERENCES teams(id),
  winner_id UUID REFERENCES teams(id),
  match_date TIMESTAMPTZ NOT NULL,
  best_of INT DEFAULT 1,
  stage TEXT,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Games (individual games within a match)
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  riot_game_id TEXT UNIQUE,
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  game_number INT NOT NULL,
  duration_seconds INT,
  winner_side TEXT CHECK (winner_side IN ('blue', 'red')),
  game_start_timestamp BIGINT,
  patch TEXT,
  vod_url TEXT,
  vod_platform TEXT CHECK (vod_platform IN ('youtube', 'twitch')),
  vod_offset_seconds FLOAT,
  vod_offset_calibrated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(match_id, game_number)
);

-- Game participants (champion picks per player per game)
CREATE TABLE game_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  player_id UUID REFERENCES players(id),
  team_id UUID REFERENCES teams(id),
  champion_id INT NOT NULL,
  champion_name TEXT NOT NULL,
  side TEXT CHECK (side IN ('blue', 'red')),
  role TEXT CHECK (role IN ('top', 'jungle', 'mid', 'adc', 'support')),
  kills INT DEFAULT 0,
  deaths INT DEFAULT 0,
  assists INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, player_id)
);

-- ============================================
-- THE CORE: KILLS
-- ============================================

CREATE TABLE kills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,

  -- Kill event data
  game_timestamp_ms INT NOT NULL,
  position_x FLOAT,
  position_y FLOAT,

  -- Actors
  killer_id UUID NOT NULL REFERENCES players(id),
  killer_champion TEXT NOT NULL,
  victim_id UUID NOT NULL REFERENCES players(id),
  victim_champion TEXT NOT NULL,

  -- Context
  kill_type kill_type DEFAULT 'regular',
  is_first_blood BOOLEAN DEFAULT false,
  is_ace BOOLEAN DEFAULT false,
  shutdown_bounty INT DEFAULT 0,
  multi_kill_length INT DEFAULT 1,

  -- KC involvement
  kc_is_killer BOOLEAN NOT NULL DEFAULT false,
  kc_is_victim BOOLEAN NOT NULL DEFAULT false,

  -- Video clip
  clip_url TEXT,
  clip_thumbnail_url TEXT,
  clip_duration_seconds FLOAT DEFAULT 18,
  camera_status camera_status DEFAULT 'unknown',
  status kill_status DEFAULT 'pending',
  processing_error TEXT,

  -- Community
  avg_rating FLOAT DEFAULT 0,
  rating_count INT DEFAULT 0,
  comment_count INT DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Kill assists (many-to-many)
CREATE TABLE kill_assists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kill_id UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id),
  champion TEXT NOT NULL,
  is_kc_player BOOLEAN DEFAULT false,
  UNIQUE(kill_id, player_id)
);

-- Kill tags (community + auto tags)
CREATE TABLE kill_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kill_id UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  is_auto BOOLEAN DEFAULT false,
  created_by UUID,
  count INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(kill_id, tag)
);

-- ============================================
-- COMMUNITY
-- ============================================

-- User profiles (extends Supabase auth)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  discord_id TEXT,
  total_ratings INT DEFAULT 0,
  total_comments INT DEFAULT 0,
  badges TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Ratings
CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kill_id UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  score INT NOT NULL CHECK (score >= 1 AND score <= 5),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(kill_id, user_id)
);

-- Comments (threaded)
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kill_id UUID NOT NULL REFERENCES kills(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) <= 2000),
  upvotes INT DEFAULT 0,
  is_edited BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Comment votes
CREATE TABLE comment_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vote INT NOT NULL CHECK (vote IN (-1, 1)),
  UNIQUE(comment_id, user_id)
);

-- ============================================
-- WORKER STATE
-- ============================================

CREATE TABLE worker_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE worker_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  module TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_kills_game ON kills(game_id);
CREATE INDEX idx_kills_killer ON kills(killer_id);
CREATE INDEX idx_kills_victim ON kills(victim_id);
CREATE INDEX idx_kills_status ON kills(status);
CREATE INDEX idx_kills_kc_killer ON kills(kc_is_killer) WHERE kc_is_killer = true;
CREATE INDEX idx_kills_kc_victim ON kills(kc_is_victim) WHERE kc_is_victim = true;
CREATE INDEX idx_kills_avg_rating ON kills(avg_rating DESC);
CREATE INDEX idx_kills_created ON kills(created_at DESC);
CREATE INDEX idx_kills_type ON kills(kill_type);

CREATE INDEX idx_ratings_kill ON ratings(kill_id);
CREATE INDEX idx_ratings_user ON ratings(user_id);
CREATE INDEX idx_comments_kill ON comments(kill_id);
CREATE INDEX idx_comments_parent ON comments(parent_id);

CREATE INDEX idx_games_match ON games(match_id);
CREATE INDEX idx_participants_game ON game_participants(game_id);
CREATE INDEX idx_participants_player ON game_participants(player_id);

CREATE INDEX idx_assists_kill ON kill_assists(kill_id);
CREATE INDEX idx_tags_kill ON kill_tags(kill_id);
CREATE INDEX idx_tags_tag ON kill_tags(tag);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Update avg_rating on kills when a rating is inserted/updated/deleted
CREATE OR REPLACE FUNCTION update_kill_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE kills SET
    avg_rating = COALESCE((SELECT AVG(score)::FLOAT FROM ratings WHERE kill_id = COALESCE(NEW.kill_id, OLD.kill_id)), 0),
    rating_count = (SELECT COUNT(*) FROM ratings WHERE kill_id = COALESCE(NEW.kill_id, OLD.kill_id)),
    updated_at = now()
  WHERE id = COALESCE(NEW.kill_id, OLD.kill_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_kill_rating
  AFTER INSERT OR UPDATE OR DELETE ON ratings
  FOR EACH ROW EXECUTE FUNCTION update_kill_rating();

-- Update comment_count on kills
CREATE OR REPLACE FUNCTION update_kill_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE kills SET
    comment_count = (SELECT COUNT(*) FROM comments WHERE kill_id = COALESCE(NEW.kill_id, OLD.kill_id)),
    updated_at = now()
  WHERE id = COALESCE(NEW.kill_id, OLD.kill_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_kill_comment_count
  AFTER INSERT OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION update_kill_comment_count();

-- Update profile stats
CREATE OR REPLACE FUNCTION update_profile_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'ratings' THEN
    UPDATE profiles SET total_ratings = (
      SELECT COUNT(*) FROM ratings WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
    ) WHERE id = COALESCE(NEW.user_id, OLD.user_id);
  ELSIF TG_TABLE_NAME = 'comments' THEN
    UPDATE profiles SET total_comments = (
      SELECT COUNT(*) FROM comments WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
    ) WHERE id = COALESCE(NEW.user_id, OLD.user_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_profile_ratings
  AFTER INSERT OR DELETE ON ratings
  FOR EACH ROW EXECUTE FUNCTION update_profile_stats();

CREATE TRIGGER trigger_update_profile_comments
  AFTER INSERT OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION update_profile_stats();

-- Comment vote count
CREATE OR REPLACE FUNCTION update_comment_upvotes()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE comments SET
    upvotes = COALESCE((SELECT SUM(vote) FROM comment_votes WHERE comment_id = COALESCE(NEW.comment_id, OLD.comment_id)), 0)
  WHERE id = COALESCE(NEW.comment_id, OLD.comment_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_comment_upvotes
  AFTER INSERT OR UPDATE OR DELETE ON comment_votes
  FOR EACH ROW EXECUTE FUNCTION update_comment_upvotes();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_votes ENABLE ROW LEVEL SECURITY;

-- Profiles: anyone can read, only owner can update
CREATE POLICY "profiles_read" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Ratings: anyone can read, authenticated users can insert/update their own
CREATE POLICY "ratings_read" ON ratings FOR SELECT USING (true);
CREATE POLICY "ratings_insert" ON ratings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ratings_update" ON ratings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "ratings_delete" ON ratings FOR DELETE USING (auth.uid() = user_id);

-- Comments: anyone can read, authenticated users manage their own
CREATE POLICY "comments_read" ON comments FOR SELECT USING (true);
CREATE POLICY "comments_insert" ON comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comments_update" ON comments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "comments_delete" ON comments FOR DELETE USING (auth.uid() = user_id);

-- Comment votes
CREATE POLICY "votes_read" ON comment_votes FOR SELECT USING (true);
CREATE POLICY "votes_insert" ON comment_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "votes_update" ON comment_votes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "votes_delete" ON comment_votes FOR DELETE USING (auth.uid() = user_id);

-- Public read access for game data
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE kills ENABLE ROW LEVEL SECURITY;
ALTER TABLE kill_assists ENABLE ROW LEVEL SECURITY;
ALTER TABLE kill_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON tournaments FOR SELECT USING (true);
CREATE POLICY "public_read" ON teams FOR SELECT USING (true);
CREATE POLICY "public_read" ON players FOR SELECT USING (true);
CREATE POLICY "public_read" ON matches FOR SELECT USING (true);
CREATE POLICY "public_read" ON games FOR SELECT USING (true);
CREATE POLICY "public_read" ON game_participants FOR SELECT USING (true);
CREATE POLICY "public_read" ON kills FOR SELECT USING (true);
CREATE POLICY "public_read" ON kill_assists FOR SELECT USING (true);
CREATE POLICY "public_read" ON kill_tags FOR SELECT USING (true);

-- ============================================
-- SEED DATA: KC 2026 LEC ROSTER
-- ============================================

INSERT INTO teams (name, slug, short_name, is_tracked) VALUES
  ('Karmine Corp', 'karmine-corp', 'KC', true),
  ('G2 Esports', 'g2-esports', 'G2', false),
  ('Fnatic', 'fnatic', 'FNC', false),
  ('Team BDS', 'team-bds', 'BDS', false),
  ('MAD Lions KOI', 'mad-lions-koi', 'MAD', false),
  ('SK Gaming', 'sk-gaming', 'SK', false),
  ('Rogue', 'rogue', 'RGE', false),
  ('Team Heretics', 'team-heretics', 'TH', false),
  ('Team Vitality', 'team-vitality', 'VIT', false),
  ('GIANTX', 'giantx', 'GX', false);

INSERT INTO players (summoner_name, slug, role, team_id, real_name) VALUES
  ('Canna', 'canna', 'top', (SELECT id FROM teams WHERE slug = 'karmine-corp'), 'Kim Chang-dong'),
  ('Yike', 'yike', 'jungle', (SELECT id FROM teams WHERE slug = 'karmine-corp'), 'Martin Sundelin'),
  ('Kyeahoo', 'kyeahoo', 'mid', (SELECT id FROM teams WHERE slug = 'karmine-corp'), NULL),
  ('Caliste', 'caliste', 'adc', (SELECT id FROM teams WHERE slug = 'karmine-corp'), NULL),
  ('Busio', 'busio', 'support', (SELECT id FROM teams WHERE slug = 'karmine-corp'), NULL);

INSERT INTO tournaments (name, slug, region, split, year) VALUES
  ('LEC Spring 2026', 'lec-spring-2026', 'LEC', 'Spring', 2026),
  ('LEC Versus 2026', 'lec-versus-2026', 'LEC', 'Versus', 2026);
