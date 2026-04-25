/**
 * French translation dictionary — canonical reference for all other locales.
 *
 * Hierarchical key structure : every other locale MUST mirror these exact
 * keys. The `useT()` hook walks dotted paths like "feed.mode_live".
 *
 * Conventions :
 *   - lower_snake_case keys
 *   - Group by feature area (nav / feed / kill / comments / ...)
 *   - "common.*" for buttons / labels reused everywhere
 *   - Sentence-case values, no trailing period unless multi-sentence
 *   - Use {placeholder} markers for runtime substitution
 *     (the `useT()` hook supports a 2nd `vars` arg)
 *
 * THIS IS THE CANONICAL FILE — when you add a new key, add it here FIRST,
 * then mirror it in en.ts and ko.ts (and es.ts).
 */

/**
 * The dict type widens every leaf to `string` (not the literal value).
 * Other locales only need to mirror the SHAPE — they're free to provide
 * any string value at each key.
 *
 * The `Widen` type recursively replaces literal-string types with the
 * generic `string` type. This is what `FrDict` exports for consumers.
 */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

const _fr = {
  common: {
    rate: "Noter",
    share: "Partager",
    back: "Retour",
    close: "Fermer",
    cancel: "Annuler",
    confirm: "Confirmer",
    save: "Enregistrer",
    delete: "Supprimer",
    edit: "Modifier",
    loading: "Chargement…",
    empty: "Aucun résultat",
    retry: "Réessayer",
    more: "Plus",
    less: "Moins",
    yes: "Oui",
    no: "Non",
    next: "Suivant",
    previous: "Précédent",
    copy: "Copier",
    copied: "Copié",
    open: "Ouvrir",
    minutes_ago: "il y a {n} min",
    hours_ago: "il y a {n} h",
    days_ago: "il y a {n} j",
    just_now: "à l'instant",
  },

  nav: {
    home: "Accueil",
    scroll: "Scroll",
    top: "Top",
    community: "Communauté",
    search: "Recherche",
    matches: "Matchs",
    players: "Joueurs",
    settings: "Paramètres",
    sign_in: "Se connecter",
    sign_out: "Se déconnecter",
    profile: "Profil",
    admin: "Admin",
    about: "À propos",
  },

  feed: {
    mode_live: "KC EN LIVE",
    mode_normal: "Feed",
    no_clips: "Aucun clip à afficher",
    offline: "Mode hors ligne",
    loading_more: "Chargement de nouveaux clips…",
    end_reached: "Tu as tout vu — reviens plus tard !",
    swipe_hint: "Swipe vers le haut",
    autoplay_paused: "Lecture en pause",
    network_slow: "Connexion lente — qualité réduite",
  },

  kill: {
    score: "Score",
    tags: "Tags",
    killer: "Tueur",
    victim: "Victime",
    assist: "Assist",
    assists: "Assists",
    match: "Match",
    duration: "Durée",
    game: "Game",
    patch: "Patch",
    first_blood: "First Blood",
    multi_kill_double: "Double Kill",
    multi_kill_triple: "Triple Kill",
    multi_kill_quadra: "Quadra Kill",
    multi_kill_penta: "Penta Kill",
    watch_full_game: "Voir la game complète",
    watch_on_youtube: "Voir sur YouTube",
    watch_on_twitch: "Voir sur Twitch",
    no_clip: "Clip non disponible",
    description_unavailable: "Description non disponible",
  },

  rating: {
    rate_this_kill: "Note ce kill",
    your_rating: "Ta note",
    average: "Moyenne",
    n_ratings: "{n} notes",
    one_rating: "1 note",
    no_ratings: "Aucune note",
    sign_in_to_rate: "Connecte-toi pour noter",
    rated: "Noté !",
    rating_updated: "Note mise à jour",
  },

  comments: {
    title: "Commentaires",
    placeholder: "Ajoute un commentaire…",
    sign_in: "Connecte-toi pour commenter",
    submit: "Publier",
    submitting: "Publication…",
    submitted: "Commentaire publié",
    pending_moderation: "En attente de modération",
    rejected: "Commentaire rejeté",
    flagged: "Commentaire signalé",
    report: "Signaler",
    voted: "Voté",
    upvote: "Upvote",
    reply: "Répondre",
    delete_own: "Supprimer mon commentaire",
    no_comments: "Aucun commentaire — sois le premier !",
    n_comments: "{n} commentaires",
    one_comment: "1 commentaire",
    too_long: "Trop long (max 500 caractères)",
    too_short: "Trop court",
  },

  reports: {
    title: "Signaler",
    subtitle: "Pourquoi signales-tu ce contenu ?",
    reason_spam: "Spam",
    reason_toxic: "Toxique / harcèlement",
    reason_offtopic: "Hors-sujet",
    reason_misinfo: "Désinformation",
    reason_illegal: "Contenu illégal",
    reason_other: "Autre",
    submit: "Envoyer le signalement",
    submitted: "Signalement envoyé. Merci !",
    already_reported: "Déjà signalé",
  },

  errors: {
    network: "Erreur réseau",
    server: "Erreur serveur",
    not_found: "Introuvable",
    forbidden: "Accès interdit",
    rate_limited: "Trop de requêtes — patiente un peu",
    unknown: "Une erreur est survenue",
    try_again: "Réessayer",
    contact_support: "Contacter le support",
    offline_message: "Tu es hors ligne. Vérifie ta connexion.",
    video_failed: "Le clip n'a pas pu se charger",
  },

  settings: {
    title: "Paramètres",
    profile: "Profil",
    account: "Compte",
    notifications: "Notifications",
    language: "Langue",
    language_current: "Langue actuelle",
    riot_link: "Lier mon compte Riot",
    riot_unlink: "Délier mon compte Riot",
    riot_linked: "Lié à {name}",
    push_enable: "Activer les notifications",
    push_disable: "Désactiver les notifications",
    export_data: "Exporter mes données",
    delete_account: "Supprimer mon compte",
    delete_account_confirm: "Cette action est irréversible. Continuer ?",
    deleted: "Compte supprimé",
    privacy: "Confidentialité",
    legal: "Mentions légales",
  },

  auth: {
    sign_in_discord: "Se connecter avec Discord",
    sign_in_required: "Connexion requise",
    sign_in_to_continue: "Connecte-toi pour continuer",
    signed_in_as: "Connecté en tant que {name}",
    signing_in: "Connexion…",
    signing_out: "Déconnexion…",
    sign_out_confirm: "Te déconnecter ?",
  },

  search: {
    title: "Recherche",
    placeholder: "Champion, joueur, tag…",
    no_results: "Aucun résultat pour « {query} »",
    n_results: "{n} résultats",
    one_result: "1 résultat",
    filters: "Filtres",
    clear_filters: "Effacer les filtres",
    filter_by_player: "Joueur",
    filter_by_team: "Équipe",
    filter_by_era: "Ère KC",
    filter_by_tag: "Tag",
    filter_by_champion: "Champion",
    filter_multikill: "Multi-kill",
    filter_first_blood: "First blood",
    sort_recent: "Plus récent",
    sort_top: "Mieux notés",
    sort_hype: "Plus hypés",
  },

  player: {
    role_top: "Top",
    role_jungle: "Jungle",
    role_mid: "Mid",
    role_bottom: "ADC",
    role_support: "Support",
    coach: "Coach",
    kda: "KDA",
    games: "Games",
    win_rate: "Winrate",
    avg_rating: "Note moyenne",
    top_kills: "Meilleurs kills",
    recent_kills: "Kills récents",
    no_kills: "Aucun kill enregistré",
  },

  timeline: {
    title: "Timeline KC",
    select_era: "Sélectionne une ère",
    all_eras: "Toutes les ères",
    roster: "Roster",
    achievements: "Palmarès",
    events: "Événements",
  },

  community: {
    title: "Communauté",
    submit_clip: "Soumettre un clip",
    your_submissions: "Mes soumissions",
    pending_review: "En attente de validation",
    approved: "Approuvé",
    rejected: "Rejeté",
    submit_youtube: "Lien YouTube",
    submit_tiktok: "Lien TikTok",
    submit_twitter: "Lien Twitter / X",
    submit_title_placeholder: "Titre du clip (optionnel)",
    submit_success: "Merci ! Ton clip est en attente de modération.",
  },

  pwa: {
    install_title: "Installer LoLTok",
    install_description: "Ajoute LoLTok à ton écran d'accueil pour un accès rapide.",
    install_button: "Installer",
    install_dismiss: "Plus tard",
    update_available: "Mise à jour disponible",
    update_button: "Recharger",
  },

  share: {
    copy_link: "Copier le lien",
    link_copied: "Lien copié !",
    share_twitter: "Partager sur X",
    share_discord: "Partager sur Discord",
    share_native: "Partager…",
  },

  legal: {
    riot_disclaimer: "LoLTok was created under Riot Games' \"Legal Jibber Jabber\" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.",
    privacy_link: "Politique de confidentialité",
    terms_link: "Conditions d'utilisation",
    cookies_notice: "Ce site n'utilise aucun cookie tiers.",
  },
} as const;

/** Widened dict type — other locales mirror the shape but use `string` leaves. */
export type FrDict = Widen<typeof _fr>;

/** Canonical FR dictionary, exported as the widened type. */
export const fr: FrDict = _fr;
