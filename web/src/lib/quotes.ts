/**
 * Sourced quotes from KC players, staff, casters and community figures.
 *
 * Each quote must have a verified source (stream, interview, press
 * conference, tweet) with a sourceUrl. Used on era pages, player pages, and
 * as random homepage highlights.
 */

export interface Quote {
  id: string;
  text: string;
  author: string;
  role: string;
  source: string;
  sourceUrl?: string;
  date?: string;
  eraId?: string;
  playerSlug?: string;
}

/**
 * Vide depuis le 24/09/2026 : les 14 citations d'origine (Kameto, Caliste,
 * Canna, Rekkles…) n'avaient aucune source vérifiable et aucune n'a été
 * retrouvée mot pour mot. On n'attribue pas de propos inventés à de vraies
 * personnes : n'ajouter ici qu'une citation avec `sourceUrl` (vidéo, article,
 * tweet) qui la contient telle quelle.
 */
export const QUOTES: Quote[] = [];

export function getQuotesByEra(eraId: string): Quote[] {
  return QUOTES.filter((q) => q.eraId === eraId);
}

export function getQuotesByPlayer(playerSlug: string): Quote[] {
  return QUOTES.filter((q) => q.playerSlug === playerSlug);
}

export function getRandomQuote(): Quote | undefined {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}
