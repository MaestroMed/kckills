-- ════════════════════════════════════════════════════════════════════════════
-- KCKILLS — V1 schema alignment with ARCHITECTURE.md section 6
-- ════════════════════════════════════════════════════════════════════════════
-- Adds every Phase 1+ column on `kills` as nullable so the schema is
-- forward-compatible with:
--   - canonical clip identity (content_hash, perceptual_hash, event_id)
--   - dense tag taxonomy (8 dimensions, see ARCHITECTURE.md §3.5)
--   - tag tier system (bronze→diamond)
--   - rarity + flags + sets (Phase 2 visual layer, computed not assigned)
--   - semantic embedding (Phase 3 sphere)
--
-- Nothing here is populated by V1 ingestion — the worker fills these as
-- the metadata foundation work in Phase 1 lands. The point of running
-- the migration NOW is to avoid a schema-blocked refactor later: every
-- new clip already has the columns waiting for it.
--
-- pgvector extension is NOT enabled here — embeddings ship in Phase 3
-- and need explicit Supabase project setting changes. The column type
-- is reserved as TEXT for now so the column exists; we'll ALTER it to
-- vector(512) in a future migration when pgvector is enabled.
--
-- Idempotent: every ADD COLUMN uses IF NOT EXISTS, every CREATE INDEX
-- uses IF NOT EXISTS. Re-runnable.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Canonical identity (Phase 1) ──────────────────────────────────────────
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS content_hash       TEXT,    -- SHA-256 of the H format MP4
    ADD COLUMN IF NOT EXISTS perceptual_hash    TEXT,    -- pHash on the thumbnail JPEG
    ADD COLUMN IF NOT EXISTS event_id           TEXT,    -- canonical e.g. "LEC_2024_Spring_KCvG2"
    ADD COLUMN IF NOT EXISTS canonical_game_id  TEXT,    -- canonical Leaguepedia game id
    ADD COLUMN IF NOT EXISTS patch              TEXT,    -- e.g. "14.1"
    ADD COLUMN IF NOT EXISTS source_url         TEXT,    -- VOD or community submission URL
    ADD COLUMN IF NOT EXISTS source_platform    TEXT,    -- youtube|twitch|reddit|x|tiktok
    ADD COLUMN IF NOT EXISTS original_creator   TEXT,    -- channel/handle that posted the source
    ADD COLUMN IF NOT EXISTS source_upload_date TIMESTAMPTZ;

-- ─── Identity tags — Dimension 1 (WHO) ────────────────────────────────────
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS player_primary    TEXT,
    ADD COLUMN IF NOT EXISTS players_involved  TEXT[],
    ADD COLUMN IF NOT EXISTS players_affected  TEXT[],
    ADD COLUMN IF NOT EXISTS team_primary      TEXT,
    ADD COLUMN IF NOT EXISTS teams_involved    TEXT[];

-- ─── Context tags — Dimension 2 (WHEN/WHERE) ──────────────────────────────
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS event_tier        TEXT,    -- international|regional_playoff|regional|league|amateur
    ADD COLUMN IF NOT EXISTS split             TEXT,    -- spring|summer|winter
    ADD COLUMN IF NOT EXISTS year              INTEGER,
    ADD COLUMN IF NOT EXISTS region            TEXT,    -- EU|KR|NA|CN|...
    ADD COLUMN IF NOT EXISTS stage_canonical   TEXT;    -- regular|playoff|grand_finals|...

-- ─── Champion tags — Dimension 3 ──────────────────────────────────────────
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS champion_primary    TEXT,
    ADD COLUMN IF NOT EXISTS champions_involved  TEXT[],
    ADD COLUMN IF NOT EXISTS champions_defeated  TEXT[],
    ADD COLUMN IF NOT EXISTS role_canonical      TEXT,  -- top|jungle|mid|bot|support
    ADD COLUMN IF NOT EXISTS role_matchup        TEXT[];

-- ─── Action tags — Dimension 4 ────────────────────────────────────────────
-- action_primary uses an open TEXT field rather than an enum so future
-- additions (steal_variants, mechanic specifics) don't need a migration.
-- Application code is the source of truth for the canonical list.
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS action_primary     TEXT,
    ADD COLUMN IF NOT EXISTS action_secondary   TEXT[],
    ADD COLUMN IF NOT EXISTS mechanic_highlight TEXT[];

-- ─── Situation tags — Dimension 5 ─────────────────────────────────────────
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS game_phase_canonical TEXT,  -- early|laning|mid|late|closing
    ADD COLUMN IF NOT EXISTS situation            TEXT,  -- 1v1|1v2|...|teamfight|skirmish
    ADD COLUMN IF NOT EXISTS team_gold_diff       TEXT,  -- 'kc_ahead_5k', 'opp_ahead_2k', ...
    ADD COLUMN IF NOT EXISTS team_status          TEXT,  -- snowballing|behind|even
    ADD COLUMN IF NOT EXISTS objective_active     TEXT;  -- finer than objective_context

-- ─── Stakes tags — Dimension 6 ────────────────────────────────────────────
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS series_context        TEXT,    -- bo1|bo3|bo5|elimination|tiebreaker
    ADD COLUMN IF NOT EXISTS match_point           BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS comeback_moment       BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS historic_significance TEXT;    -- routine|notable|iconic|legendary

