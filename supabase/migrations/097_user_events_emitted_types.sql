-- 097 — Autorise les 12 types d'événements que le site émet sans qu'ils soient enregistrés
--
-- Constat du 16/10/2026 : le lecteur et les écrans du site envoient 12 types
-- que ni /api/track ni la contrainte CHECK n'acceptaient. Ils étaient jetés
-- en silence (aucun clip.dwell en base sur 38 000 événements). Les plus utiles :
--   clip.dwell             temps passé sur un clip (fraction regardée)
--   clip.ttff              délai avant la première image
--   clip.quality_downgrade passage en basse qualité (réseau)
-- La route les accepte depuis le commit du 16/10 ; cette migration les
-- autorise en base. ⚠️ À appliquer à la main dans l'éditeur SQL Supabase.
--
-- Même liste que la 094, plus les 12 nouveaux types en fin de liste.

ALTER TABLE user_events
  DROP CONSTRAINT IF EXISTS user_events_event_type_check;

ALTER TABLE user_events
  ADD CONSTRAINT user_events_event_type_check CHECK (
    event_type IN (
      'feed.view', 'clip.viewed', 'clip.started', 'clip.completed', 'clip.replayed',
      'clip.skipped', 'clip.shared', 'clip.liked', 'clip.rated', 'clip.opened',
      'clip.error', 'clip.delivery',
      'page.viewed', 'player.opened', 'match.opened', 'tournament.opened',
      'search.executed', 'timeline.era_selected',
      'comment.created', 'comment.voted',
      'language.changed', 'quality.changed', 'mute.toggled', 'install.prompted', 'install.accepted',
      'auth.signup', 'auth.login', 'auth.logout', 'auth.riot_linked', 'auth.riot_unlinked', 'riot.link_started',
      'feed.scroll_restored', 'feed.offline_entered', 'feed.offline_exited',
      'perf.vital',
      'feed.recommendation_score',
      -- AJOUTS DE CETTE MIGRATION
      'clip.dwell', 'clip.ttff', 'clip.quality_downgrade', 'clip.hls.error',
      'clip.profile_tap', 'clip.tag_clicked',
      'feed.mode_live_entered', 'feed.mode_live_exited',
      'push.subscribed', 'push.unsubscribed', 'push.preferences_updated', 'push.permission_denied'
    )
  );
