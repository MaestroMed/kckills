-- ═══════════════════════════════════════════════════════════════════════
-- Migration 048 — Kills.ai_clip_context anti-pollution column (2026-04-26)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Why this exists
-- ───────────────
-- User feedback (2026-04-26) : "j'ai pas mal de clips qui sont des bouts
-- d'entre game, de plateau post game ou avant, draft, parfois mal
-- découpé". Pollution on the scroll feed.
--
-- Root cause : the analyzer's old `kill_visible_on_screen` field only
-- asked "is the kill on screen" — Gemini answered TRUE for any LoL
-- gameplay it saw, including replays, draft phases, plateau studio
-- shots, end-of-game lobbies, and split-screen transitions between
-- BO games.
--
-- Wave 12 fix : the analyzer prompt now also asks Gemini to classify
-- the clip context into one of 8 categories. The publish gate accepts
-- ONLY `live_gameplay` ; everything else (replay / draft / lobby /
-- loading / plateau / transition / other) gets `kill_visible=false`
-- forced at write time so the existing scroll-feed filter
-- (`kill_visible !== false`) hides it.
--
-- Storing the context separately from kill_visible has two benefits :
--   1. Observability — admin dashboard can chart "% pollution by source"
--      and the operator can see which sources (channel, era, casters)
--      generate the most non-gameplay clips.
--   2. Future tuning — if it turns out that some `replay` clips are
--      actually worth publishing (e.g. a clean LEC official replay of
--      a pentakill), we can relax the gate by clip_context value
--      without re-running Gemini on the entire backlog.
--
-- Schema
-- ──────
-- One nullable TEXT column with a CHECK constraint enumerating the
-- allowed values. NULL means "the analyzer hasn't tagged this row yet"
-- (rows that pre-date this migration). Existing published rows stay
-- visible because the frontend filter is `kill_visible !== false`,
-- not `clip_context = 'live_gameplay'`.
--
-- Rollback
-- ────────
-- DROP CONSTRAINT then DROP COLUMN. Safe — the analyzer falls back to
-- skipping the column write if PGRST204 (column not found).

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS ai_clip_context TEXT;

ALTER TABLE kills
    DROP CONSTRAINT IF EXISTS kills_ai_clip_context_check;

ALTER TABLE kills
    ADD CONSTRAINT kills_ai_clip_context_check
        CHECK (ai_clip_context IS NULL OR ai_clip_context IN (
            'live_gameplay',
            'replay',
            'draft',
            'lobby',
            'loading',
            'plateau',
            'transition',
            'other'
        ));

COMMENT ON COLUMN kills.ai_clip_context IS
    'Wave 12 anti-pollution categorisation by Gemini. Only live_gameplay '
    'rows are eligible for publication ; everything else also gets '
    'kill_visible=false forced at analyzer write time so the existing '
    'frontend filter hides them. NULL = pre-migration rows (still '
    'visible if kill_visible=true, by design).';

-- ─── Partial index for the QC dashboard ───────────────────────────
-- The future admin dashboard tile "% pollution by source" needs to
-- group by ai_clip_context where != 'live_gameplay'. A small partial
-- index keeps that aggregation cheap as the table grows.

CREATE INDEX IF NOT EXISTS idx_kills_clip_context_pollution
    ON kills(ai_clip_context, created_at DESC)
 WHERE ai_clip_context IS NOT NULL
   AND ai_clip_context <> 'live_gameplay';

COMMENT ON INDEX idx_kills_clip_context_pollution IS
    'Partial index for the admin pollution dashboard. Excludes the '
    'happy-path live_gameplay rows (the majority once the worker '
    'catches up) so the index only carries the noise we care about.';
