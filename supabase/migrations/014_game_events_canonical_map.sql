-- Migration 014 — Canonical game_events map (PR6-B)
--
-- THE PROBLEM
--
-- Today, the `kills` table mixes two concerns :
--   1. WHAT happened in the game (event metadata : champions, time, type)
--   2. WHERE we are in processing (status: raw → ... → published)
--
-- Result : we have no single source of truth telling us "for game X, here
-- are ALL the events we know about, regardless of clip status". The
-- pipeline can re-detect the same event, or — worse — silently skip an
-- event because the upstream module crashed and there's no audit trail
-- saying "we expected to see a kill at 12:34 but no clip was produced".
--
-- THE SOLUTION
--
-- A canonical `game_events` table where :
--   * Every detectable in-game moment gets exactly one row, BEFORE any
--     processing kicks off. The MAP comes first.
--   * Strong typing via CHECK on `event_type` (solo_kill, teamfight, dragon_taken, ...)
--   * Each row tracks a QC checklist (qc_clip_produced, qc_visible, ...)
--     instead of conflating "is the clip ready" with "is it ready to publish".
--   * A derived `is_publishable` STORED column is the single signal — if a
--     row goes from FALSE to TRUE, the event_publisher picks it up and
--     surfaces it on the site. If admin marks qc_human_approved=FALSE, the
--     event drops back to unpublished without the pipeline second-guessing.
--
-- Backwards compatibility : existing `kills` and `moments` tables stay.
-- Each game_event row carries a soft FK back to either, so the legacy
-- pipeline keeps working while we migrate consumers over to game_events.
--
-- The user's words : "tu fais une table profonde, et après on coche les
-- cases dès qu'on a les clips propres, bien QC checked".

