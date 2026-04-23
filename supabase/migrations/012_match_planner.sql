-- Migration 012 — Match planner foundation
--
-- Stocke les matchs KC à venir (next 21 jours) discoverés par le module
-- `match_planner`. Le `job_runner` lit `worker_jobs` (déjà migration 009)
-- pour déclencher les boost runs sentinel/harvester aux bons moments.
--
-- Pourquoi : sentinel default à 5min d'intervalle. Si un game KC commence
-- à 18:00:30 et le dernier sentinel a tourné à 18:00:00, on rate les
-- premières 5min de kills. Avec pre-scheduling, on sait qu'à 17:55:00
-- faut basculer en boost mode 30s/scan, et redescendre à idle après le
-- match.
--
-- Le module match_planner tourne toutes les 1h, refresh la liste, et
-- queue les jobs `sentinel.boost` dans worker_jobs pour les matches
-- des prochaines 24h.

CREATE TABLE IF NOT EXISTS scheduled_matches (
    -- LolEsports match ID. PK naturelle, idempotent à l'upsert.
    external_id TEXT PRIMARY KEY,
    scheduled_at TIMESTAMPTZ NOT NULL,
    state TEXT NOT NULL DEFAULT 'unstarted' CHECK (state IN (
        'unstarted', 'inProgress', 'completed', 'unneeded'
    )),
    opponent_code TEXT,
    opponent_name TEXT,
    league TEXT NOT NULL DEFAULT 'LEC',
    block_name TEXT,                            -- "Week 4 Day 3" etc.
    best_of INT DEFAULT 1,
    refreshed_at TIMESTAMPTZ DEFAULT now(),     -- updated each planner run
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index : rapide lookup "qu'est-ce qui se passe dans la prochaine heure"
CREATE INDEX IF NOT EXISTS idx_scheduled_matches_upcoming
    ON scheduled_matches(scheduled_at)
    WHERE state IN ('unstarted', 'inProgress');

-- Touch refreshed_at on update
CREATE OR REPLACE FUNCTION fn_touch_scheduled_match_refreshed()
RETURNS TRIGGER AS $$
BEGIN
    NEW.refreshed_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scheduled_matches_touch ON scheduled_matches;
CREATE TRIGGER trg_scheduled_matches_touch
BEFORE UPDATE ON scheduled_matches
FOR EACH ROW EXECUTE FUNCTION fn_touch_scheduled_match_refreshed();

-- ─── worker_jobs needs a unique constraint for idempotent boost queue ─
-- The match_planner upserts on (kind, scheduled_for) so a 2nd planner
-- run within the same hour doesn't queue duplicate boost jobs for the
-- same match.

ALTER TABLE worker_jobs
    ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_jobs_kind_schedule
    ON worker_jobs(kind, scheduled_for)
    WHERE status = 'pending';

-- ─── RLS — backoffice only ────────────────────────────────────────────

ALTER TABLE scheduled_matches ENABLE ROW LEVEL SECURITY;

-- ─── Comments ─────────────────────────────────────────────────────────

COMMENT ON TABLE scheduled_matches IS
    'KC matches dans les 21 prochains jours, refreshed toutes les 1h '
    'par modules/match_planner. Lu par sentinel/harvester pour ajuster '
    'leur cadence (boost mode pendant les matchs live).';

COMMENT ON COLUMN scheduled_matches.refreshed_at IS
    'Dernière refresh par match_planner. Si > 24h, les données sont '
    'stale et le planner devrait re-poll urgent.';
