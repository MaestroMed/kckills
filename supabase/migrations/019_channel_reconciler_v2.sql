-- Migration 019 — Channel reconciler v2 (PR18)
-- Pre-2024 LFL/EUM/Worlds support, Kameto Clips parsing, KC official
-- content_type, match_context_videos.

-- ─── 1. channel_videos.content_type ───────────────────────────────────
ALTER TABLE channel_videos
    ADD COLUMN IF NOT EXISTS content_type TEXT;

COMMENT ON COLUMN channel_videos.content_type IS
    'Granular video kind (post-v2 reconciler). Values: highlights, '
    'single_game, voicecomms, debrief, post_match, interview, '
    'funny_moment, kameto_clip. Nullable for v1 backward-compat.';

CREATE INDEX IF NOT EXISTS idx_channel_videos_content_type
    ON channel_videos(content_type)
    WHERE content_type IS NOT NULL;

-- ─── 2. match_context_videos ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_context_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_external_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
    content_type TEXT NOT NULL CHECK (content_type IN (
        'voicecomms', 'debrief', 'post_match',
        'interview', 'funny_moment', 'kameto_clip'
    )),
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    published_at TIMESTAMPTZ,
    display_priority INT DEFAULT 50,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (match_external_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_match_context_videos_match
    ON match_context_videos(match_external_id, display_priority, published_at DESC);

ALTER TABLE match_context_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read context videos" ON match_context_videos
    FOR SELECT USING (TRUE);

-- Auto-set display_priority by content_type
CREATE OR REPLACE FUNCTION fn_match_context_video_priority()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.display_priority IS NULL OR NEW.display_priority = 50 THEN
        NEW.display_priority := CASE NEW.content_type
            WHEN 'voicecomms'   THEN 10
            WHEN 'post_match'   THEN 20
            WHEN 'debrief'      THEN 30
            WHEN 'interview'    THEN 40
            WHEN 'kameto_clip'  THEN 60
            WHEN 'funny_moment' THEN 80
            ELSE 50
        END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_match_context_priority ON match_context_videos;
CREATE TRIGGER trg_match_context_priority
BEFORE INSERT ON match_context_videos
FOR EACH ROW EXECUTE FUNCTION fn_match_context_video_priority();

-- ─── 3. Seed historical tournaments KC played in ──────────────────────
-- Only KC-played splits — sourced from web/src/lib/eras.ts
INSERT INTO tournaments (external_id, name, slug, league_id, year, split, start_date, end_date)
VALUES
    -- LFL (KC's roots, 2021-2023)
    (NULL, 'LFL Spring 2021',  'lfl-2021-spring',  '105266088231635581', 2021, 'spring', '2021-01-12', '2021-04-15'),
    (NULL, 'LFL Summer 2021',  'lfl-2021-summer',  '105266088231635581', 2021, 'summer', '2021-06-01', '2021-08-30'),
    (NULL, 'LFL Spring 2022',  'lfl-2022-spring',  '105266088231635581', 2022, 'spring', '2022-01-10', '2022-04-15'),
    (NULL, 'LFL Summer 2022',  'lfl-2022-summer',  '105266088231635581', 2022, 'summer', '2022-06-01', '2022-09-30'),
    (NULL, 'LFL Spring 2023',  'lfl-2023-spring',  '105266088231635581', 2023, 'spring', '2023-01-15', '2023-04-20'),
    (NULL, 'LFL Summer 2023',  'lfl-2023-summer',  '105266088231635581', 2023, 'summer', '2023-06-01', '2023-09-15'),
    -- EU Masters (3 KC titles)
    (NULL, 'EU Masters Spring 2021', 'eum-2021-spring', '100695891328981122', 2021, 'spring', '2021-04-13', '2021-05-02'),
    (NULL, 'EU Masters Summer 2021', 'eum-2021-summer', '100695891328981122', 2021, 'summer', '2021-08-30', '2021-09-19'),
    (NULL, 'EU Masters Spring 2022', 'eum-2022-spring', '100695891328981122', 2022, 'spring', '2022-04-12', '2022-05-07'),
    (NULL, 'EU Masters Summer 2022', 'eum-2022-summer', '100695891328981122', 2022, 'summer', '2022-08-30', '2022-09-25'),
    -- LEC (2024+)
    (NULL, 'LEC Winter 2024',  'lec-2024-winter',  '98767991302996019',  2024, 'winter', '2024-01-13', '2024-03-10'),
    (NULL, 'LEC Spring 2024',  'lec-2024-spring',  '98767991302996019',  2024, 'spring', '2024-03-16', '2024-05-15'),
    (NULL, 'LEC Summer 2024',  'lec-2024-summer',  '98767991302996019',  2024, 'summer', '2024-06-15', '2024-09-08'),
    (NULL, 'LEC Winter 2025',  'lec-2025-winter',  '98767991302996019',  2025, 'winter', '2025-01-18', '2025-03-02'),
    (NULL, 'LEC Spring 2025',  'lec-2025-spring',  '98767991302996019',  2025, 'spring', '2025-04-15', '2025-06-15'),
    (NULL, 'LEC Summer 2025',  'lec-2025-summer',  '98767991302996019',  2025, 'summer', '2025-07-01', '2025-09-26'),
    (NULL, 'LEC Versus 2026',  'lec-2026-versus',  '98767991302996019',  2026, 'versus', '2026-01-12', '2026-03-08'),
    (NULL, 'LEC Spring 2026',  'lec-2026-spring',  '98767991302996019',  2026, 'spring', '2026-03-15', '2026-06-30'),
    -- International
    (NULL, 'First Stand 2025', 'first-stand-2025', '113364433460319307', 2025, NULL,     '2025-03-10', '2025-03-16')
ON CONFLICT (slug) DO NOTHING;

-- ─── 4. Add OTPLOL (LFL aggregator) channel ──────────────────────────
INSERT INTO channels (id, handle, display_name, role, is_active, notes)
VALUES
    ('UC0bsR5XJWBcCS-XZAjdLpNQ', '@OTPLOL_',
     'OTPLOL', 'lfl_highlights', TRUE,
     'LFL highlights aggregator — primary source for KC LFL 2021-2023.')
ON CONFLICT (id) DO NOTHING;

-- ─── 5. RPC : context videos for a match ─────────────────────────────
CREATE OR REPLACE FUNCTION fn_get_match_context_videos(p_match_ext_id TEXT)
RETURNS TABLE (
    video_id TEXT,
    content_type TEXT,
    title TEXT,
    url TEXT,
    channel_handle TEXT,
    channel_display_name TEXT,
    published_at TIMESTAMPTZ,
    display_priority INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.video_id,
        m.content_type,
        m.title,
        m.url,
        c.handle,
        c.display_name,
        m.published_at,
        m.display_priority
    FROM match_context_videos m
    LEFT JOIN channels c ON c.id = m.channel_id
    WHERE m.match_external_id = p_match_ext_id
    ORDER BY m.display_priority ASC, m.published_at DESC NULLS LAST
    LIMIT 20;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION fn_get_match_context_videos(TEXT) TO anon, authenticated;
