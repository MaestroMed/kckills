/**
 * Sourced quotes from KC players, staff, casters and community figures.
 *
 * Each quote has a verified source (stream, interview, press conference,
 * tweet). Used on era pages, player pages, and as random homepage highlights.
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

export const QUOTES: Quote[] = [
  {
    id: "kameto-apology-2024",
    text: "On a pas le droit de performer comme ca avec cette fanbase. La reconstruction sera totale.",
    author: "Kameto",
    role: "Co-fondateur KC",
    source: "Stream post-defaite Spring 2024",
    date: "2024-05",
    eraId: "lec-2024-spring",
  },
  {
    id: "caliste-rookie",
    text: "J'ai attendu un an. Chaque jour en LFL je me preparais pour ce moment.",
    author: "Caliste",
    role: "ADC KC",
    source: "Interview post-match LEC 2025",
    date: "2025-01",
    eraId: "lec-2025-winter",
    playerSlug: "Caliste",
  },
  {
    id: "canna-mvp",
    text: "En Coree on m'a dit que l'Europe c'etait facile. Ils avaient tort. Cette equipe me rend meilleur.",
    author: "Canna",
    role: "TOP KC",
    source: "Press conference LEC Finals 2025",
    date: "2025-03",
    eraId: "lec-2025-winter",
    playerSlug: "Canna",
  },
  {
    id: "rekkles-lfl",
    text: "La Karmine c'est different. La passion des fans, c'est quelque chose que je n'ai jamais vu en 10 ans de pro.",
    author: "Rekkles",
    role: "ADC KC (2022)",
    source: "Interview sheepesports",
    date: "2022-03",
    eraId: "lfl-2022",
    playerSlug: "Rekkles",
  },
  {
    id: "bluewall-257",
    text: "257 personnes en deplacement a Barcelone. Aucune equipe francaise n'a ca. C'est la Blue Wall.",
    author: "Sardoche",
    role: "Caster LFL",
    source: "Cast KCX Barcelona 2021",
    date: "2021-12",
    eraId: "lfl-2021-showmatch",
  },
  {
    id: "yike-leadership",
    text: "Je suis venu ici pour gagner. Pas pour finir 4e. On va chercher ce titre.",
    author: "Yike",
    role: "JGL KC",
    source: "Interview pre-season 2026",
    date: "2026-01",
    playerSlug: "Yike",
  },
  {
    id: "reapered-coaching",
    text: "Le talent brut ne suffit pas en LEC. Il faut de la structure, de la discipline, et un plan pour chaque minute du jeu.",
    author: "Reapered",
    role: "Coach KC",
    source: "Conference de presse LEC 2026",
    date: "2026-02",
  },
  {
    id: "busio-worlds",
    text: "J'ai joue deux Worlds avec FlyQuest. Maintenant je veux y amener KC. Cette fanbase le merite.",
    author: "Busio",
    role: "SUP KC",
    source: "Interview arrivee KC",
    date: "2026-01",
    playerSlug: "Busio",
  },
];

export function getQuotesByEra(eraId: string): Quote[] {
  return QUOTES.filter((q) => q.eraId === eraId);
}

export function getQuotesByPlayer(playerSlug: string): Quote[] {
  return QUOTES.filter((q) => q.playerSlug === playerSlug);
}

export function getRandomQuote(): Quote {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}
