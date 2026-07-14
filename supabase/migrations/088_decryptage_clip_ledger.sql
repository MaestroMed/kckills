-- Migration 088 — Décryptage multi-points + méga-table clip_ledger
--
-- Spec : docs/BACKFILL_DECRYPTAGE_SPEC_FOR_FABLE.md (2026-07-14)
--
-- QUATRE morceaux :
--   A. kills.status accepte 'duplicate' / 'needs_review' + is_duplicate_of
--   B. game_vod_sources porte le modèle de drift PAR SOURCE (samples + fit)
--   C. clip_ledger — une ligne par kill canonique, tout l'audit au même endroit
--   D. v_clip_ledger_full — la vue "un coup d'œil" pour l'admin
--
-- Appliquer via le SQL editor Supabase. Idempotent (IF NOT EXISTS partout).
-- La neutralisation de masse des doublons est dans la 089 (à relire AVANT
-- d'appliquer — elle touche des milliers de lignes).

-- ═══════════════════════════════════════════════════════════════════
-- A. kills : statut 'duplicate' + lien vers le kill canonique
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE kills DROP CONSTRAINT IF EXISTS kills_status_check;
ALTER TABLE kills ADD CONSTRAINT kills_status_check CHECK (status IN (
    'raw','enriched','vod_found','clipping','clipped',
    'analyzed','published','clip_error','manual_review',
    'duplicate',        -- neutralisé par la dédup (jamais delete)
    'needs_review'      -- échec d'un check QC bloquant
));

ALTER TABLE kills
    ADD COLUMN IF NOT EXISTS is_duplicate_of UUID REFERENCES kills(id);

COMMENT ON COLUMN kills.is_duplicate_of IS
    'Si status=duplicate : pointe le kill canonique qui absorbe celui-ci. '
    'On ne supprime JAMAIS (les kill_assets / R2 restent référencés).';

-- Index partiel pour retrouver les absorbés d''un canonique
CREATE INDEX IF NOT EXISTS idx_kills_duplicate_of
    ON kills(is_duplicate_of) WHERE is_duplicate_of IS NOT NULL;

-- Le trigger de sync legacy→dims (migration 027) ne connaît pas 'duplicate'.
-- On l'étend : un kill neutralisé sort de la publication.
CREATE OR REPLACE FUNCTION fn_sync_kill_status_split()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.pipeline_status IS NOT DISTINCT FROM OLD.pipeline_status THEN
            NEW.pipeline_status := CASE
                WHEN NEW.status IN ('raw') THEN 'raw'
                WHEN NEW.status IN ('vod_found') THEN 'vod_found'
                WHEN NEW.status IN ('clipping') THEN 'clipping'
                WHEN NEW.status IN ('clipped') THEN 'clipped'
                WHEN NEW.status IN ('analyzed', 'published') THEN 'analyzed'
                WHEN NEW.status IN ('clip_error', 'manual_review') THEN 'failed'
                ELSE NEW.pipeline_status
            END;
        END IF;
        IF NEW.publication_status IS NOT DISTINCT FROM OLD.publication_status THEN
            NEW.publication_status := CASE
                WHEN NEW.status = 'published' AND NEW.kill_visible IS NOT FALSE THEN 'published'
                WHEN NEW.status = 'published' AND NEW.kill_visible = FALSE THEN 'hidden'
                WHEN NEW.status = 'analyzed' THEN 'publishable'
                WHEN NEW.status = 'manual_review' THEN 'hidden'
                -- 088 : neutralisation / mise en quarantaine → hors du feed
                WHEN NEW.status = 'duplicate' THEN 'retracted'
                WHEN NEW.status = 'needs_review' THEN 'hidden'
                ELSE NEW.publication_status
            END;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- B. game_vod_sources : le modèle de drift vit PAR SOURCE, pas par kill
-- ═══════════════════════════════════════════════════════════════════
-- drift_samples : [{"game_time":473,"vod_time":3982,"timer_read":"07:53",
--                   "method":"gemini|ocr|epoch|manual","confidence":0.95,
--                   "sampled_at":"2026-07-14T02:00:00Z"}, ...]
-- drift_model   : {"type":"constant|linear|piecewise",
--                  "segments":[{"gt_from":0,"gt_to":1320,"slope":1.0,"intercept":3509}, ...],
--                  "residual_p95":2.1,"n_samples":7,"breakpoints":[1200]}

ALTER TABLE game_vod_sources
    ADD COLUMN IF NOT EXISTS drift_samples JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS drift_model JSONB,
    ADD COLUMN IF NOT EXISTS offset_confidence NUMERIC,
    ADD COLUMN IF NOT EXISTS sync_method TEXT,
    ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

ALTER TABLE game_vod_sources DROP CONSTRAINT IF EXISTS chk_vod_sync_method;
ALTER TABLE game_vod_sources ADD CONSTRAINT chk_vod_sync_method CHECK (
    sync_method IN ('official_epoch','gemini_multipoint','ocr_multipoint',
                    'hybrid_multipoint','single_point_legacy','manual')
    OR sync_method IS NULL
);

COMMENT ON COLUMN game_vod_sources.drift_samples IS
    'Échantillons timer lus à N instants de la game (game_time ↔ vod_time). '
    'Alimenté par modules/decryptage.py. method=epoch pour les points dérivés '
    'sans vision (VOD officielle).';
COMMENT ON COLUMN game_vod_sources.drift_model IS
    'Fit du mapping game_time → vod_time : constant (LEC), linear, ou '
    'piecewise (Twitch avec pauses). Évalué par decryptage.resolve_vod_time().';

-- ═══════════════════════════════════════════════════════════════════
-- C. clip_ledger — LA méga-table : une ligne par kill canonique
-- ═══════════════════════════════════════════════════════════════════
-- Registre d''audit. Référence les tables existantes, ne les remplace pas :
--   * fichiers/versions   → kill_assets (migration 026)
--   * gates de publication → game_events.is_publishable (migration 014)
--   * offset par source    → game_vod_sources.drift_model (ci-dessus)
-- content_hash ICI n''a PAS d''index UNIQUE : c''est un journal, la détection
-- de doublon se fait par requête + clé sémantique, jamais par une contrainte
-- qui fait échouer un batch (piège 23505, cf. spec P4).

CREATE TABLE IF NOT EXISTS clip_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id UUID NOT NULL REFERENCES kills(id),
    game_id UUID NOT NULL REFERENCES games(id),

    -- Identité dénormalisée (audit d'un coup d'œil, sans JOIN)
    event_epoch BIGINT NOT NULL,
    game_time_seconds INT,
    killer_champion TEXT,
    victim_champion TEXT,
    multi_kill TEXT,

    -- Hiérarchie multi-kill (P1) : un quadra absorbe triple+double
    multi_kill_tier INT,                       -- 1..5 (1=solo)
    absorbed_kill_ids UUID[] DEFAULT '{}',     -- kills neutralisés par celui-ci
    sequence_start_epoch BIGINT,               -- 1re mort de la séquence
    sequence_end_epoch BIGINT,                 -- dernière mort

    -- Décryptage offset/drift (P2/P3) — résolu pour CE kill
    vod_source_id UUID REFERENCES game_vod_sources(id),
    resolved_offset_seconds NUMERIC,           -- offset effectif à ce game_time
    resolved_vod_time NUMERIC,                 -- position VOD du kill (calculée)
    offset_confidence NUMERIC,                 -- 0..1 (qualité du fit local)
    offset_method TEXT,                        -- cf. chk_vod_sync_method

    -- QC multi-passes (P7) : détail par check
    -- [{"name":"audio_present","verdict":"pass","score":0.98,
    --   "method":"ffprobe","detail":"aac 96kbps","checked_at":"..."}, ...]
    qc_checks JSONB DEFAULT '[]',
    qc_verdict TEXT DEFAULT 'pending' CHECK (qc_verdict IN
        ('pending','pass','reject','needs_review')),
    qc_pass_count INT DEFAULT 0,
    qc_last_run_at TIMESTAMPTZ,

    -- Assets & dédup (P4) — snapshot de l'état fichiers
    content_hash TEXT,                         -- PAS UNIQUE : registre d'audit
    perceptual_hash TEXT,
    is_duplicate_of UUID REFERENCES clip_ledger(id),
    -- {"horizontal":true,"vertical":true,"vertical_low":true,"thumbnail":true,
    --  "og_image":false,"audio_ok":true,"duration_s":40.0,"urls_synced":true}
    asset_check JSONB DEFAULT '{}',

    status TEXT,                               -- miroir de kills.status au dernier passage
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- Un seul ledger par kill : le backfill est idempotent par upsert
    CONSTRAINT uniq_clip_ledger_kill UNIQUE (kill_id)
);