-- ─── 1. The canonical events table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) NOT NULL,

    -- WHAT — strongly-typed event class. New types ship via this whitelist.
    event_type TEXT NOT NULL CHECK (event_type IN (
        -- Kill-centric (already detected by harvester)
        'solo_kill',
        'duo_kill',
        'multi_kill',          -- 3+ kills in a chain (triple/quadra/penta)
        'first_blood',
        'shutdown',            -- bounty kill on a fed enemy

        -- Fight-level (derived from kill clusters)
        'skirmish',            -- 2-3 participants, short duration
        'teamfight',           -- 4+ participants
        'ace',                 -- 5 deaths on one side

        -- Objective-level (future detectors — nullable until we ship them)
        'dragon_taken',
        'baron_taken',
        'herald_taken',
        'tower_taken',
        'inhibitor_taken',
        'nexus_taken',
        'objective_steal',     -- enemy steal of dragon/baron we set up

        -- Pre-fight setup
        'gank',                -- jungler arrival on a lane
        'invade',              -- early-game enemy jungle entry
        'pick',                -- catch a lone enemy

        -- Catch-all
        'other'
    )),

    -- Subtype for the multi_kill family (NULL for non-kill events)
    multi_kill_grade TEXT CHECK (multi_kill_grade IN (
        'double','triple','quadra','penta',NULL
    )),

    -- WHEN — both wall-clock (for VOD sync) and game-time (for display)
    event_epoch BIGINT NOT NULL,
    game_time_seconds INT NOT NULL,
    duration_seconds INT,                          -- NULL for instant events

    -- WHO — denormalized for fast feed queries (no JOIN needed)
    primary_actor_player_id UUID REFERENCES players(id),
    primary_actor_team_id UUID REFERENCES teams(id),
    primary_actor_champion TEXT,
    primary_target_player_id UUID REFERENCES players(id),
    primary_target_team_id UUID REFERENCES teams(id),
    primary_target_champion TEXT,
    secondary_actors JSONB DEFAULT '[]',           -- assist players, teamfight participants

    -- WHERE — game-state context (gold, side advantage)
    blue_team_gold INT,
    red_team_gold INT,
    gold_swing INT,                                 -- positive = blue gained, negative = red gained

    -- KC RELEVANCE — the filter that drives /scroll inclusion
    kc_involvement TEXT CHECK (kc_involvement IN (
        'kc_winner',           -- KC made the play
        'kc_loser',            -- KC took the loss
        'kc_neutral',          -- both teams active, KC mixed result
        'no_kc'                -- non-KC event (kept for completeness, never published)
    )),

    -- LEGACY LINKS — soft FK to existing tables during migration
    kill_id UUID REFERENCES kills(id),
    moment_id UUID REFERENCES moments(id),

    -- ─── QC CHECKLIST ──────────────────────────────────────────────────
    -- Each gate is an explicit boolean. Modules tick them as they run.
    -- NULL = "not yet evaluated" (treated as failing for blocking gates,
    --        passing for permissive gates — see is_publishable below).

    -- Hard gates (block publication when FALSE)
    qc_clip_produced BOOLEAN DEFAULT FALSE,         -- clipper succeeded, clip URLs set
    qc_clip_validated BOOLEAN DEFAULT FALSE,        -- clip_qc said timer drift OK
    qc_typed BOOLEAN DEFAULT FALSE,                 -- event_type confirmed (auto or human)
    qc_described BOOLEAN DEFAULT FALSE,             -- ai_description passed validate_description

    -- Permissive gates (block only when explicitly FALSE; NULL passes)
    qc_visible BOOLEAN,                             -- gemini said event visible on screen
    qc_human_approved BOOLEAN,                      -- explicit admin OK; NULL = no review yet

    -- Single derived signal — TRUE iff every hard gate is TRUE and no
    -- permissive gate is FALSE. Generated column = always-fresh, no
    -- application code can drift from this rule.
    is_publishable BOOLEAN GENERATED ALWAYS AS (
        qc_clip_produced
        AND qc_clip_validated
        AND qc_typed
        AND qc_described
        AND (qc_visible IS NOT FALSE)
        AND (qc_human_approved IS NOT FALSE)
    ) STORED,

    -- PUBLICATION
    published_at TIMESTAMPTZ,                       -- set first time is_publishable flips to TRUE
    publish_blocked_reason TEXT,                    -- if admin sets qc_human_approved=FALSE, why

    -- METADATA
    detection_source TEXT NOT NULL DEFAULT 'auto_kill' CHECK (detection_source IN (
        'auto_kill',           -- harvester frame-diff
        'auto_moment',         -- harvester moment clustering
        'auto_objective',      -- future objective detector (dragon/baron/...)
        'manual_admin',        -- admin-inserted (rare)
        'oracle_elixir',       -- backfill from CSV
        'kameto_channel'       -- discovered via channel_reconciler
    )),
    detection_confidence TEXT NOT NULL DEFAULT 'high' CHECK (detection_confidence IN (
        'high','medium','low','estimated','verified'
    )),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─── 2. Indexes ───────────────────────────────────────────────────────

-- Per-game lookup ("show me all events in game X, ordered by time")
CREATE INDEX IF NOT EXISTS idx_game_events_game_time
    ON game_events(game_id, game_time_seconds);

-- Publication queue ("what's ready to ship to the feed?")
-- Partial index keeps the index tiny — only rows in flight, not the
-- whole 50K-row catalogue.
CREATE INDEX IF NOT EXISTS idx_game_events_publishable_pending
    ON game_events(updated_at DESC)
    WHERE is_publishable = TRUE AND published_at IS NULL;

-- Type filter for category pages (/records, /multikills)
CREATE INDEX IF NOT EXISTS idx_game_events_type_kc
    ON game_events(event_type, published_at DESC NULLS LAST)
    WHERE kc_involvement IN ('kc_winner','kc_loser') AND published_at IS NOT NULL;

