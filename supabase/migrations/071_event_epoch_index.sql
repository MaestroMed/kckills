-- Migration 071 (Wave 34 T1.3) — Index event_epoch pour countKillsByEra
--
-- Pre-Wave-34 : kills.event_epoch était filtré dans countKillsByEra +
-- getKillsByEra mais seul un composite (game_id, killer_player_id,
-- victim_player_id, event_epoch) existait. Postgres ne pouvait pas
-- utiliser ce composite pour un range scan sur event_epoch.
--
-- Résultat : seq scan sur kills à chaque requête, ~3-8s sur warm cache,
-- risque le statement_timeout 8s anon Supabase.
--
-- Fix : index partial sur event_epoch where status='published' AND
-- kill_visible=true (les 2 conditions des requêtes).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kills_event_epoch_published
ON kills (event_epoch)
WHERE status = 'published' AND kill_visible = true;

COMMENT ON INDEX idx_kills_event_epoch_published IS
  'Wave 34 T1.3 — backs countKillsByEra + getKillsByEra range scans on event_epoch.';