CREATE INDEX IF NOT EXISTS idx_clip_ledger_game
    ON clip_ledger(game_id, game_time_seconds);
-- non-unique VOLONTAIREMENT (spec P4)
CREATE INDEX IF NOT EXISTS idx_clip_ledger_content_hash
    ON clip_ledger(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clip_ledger_needs_review
    ON clip_ledger(updated_at DESC) WHERE qc_verdict = 'needs_review';
CREATE INDEX IF NOT EXISTS idx_clip_ledger_duplicate_of
    ON clip_ledger(is_duplicate_of) WHERE is_duplicate_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clip_ledger_sequence
    ON clip_ledger(game_id, sequence_start_epoch)
    WHERE sequence_start_epoch IS NOT NULL;

-- Touch updated_at
CREATE OR REPLACE FUNCTION fn_touch_clip_ledger()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clip_ledger_touch ON clip_ledger;
CREATE TRIGGER trg_clip_ledger_touch
    BEFORE UPDATE ON clip_ledger
    FOR EACH ROW EXECUTE FUNCTION fn_touch_clip_ledger();

-- RLS : table interne (worker + admin server-side via service role).
-- Pas de policy anon → invisible du client public.
ALTER TABLE clip_ledger ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE clip_ledger IS
    'Méga-table d''audit du backfill "au crible" : une ligne par kill '
    'canonique. Sources VOD, offset résolu multi-points, hiérarchie '
    'multi-kill, verdicts QC détaillés, état des assets. Alimentée par '
    'scripts/backfill_au_crible.py + modules/decryptage.py. Ne JAMAIS '
    'supprimer une ligne : neutraliser via is_duplicate_of.';

-- ═══════════════════════════════════════════════════════════════════
-- D. Vue "un coup d'œil" pour l'admin
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_clip_ledger_full AS
SELECT
    cl.id AS ledger_id,
    cl.kill_id,
    cl.game_id,
    g.external_id AS game_external_id,
    cl.event_epoch,
    cl.game_time_seconds,
    cl.killer_champion,
    cl.victim_champion,
    cl.multi_kill,
    cl.multi_kill_tier,
    cardinality(cl.absorbed_kill_ids) AS absorbed_count,
    cl.resolved_offset_seconds,
    cl.resolved_vod_time,
    cl.offset_confidence,
    cl.offset_method,
    vs.source_type AS vod_source_type,
    vs.video_id AS vod_video_id,
    vs.offset_confidence AS source_offset_confidence,
    cl.qc_verdict,
    cl.qc_pass_count,
    cl.asset_check,
    cl.content_hash,
    cl.is_duplicate_of,
    k.status AS kill_status,
    k.clip_url_vertical IS NOT NULL AS has_vertical_url,
    k.clip_url_horizontal IS NOT NULL AS has_horizontal_url,
    ge.is_publishable,
    cl.updated_at
FROM clip_ledger cl
JOIN kills k ON k.id = cl.kill_id
JOIN games g ON g.id = cl.game_id
LEFT JOIN game_vod_sources vs ON vs.id = cl.vod_source_id
LEFT JOIN game_events ge ON ge.kill_id = cl.kill_id;

COMMENT ON VIEW v_clip_ledger_full IS
    'Jointure complète ledger + kills + games + sources + gates de '
    'publication. La vue à ouvrir pour auditer un kill de bout en bout.';