-- ─── Production / Sensory — Dimension 7 ───────────────────────────────────
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS caster_reaction_score FLOAT,   -- 0..1
    ADD COLUMN IF NOT EXISTS crowd_reaction_score  FLOAT,   -- 0..1
    ADD COLUMN IF NOT EXISTS music_intensity       FLOAT,   -- 0..1
    ADD COLUMN IF NOT EXISTS visual_quality        TEXT,    -- low|standard|high
    ADD COLUMN IF NOT EXISTS has_broadcast_overlay BOOLEAN,
    ADD COLUMN IF NOT EXISTS caster_language       TEXT,    -- fr|en|es|...
    ADD COLUMN IF NOT EXISTS casters               TEXT[];

-- ─── KC-specific (Phase 2) — Dimension 8 ──────────────────────────────────
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS kc_roster_era    TEXT,    -- 'lfl-2021', 'lec-2025-winter', ...
    ADD COLUMN IF NOT EXISTS kc_event_type    TEXT,    -- 'kcx', 'showmatch', 'official', ...
    ADD COLUMN IF NOT EXISTS presence_of      TEXT[],  -- ['Kameto','Prime','Cabochard cameo', ...]
    ADD COLUMN IF NOT EXISTS stream_context   BOOLEAN DEFAULT false;

-- ─── System / quality (Phase 1+) ──────────────────────────────────────────
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS tag_tier         TEXT DEFAULT 'bronze'
        CHECK (tag_tier IN ('bronze','silver','gold','platinum','diamond')),
    ADD COLUMN IF NOT EXISTS verified         BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS verification_confidence FLOAT;  -- 0..1, distinct from `confidence` (which is killer-victim mapping)

-- ─── Semantic embedding (Phase 3) ─────────────────────────────────────────
-- Reserved as TEXT for now. ALTER TABLE ... TYPE vector(512) USING ...
-- ships in a Phase 3 migration once the pgvector extension is enabled
-- on the Supabase project.
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS semantic_embedding TEXT;

-- ─── TCG visual layer (Phase 2) ───────────────────────────────────────────
ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS rarity_score INT,    -- 0..100, computed
    ADD COLUMN IF NOT EXISTS rarity       TEXT
        CHECK (rarity IN ('common','uncommon','rare','epic','legendary','mythic')),
    ADD COLUMN IF NOT EXISTS flags        TEXT[]; -- ['classic','legendary','matchpoint','outplay',...]

-- ─── Sets — clips can belong to multiple curated anthologies (Phase 2) ────
-- Stored as a join table rather than an array on `kills` so set membership
-- is queryable cheaply (e.g. "all clips in 'KC at Worlds'").
CREATE TABLE IF NOT EXISTS clip_sets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT UNIQUE NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    cover_url   TEXT,
    sort_order  INT DEFAULT 0,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clip_set_members (
    set_id  UUID REFERENCES clip_sets(id) ON DELETE CASCADE,
    kill_id UUID REFERENCES kills(id) ON DELETE CASCADE,
    PRIMARY KEY (set_id, kill_id)
);

-- ─── Indexes ───────────────────────────────────────────────────────────────
-- Equality lookups Phase 1 reads/writes will use most.
CREATE INDEX IF NOT EXISTS idx_kills_content_hash    ON kills(content_hash);
CREATE INDEX IF NOT EXISTS idx_kills_event_id        ON kills(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kills_canonical_game  ON kills(canonical_game_id) WHERE canonical_game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kills_player_primary  ON kills(player_primary) WHERE player_primary IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kills_team_primary    ON kills(team_primary) WHERE team_primary IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kills_action_primary  ON kills(action_primary) WHERE action_primary IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kills_rarity          ON kills(rarity) WHERE rarity IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kills_tag_tier        ON kills(tag_tier);
CREATE INDEX IF NOT EXISTS idx_kills_verified        ON kills(verified) WHERE verified = true;
CREATE INDEX IF NOT EXISTS idx_kills_match_point     ON kills(match_point) WHERE match_point = true;
CREATE INDEX IF NOT EXISTS idx_kills_comeback        ON kills(comeback_moment) WHERE comeback_moment = true;

-- GIN indexes for the array columns we'll query the most.
CREATE INDEX IF NOT EXISTS idx_kills_flags_gin               ON kills USING GIN (flags);
CREATE INDEX IF NOT EXISTS idx_kills_players_involved_gin    ON kills USING GIN (players_involved);
CREATE INDEX IF NOT EXISTS idx_kills_champions_involved_gin  ON kills USING GIN (champions_involved);
CREATE INDEX IF NOT EXISTS idx_kills_action_secondary_gin    ON kills USING GIN (action_secondary);
CREATE INDEX IF NOT EXISTS idx_kills_mechanic_highlight_gin  ON kills USING GIN (mechanic_highlight);

-- Set membership index — point reads from the join table both ways.
CREATE INDEX IF NOT EXISTS idx_clip_set_members_kill ON clip_set_members(kill_id);

-- ─── Forward-compat note ──────────────────────────────────────────────────
-- When pgvector is enabled in a future migration:
--   ALTER TABLE kills ALTER COLUMN semantic_embedding TYPE vector(512)
--     USING semantic_embedding::vector;
--   CREATE INDEX kills_embedding_ivfflat ON kills USING ivfflat (semantic_embedding vector_cosine_ops) WITH (lists = 100);
