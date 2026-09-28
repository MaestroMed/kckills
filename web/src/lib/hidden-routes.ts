/**
 * Pages en chantier, cachées du site (29/09/2026, Mehdi : « cache les pages
 * qu'on n'a pas finies, elles ne doivent pas être visibles sur le site ou
 * dans le menu du header »).
 *
 *   /chambre    refonte de la Chambre des Souffrances en cours
 *   /vs         refonte de la roulette (écran de sélection façon jeu de VS)
 *   /bracket    aucun tournoi en cours, page vide
 *   /community  galerie vide (aucun clip approuvé)
 *
 * Effets : plus aucun lien (menu, palette de commandes, rail du scroll,
 * sitemap) et 404 pour le public (src/proxy.ts). En dev et pour l'admin
 * (cookie kc_admin), les pages restent ouvertes pour continuer le travail.
 *
 * Remettre une page en ligne : la retirer d'ici ET du matcher de
 * src/proxy.ts (Next exige un matcher littéral).
 */
export const HIDDEN_ROUTES = ["/chambre", "/vs", "/bracket", "/community"] as const;

/** Vrai pour la page elle-même et ses sous-pages (/vs/leaderboard…), query et ancre ignorées. */
export function isHiddenRoute(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  return HIDDEN_ROUTES.some((r) => path === r || path.startsWith(`${r}/`));
}
