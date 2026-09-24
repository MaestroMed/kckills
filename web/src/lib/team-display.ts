/**
 * Affichage équipe — normalisation des logos et des codes adverses.
 *
 * Deux garde-fous partagés par tous les rendus qui affichent une équipe.
 * Importable côté serveur ET client (fonctions pures, zéro dépendance).
 *
 *   1. `httpsLogoUrl()` — la table `teams` (remplie par le worker depuis
 *      l'API lolesports) stocke encore ~21 `logo_url` en `http://…`.
 *      next/image ne connaît que des remotePatterns `https`
 *      (next.config.ts) et répond 400 sur tout http → logos cassés sur
 *      /match/[slug] et toute page affichant un logo d'équipe. On force
 *      https pour static.lolesports.com (même chemin, servi en TLS) en
 *      UN point plutôt que de patcher chaque <Image>.
 *
 *   2. `cleanTeamCode()` — un code adverse n'est affichable que s'il
 *      ressemble à un vrai tag d'équipe. Un id numérique gol.gg
 *      (ex. "1155") ou le placeholder de ligue "LEC" (ancien fallback en
 *      dur des cartes clips) ne doivent JAMAIS s'afficher comme nom
 *      d'équipe. On rend null et le rendu dégrade proprement (juste
 *      "KC" + stage/date, breadcrumb "Match", etc.).
 */

/** Normalise une URL de logo d'équipe pour next/image (http → https). */
export function httpsLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://static.lolesports.com/")) {
    return "https://" + url.slice("http://".length);
  }
  return url;
}

/**
 * Nettoie un code adverse brut. Retourne null quand le code n'est pas
 * affichable : vide, id numérique gol.gg, ou placeholder "LEC".
 * Les appelants affichent alors la carte sans adversaire.
 */
export function cleanTeamCode(code: string | null | undefined): string | null {
  const c = (code ?? "").trim();
  if (!c) return null;
  if (/^\d+$/.test(c)) return null; // id numérique gol.gg — pas un tag
  if (c.toUpperCase() === "LEC") return null; // placeholder ligue, pas une équipe
  return c;
}

/** Codes des équipes trackées (KC principal + académie KC Blue). */
const OWN_TEAM_CODES = new Set(["KC", "KCB"]);

/**
 * Résout le code adverse depuis les codes blue/red embarqués par
 * KILL_SELECT (2026-08-13). Utilisé quand le match n'est pas dans
 * kc_matches.json (backfill gol.gg : LFL 2021-22, EWC…) : on prend le
 * côté qui n'est pas une équipe trackée, nettoyé par cleanTeamCode.
 */
export function resolveOpponentFromCodes(
  blueCode: string | null | undefined,
  redCode: string | null | undefined,
): string | null {
  for (const c of [blueCode, redCode]) {
    const clean = cleanTeamCode(c);
    if (clean && !OWN_TEAM_CODES.has(clean.toUpperCase())) return clean;
  }
  return null;
}