-- Backfill / audit lookups (find events for a kill / moment)
CREATE INDEX IF NOT EXISTS idx_game_events_kill_link
    ON game_events(kill_id) WHERE kill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_game_events_moment_link
    ON game_events(moment_id) WHERE moment_id IS NOT NULL;

-- Dedup constraint : prevent two rows mapping to the same kill row.
-- Soft FK so we can't use UNIQUE CONSTRAINT, but a unique partial index
-- is functionally equivalent.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_game_events_kill
    ON game_events(kill_id) WHERE kill_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_game_events_moment
    ON game_events(moment_id) WHERE moment_id IS NOT NULL;

-- ─── 3. Auto-touch updated_at + auto-fill published_at ────────────────

CREATE OR REPLACE FUNCTION fn_touch_game_event()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    -- Auto-stamp published_at the first time is_publishable becomes TRUE.
    -- We can't reference the GENERATED column in a BEFORE trigger directly,
    -- but we can compute it from the inputs.
    IF NEW.published_at IS NULL
       AND NEW.qc_clip_produced
       AND NEW.qc_clip_validated
       AND NEW.qc_typed
       AND NEW.qc_described
       AND (NEW.qc_visible IS NOT FALSE)
       AND (NEW.qc_human_approved IS NOT FALSE)
    THEN
        NEW.published_at := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_game_events_touch ON game_events;
CREATE TRIGGER trg_game_events_touch
BEFORE UPDATE ON game_events
FOR EACH ROW EXECUTE FUNCTION fn_touch_game_event();

-- ─── 4. Game-level completion flag ────────────────────────────────────
-- Tells us : "for this game, the canonical map is complete — we won't
-- discover new events on a re-poll". Set by event_mapper after one
-- mapping pass per game.

ALTER TABLE games
    ADD COLUMN IF NOT EXISTS event_mapping_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE games
    ADD COLUMN IF NOT EXISTS event_mapping_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN games.event_mapping_complete IS
    'TRUE once event_mapper has inserted one row per detected event into '
    'game_events. Idempotent — re-runs against TRUE games are no-ops.';

-- ─── 5. RLS ───────────────────────────────────────────────────────────
-- Public can read published events. Admin / service role full access.

ALTER TABLE game_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public published game_events"
    ON game_events FOR SELECT
    USING (published_at IS NOT NULL);

-- ─── 6. Backfill from existing kills + moments ────────────────────────
-- One-shot population so we don't ship an empty canonical map. Each
-- existing kill becomes a game_event with the QC gates pre-ticked
-- according to its current state. Idempotent via the unique kill_id index.

INSERT INTO game_events (
    game_id, event_type, multi_kill_grade,
    event_epoch, game_time_seconds,
    primary_actor_player_id, primary_actor_champion,
    primary_target_player_id, primary_target_champion,
    secondary_actors,
    kc_involvement,
    kill_id,
    qc_clip_produced, qc_clip_validated, qc_typed, qc_described,
    qc_visible,
    detection_source, detection_confidence
)
SELECT
    k.game_id,
    -- event_type derivation : multi_kill column wins, then fight_type, else solo_kill
    CASE
        WHEN k.is_first_blood THEN 'first_blood'
        WHEN k.multi_kill IN ('triple','quadra','penta') THEN 'multi_kill'
        WHEN k.multi_kill = 'double' THEN 'duo_kill'
        WHEN k.fight_type IN ('teamfight_5v5','teamfight_4v4') THEN 'teamfight'
        WHEN k.fight_type = 'skirmish' THEN 'skirmish'
        ELSE 'solo_kill'
    END AS event_type,
    k.multi_kill,
    k.event_epoch,
    COALESCE(k.game_time_seconds, 0),
    k.killer_player_id, k.killer_champion,
    k.victim_player_id, k.victim_champion,
    COALESCE(k.assistants, '[]'::jsonb),
    -- map tracked_team_involvement to kc_involvement
    CASE
        WHEN k.tracked_team_involvement = 'team_killer' THEN 'kc_winner'
        WHEN k.tracked_team_involvement = 'team_victim' THEN 'kc_loser'
        WHEN k.tracked_team_involvement = 'team_assist' THEN 'kc_winner'
        ELSE 'no_kc'
    END,
    k.id,
    -- QC tick logic from current kill state
    (k.clip_url_vertical IS NOT NULL),                                 -- qc_clip_produced
    (k.status IN ('analyzed','published') AND k.clip_url_vertical IS NOT NULL), -- qc_clip_validated (proxy)
    (k.killer_champion IS NOT NULL AND k.victim_champion IS NOT NULL),  -- qc_typed (basic)
    (k.ai_description IS NOT NULL AND length(k.ai_description) > 80),   -- qc_described
    k.kill_visible,                                                     -- qc_visible (NULL preserved)
    'auto_kill',
    COALESCE(k.confidence, 'high')
