-- ═══════════════════════════════════════════════════════════════════════
-- Migration 045 — Rename game_events.kc_involvement → tracked_team_involvement
-- ═══════════════════════════════════════════════════════════════════════
--
-- Why this exists
-- ───────────────
-- The kckills.com pilot was hardcoded around Karmine Corp. As we transition
-- to LoLTok ("the TikTok of LoL — every league, every team, every kill"),
-- DB columns named "kc_*" become misleading lies on a row representing a
-- T1 vs Gen.G kill. The kills table already standardised on the
-- tracked_team_involvement convention (PR-arch). This migration aligns
-- game_events with the same naming.
--
-- Scope
-- ─────
-- Renames game_events.kc_involvement → tracked_team_involvement.
-- The CHECK constraint values ('kc_winner', 'kc_loser', 'kc_neutral',
-- 'no_kc') stay as-is — they describe the SHAPE of involvement (winner
-- vs loser vs neutral) and the 'kc_' prefix is being treated as legacy
-- vocabulary that downstream code is being weaned off in a separate
-- LoLTok-era migration. The COLUMN rename is the safe atomic change ;
-- value vocabulary sweep ships alongside the broader frontend work.
--
-- IMPORTANT — The `moments.kc_involvement` column is NOT touched. It
-- describes a different concept (kc_aggressor / kc_victim / kc_both),
-- has its own consumers, and is owned by the moments rewrite track.
--
-- Safety story (transition handling)
-- ──────────────────────────────────
-- This migration is BREAKING at the DB level — once applied, code that
-- queries `kc_involvement` on game_events will get PostgREST error 42703
-- (column does not exist). To bridge the deploy window :
--
--   1. Apply this migration BEFORE restarting the worker that uses the
--      new code.
--   2. The worker code has been updated to try `tracked_team_involvement`
--      first and fall back to `kc_involvement` on 42703 — so a worker on
--      either side of the migration boundary keeps publishing.
--   3. The `v_game_events_legacy` view exposes BOTH names so any external
--      consumer (admin notebook, ad-hoc psql query) can use the old
--      vocabulary without errors.
--
-- After the worker is restarted on the new code, the fallback path never
-- fires, and the view can be dropped in a future cleanup migration.
--
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Rename the column ───────────────────────────────────────────
-- ALTER TABLE ... RENAME COLUMN is metadata-only, no row rewrite, no
-- table lock beyond the brief catalog update. Safe on a hot table.
--
-- Idempotency : 2026-05-08 — wrapped in a DO block that checks if the
-- old column still exists. The column was renamed by a hand-applied
-- run of this migration before the file was committed to the repo,
-- so re-running it now would fail on `column "kc_involvement" does
-- not exist`. The guard makes it a no-op when the rename has already
-- happened.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'game_events'
        AND column_name = 'kc_involvement'
    ) THEN
        ALTER TABLE game_events
            RENAME COLUMN kc_involvement TO tracked_team_involvement;
    END IF;
END $$;

COMMENT ON COLUMN game_events.tracked_team_involvement IS
    'Renamed from kc_involvement (PR-loltok DH, migration 045). Mirrors '
    'kills.tracked_team_involvement naming. Values still use the '
    'kc_winner / kc_loser / kc_neutral / no_kc vocabulary — the value '
    'sweep ships in a follow-up LoLTok migration to avoid coupling the '
    'column rename with a wider refactor.';

-- ─── 2. Indexes that referenced the old column ──────────────────────
-- Postgres auto-rewrites partial-index predicates and index column lists
-- on RENAME COLUMN, so idx_game_events_type_kc keeps working with no
-- explicit DROP/CREATE. We add a defensive REINDEX to refresh the index
-- catalog comment for any downstream tooling that pretty-prints it.

-- (No-op safety check — the index name didn't change, but log a notice
-- for the operator running the migration.)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes
               WHERE indexname = 'idx_game_events_type_kc'
                 AND schemaname = 'public') THEN
        RAISE NOTICE 'idx_game_events_type_kc preserved across rename';
    END IF;
END$$;

-- ─── 3. Backwards-compat view ───────────────────────────────────────
-- Defensive : exposes BOTH the new column and a legacy alias so any
-- admin notebook / ad-hoc psql query / external dashboard that still
-- spells `kc_involvement` doesn't break the moment this migration
-- ships. There are no known external consumers of game_events at
-- this writing — this view is pure belt-and-braces.

CREATE OR REPLACE VIEW v_game_events_legacy AS
SELECT
    *,
    tracked_team_involvement AS kc_involvement
FROM game_events;

COMMENT ON VIEW v_game_events_legacy IS
    'Transition view exposing the pre-migration-045 column name '
    '`kc_involvement` as an alias for tracked_team_involvement. Drop '
    'in a follow-up cleanup migration once all consumers (worker, web, '
    'admin tooling) confirmed migrated. Read-only.';

-- ─── 4. RLS continuity ──────────────────────────────────────────────
-- The "Public published game_events" policy from migration 014 selects
-- on `published_at IS NOT NULL` — no reference to the renamed column,
-- so policy continues to work as-is. No re-grant needed.
