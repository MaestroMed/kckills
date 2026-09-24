/**
 * Origine publique du site.
 *
 * `kckills.com` redirige en 308 vers `www.kckills.com` : toute URL absolue
 * publiée (JSON-LD, canonical, og:url, sitemap, liens partagés sur Discord)
 * doit viser `www`, sinon chaque clic ou crawl coûte une redirection et les
 * données structurées pointent vers une URL non canonique.
 */
export const CANONICAL_ORIGIN = "https://www.kckills.com";

/**
 * Origine pour CE build (serveur) : NEXT_PUBLIC_SITE_URL si défini, sinon
 * le domaine canonique en production, l'URL du déploiement en preview,
 * localhost en dev.
 *
 * Audit 2.0 : avant, le fallback VERCEL_URL renvoyait en production l'URL
 * de déploiement (kckills-xxx.vercel.app), qui partait dans le sitemap,
 * robots.txt, les canonical et og:url — le site s'auto-désindexait au profit
 * d'un host jetable. VERCEL_ENV / VERCEL_URL ne sont lisibles que côté
 * serveur : un composant client utilise CANONICAL_ORIGIN.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_ENV === "production"
    ? CANONICAL_ORIGIN
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");