FROM kills k
WHERE NOT EXISTS (
    SELECT 1 FROM game_events ge WHERE ge.kill_id = k.id
)
ON CONFLICT DO NOTHING;

-- Mark games whose kills have all been mapped
UPDATE games g
SET event_mapping_complete = TRUE,
    event_mapping_completed_at = now()
WHERE g.kills_extracted = TRUE
  AND EXISTS (SELECT 1 FROM game_events ge WHERE ge.game_id = g.id)
  AND event_mapping_complete = FALSE;

-- ─── 7. Audit view : "what blocks each pending kill from publishing?" ─
-- Useful in /admin to see the QC bottleneck at a glance.

CREATE OR REPLACE VIEW v_game_events_qc_audit AS
SELECT
    ge.id,
    ge.game_id,
    ge.event_type,
    ge.kc_involvement,
    ge.is_publishable,
    ge.published_at,
    -- Reason string : list of failing gates
    CASE
        WHEN ge.is_publishable THEN 'OK'
        ELSE concat_ws(', ',
            CASE WHEN NOT ge.qc_clip_produced THEN 'no_clip' END,
            CASE WHEN NOT ge.qc_clip_validated THEN 'qc_pending' END,
            CASE WHEN NOT ge.qc_typed THEN 'untyped' END,
            CASE WHEN NOT ge.qc_described THEN 'no_description' END,
            CASE WHEN ge.qc_visible IS FALSE THEN 'not_visible' END,
            CASE WHEN ge.qc_human_approved IS FALSE THEN 'admin_blocked' END
        )
    END AS blocked_reason,
    ge.publish_blocked_reason,
    ge.created_at
FROM game_events ge;

COMMENT ON VIEW v_game_events_qc_audit IS
    'For each event, surfaces the comma-separated list of QC gates that '
    'currently block publication. Empty/OK = ready to ship.';

-- ─── 8. Comments for the schema browser ───────────────────────────────

COMMENT ON TABLE game_events IS
    'Canonical map of every detectable in-game event. ONE row per event, '
    'inserted by event_mapper post-harvest, regardless of whether a clip '
    'was produced. The QC checklist columns (qc_*) are the gates that '
    'modules tick as they run; is_publishable is derived from them and '
    'drives publication.';

COMMENT ON COLUMN game_events.event_type IS
    'Strongly-typed event class. Add new types via ALTER CONSTRAINT — '
    'no free-text classification, ever.';

COMMENT ON COLUMN game_events.is_publishable IS
    'GENERATED column. TRUE iff all hard gates green AND no permissive '
    'gate is explicitly FALSE. Single source of truth for "should this '
    'show up on the site?".';

COMMENT ON COLUMN game_events.qc_human_approved IS
    'Permissive gate. NULL = no human review yet (allowed to publish on '
    'auto-QC alone). TRUE = admin verified. FALSE = admin rejected, '
    'blocks publication and records reason in publish_blocked_reason.';
