-- 094 — Autorise l'événement feed.recommendation_score
--
-- L'API /api/track accepte ce type depuis la vague 11 (moteur de
-- recommandation), mais la contrainte CHECK de user_events ne l'a jamais
-- listé. Résultat : Postgres rejette l'insertion, la route journalise
-- l'erreur côté serveur et répond quand même 204 — le client croit que
-- l'événement est enregistré alors qu'il est perdu. C'est le seul type
-- de la liste de l'API encore dans ce cas (les 35 autres ont été
-- régularisés par les migrations 038 / 041 / 047).
--
-- Vérifié le 2026-07-26 en tentant une insertion réelle pour chacun des
-- 36 types acceptés par l'API : seul feed.recommendation_score échoue.

ALTER TABLE user_events
  DROP CONSTRAINT IF EXISTS user_events_event_type_check;

ALTER TABLE user_events
  ADD CONSTRAINT user_events_event_type_check CHECK (
    event_type IN (
      -- Feed & lecture
      'feed.view',
      'clip.viewed',
      'clip.started',
      'clip.completed',
      'clip.replayed',
      'clip.skipped',
      'clip.shared',
      'clip.liked',
      'clip.rated',
      'clip.opened',
      'clip.error',
      'clip.delivery',
      -- Navigation
      'page.viewed',
      'player.opened',
      'match.opened',
      'tournament.opened',
      'search.executed',
      'timeline.era_selected',
      -- Communauté
      'comment.created',
      'comment.voted',
      -- Préférences
      'language.changed',
      'quality.changed',
      'mute.toggled',
      'install.prompted',
      'install.accepted',
      -- Authentification
      'auth.signup',
      'auth.login',
      'auth.logout',
      'auth.riot_linked',
      'auth.riot_unlinked',
      'riot.link_started',
      -- Feed (états)
      'feed.scroll_restored',
      'feed.offline_entered',
      'feed.offline_exited',
      -- Mesure de performance réelle
      'perf.vital',
      -- Moteur de recommandation — AJOUT DE CETTE MIGRATION
      'feed.recommendation_score'
    )
  );
