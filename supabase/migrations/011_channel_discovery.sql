-- Migration 011 — Channel discovery foundation (K-Phase 0)
--
-- Stocke les vidéos découvertes sur les chaînes YouTube tierces (LEC,
-- Karmine Corp officiel, Kameto Clips, etc.) avant de tenter de les
-- réconcilier avec un (match, game) précis.
--
-- Le pivot Kameto VOD-only (KAMETO_PIVOT_SPEC.md v2) repose sur 3
-- channels initiaux + extension naturelle (Eto, Domingo, etc.) :
--   @LEC               UCWWZjhmokTbezUQr1kbbEYQ  highlights game-by-game
--   Karmine Corp       UCW5Ma_xnAweFIXCGOAZECAA  voicecomms / debriefs
--   Kameto Clips       UCoNvmftvPAAlozI-DTUrAng  clips courts réactions
--
-- Le module CHANNEL_DISCOVERER (à shipper) poll chaque chaîne via
-- yt-dlp toutes les 6h, insère les nouvelles vidéos, classifie via
-- regex sur le titre. La table sert de queue d'ingestion pour les
-- workers downstream (RECONCILER → CLIPPER).

-- ─── channels : les sources YouTube qu'on suit ─────────────────────
CREATE TABLE IF NOT EXISTS channels (
    -- UC ID YouTube (24 chars). Primary key naturelle.
    id TEXT PRIMARY KEY,
    handle TEXT NOT NULL,                      -- e.g. "@LEC"
    display_name TEXT NOT NULL,                -- "LEC" / "Karmine Corp" / "Kameto Clips"
    role TEXT NOT NULL CHECK (role IN (
        'lec_highlights',                      -- highlights game-by-game LEC
        'team_official',                       -- KC officiel (voicecomms / debriefs)
        'streamer_clips',                      -- Kameto Clips, Eto Clips, etc.
        'streamer_vod',                        -- VOD long format (rebroadcast)
        'lfl_highlights',                      -- LFL highlights si on en trouve un jour
        'other'
    )),
    is_active BOOLEAN DEFAULT TRUE,            -- toggle off pour mettre en pause sans suppr
    last_polled_at TIMESTAMPTZ,
    last_video_id TEXT,                        -- pour incremental discovery (skip déjà vus)
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed les 3 chaînes initiales découvertes au smoke test.
INSERT INTO channels (id, handle, display_name, role, notes)
VALUES
    ('UCWWZjhmokTbezUQr1kbbEYQ', '@LEC',
     'LEC', 'lec_highlights',
     'Game-by-game highlights post-2024. Format titre standardisé "TEAMA vs TEAMB | HIGHLIGHTS | YYYY #LEC Split - Week N Day N".'),
    ('UCW5Ma_xnAweFIXCGOAZECAA', '@KarmineCorp',
     'Karmine Corp', 'team_official',
     'Chaîne officielle KC. Voicecomms, debriefs, content non-game. Source pour les clips emotional / hero.'),
    ('UCoNvmftvPAAlozI-DTUrAng', '@KametoCorpClips',
     'Kameto Clips', 'streamer_clips',
     'Clips courts Kameto (réactions, moments fun). 1-3min chacun. Source secondaire emotional.')
ON CONFLICT (id) DO NOTHING;

-- ─── channel_videos : chaque vidéo découverte ─────────────────────
-- Cycle de vie typique :
--   discovered → classified → matched → clipped (si match KC)
--   discovered → classified → not_kc (si pas KC, on archive sans process)
--   discovered → classified → manual_review (titre ambigu)

CREATE TABLE IF NOT EXISTS channel_videos (
    -- YouTube video ID (11 chars). Primary key naturelle.
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    duration_seconds INT,
    published_at TIMESTAMPTZ,                  -- date upload YouTube
    description TEXT,                          -- si on en a besoin pour la reconciliation
    -- Pipeline state
    status TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN (
        'discovered',                          -- juste vu sur la chaîne
        'classified',                          -- titre parsé, type identifié
        'matched',                             -- réconcilié avec un (match, game)
        'clipped',                             -- les clips de cette vidéo sont produits
        'not_kc',                              -- ne contient pas KC, archivé
        'manual_review',                       -- titre ambigu, intervention humaine
        'error'
    )),
    -- Classification (filled by RECONCILER)
    video_type TEXT,                           -- 'game_highlights' | 'voicecomms' | 'debrief' | 'clip' | 'reaction' | ...
    matched_match_external_id TEXT,            -- foreign key info (pas un FK strict)
    matched_game_number INT,
    matched_at TIMESTAMPTZ,
    -- KC presence flag
    kc_relevance_score FLOAT,                  -- 0.0-1.0 : confidence que la vidéo concerne KC
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_channel_videos_pending
    ON channel_videos(channel_id, created_at DESC)
    WHERE status IN ('discovered', 'classified');

CREATE INDEX IF NOT EXISTS idx_channel_videos_matched
    ON channel_videos(matched_match_external_id, matched_game_number)
    WHERE matched_match_external_id IS NOT NULL;

-- Auto-touch updated_at
CREATE OR REPLACE FUNCTION fn_touch_channel_video_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_channel_videos_touch ON channel_videos;
CREATE TRIGGER trg_channel_videos_touch
BEFORE UPDATE ON channel_videos
FOR EACH ROW EXECUTE FUNCTION fn_touch_channel_video_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────────
-- Backoffice only. Public ne lit pas ces tables — elles sont en
-- amont du pipeline, le contenu utile finit dans `kills` / `moments`.

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_videos ENABLE ROW LEVEL SECURITY;

-- ─── Comments pour le schema browser ───────────────────────────────

COMMENT ON TABLE channels IS
    'Sources YouTube qu''on suit pour découvrir les VODs / highlights. '
    'CHANNEL_DISCOVERER poll chaque chaîne active toutes les 6h.';

COMMENT ON TABLE channel_videos IS
    'Toute vidéo découverte sur une chaîne suivie. Pipeline: '
    'discovered → classified → matched (vs un match KC) → clipped.';

COMMENT ON COLUMN channel_videos.kc_relevance_score IS
    'Confidence 0.0-1.0 que la vidéo concerne KC. Calculé par regex '
    'sur title/description. < 0.3 = not_kc, ≥ 0.7 = matched, entre = '
    'manual_review.';
