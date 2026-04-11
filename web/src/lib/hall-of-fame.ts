/**
 * KCKILLS — Hall of Fame
 *
 * Les 10 moments qui ont defini la Karmine Corp, classes par impact historique.
 * Chaque moment est lie a une epoque dans lib/eras.ts pour la navigation
 * croisee entre /hall-of-fame et /era/[id].
 */

export interface HofMoment {
  rank: number;
  title: string;
  subtitle: string;
  eraId: string;
  year: number;
  date: string; // YYYY-MM-DD or MM YYYY
  narrative: string;
  quote?: string;
  quoteAuthor?: string;
  videoId?: string; // YouTube 11-char ID for embed
  stats?: string[];
  color: string; // Accent color (match the era color)
  icon: string; // Single emoji
  tag: "trophy" | "play" | "comeback" | "milestone" | "meme" | "record";
}

export const HALL_OF_FAME: HofMoment[] = [
  {
    rank: 1,
    title: "LE SACRE",
    subtitle: "KC 3-0 G2 \u2014 Champions LEC",
    eraId: "lec-2025-winter",
    year: 2025,
    date: "2025-03-02",
    narrative:
      "Le moment le plus important de l'histoire de la Karmine Corp. Une redemption arc complete : 10e place en Winter 2024, titre LEC en Winter 2025. Apres un 1-3 cruel en upper bracket final vs G2, KC revient du lower bracket apres avoir battu FNC, VIT puis MKOI, et offre la plus belle revanche esport francaise de la decennie avec un 3-0 sec a la Riot Games Arena de Berlin. Premier trophee LEC du club. Premiere equipe francaise championne LEC.",
    quote: "De 10e a champions en un an. C'est pas un sport, c'est un conte.",
    quoteAuthor: "KC Army, 2 mars 2025",
    videoId: "bqBVNEm52A0",
    stats: [
      "801 369 peak viewers (dont 233K sur Kameto co-stream)",
      "Vladi MVP \u2014 Game 3 Viktor 10/1/7",
      "Caliste plus jeune champion LEC (18 ans)",
    ],
    color: "#C8AA6E",
    icon: "\uD83C\uDFC6",
    tag: "trophy",
  },
  {
    rank: 2,
    title: "REKKLES 16/1/25",
    subtitle: "Finale EU Masters Spring 2022 vs LDLC",
    eraId: "lfl-2022-spring",
    year: 2022,
    date: "2022-05-07",
    narrative:
      "Sur 4 games de finale BO5 contre LDLC OL, Rekkles meurt UNE SEULE FOIS. 16 kills, 1 death, 25 assists. Performance individuelle la plus dominante jamais vue en finale EU Masters. KC decroche son 3e titre EUM consecutif \u2014 personne n'a jamais fait mieux, personne n'a jamais reproduit. Rekkles etait deja une legende, ce jour-la il est devenu une categorie a part.",
    quote: "Une seule mort sur 4 games de finale BO5. Un game 2 et un game 3 avec 0 death.",
    quoteAuthor: "EU Masters Spring 2022 stats",
    videoId: "cTs8IKYW5lI",
    stats: [
      "16K / 1D / 25A sur toute la finale",
      "Rapport KDA : 41",
      "3e EU Masters consecutif (record historique)",
    ],
    color: "#FFD700",
    icon: "\uD83D\uDC51",
    tag: "play",
  },
  {
    rank: 3,
    title: "VLADI VIKTOR 10/1/7",
    subtitle: "Game 3 Le Sacre vs Caps",
    eraId: "lec-2025-winter",
    year: 2025,
    date: "2025-03-02",
    narrative:
      "Game 3 de la grande finale LEC Winter 2025. KC mene 2-0. G2 veut tenir bon. Vladi prend Viktor et decide que ce sera son game. 10 kills, 1 mort, 7 assists. Il demonte Caps en ligne, controle les teamfights, finit le game avec 73% de participation aux kills. MVP de la finale. Game 3 finish propre. KC champion. La scene deviendra le poster de 2025.",
    quote: "Le moment ou le rookie de 2024 devient une legende.",
    quoteAuthor: "Caedrel, co-stream LEC Winter 2025",
    videoId: "pMSFp7wku5Y",
    stats: [
      "10 kills / 1 death / 7 assists",
      "KP 73%",
      "MVP Grand Final LEC Winter 2025",
    ],
    color: "#C8AA6E",
    icon: "\u2B50",
    tag: "play",
  },
  {
    rank: 4,
    title: "CALISTE ROYAL ROADER",
    subtitle: "Plus jeune champion LEC de l'histoire",
    eraId: "lec-2025-winter",
    year: 2025,
    date: "2025-03-02",
    narrative:
      "En 2024, Caliste a 17 ans. Trop jeune pour la LEC (regle age minimum 18). Il fait 16 matches en LFL avec KCB pour attendre. En janvier 2025, il fete ses 18 ans, rejoint le roster principal. Mars 2025, 2 mois plus tard : Champion LEC. Il devient le plus jeune joueur de l'histoire de la LEC a remporter un titre. Un Royal Roader, comme on dit en Coree : champion des son premier split. Puis en 2025 Rookie of the Year avec 28 voix sur 38.",
    quote: "J'ai attendu 12 mois pour etre eligible, je voulais pas attendre plus pour gagner.",
    quoteAuthor: "Caliste, apres la finale",
    videoId: "a953ZreZp8A",
    stats: [
      "18 ans, 2 mois \u2014 plus jeune champion LEC",
      "Royal Roader (titre en rookie split)",
      "Rookie of the Year 2025 (28/38 voix)",
    ],
    color: "#C8AA6E",
    icon: "\uD83D\uDC76",
    tag: "record",
  },
  {
    rank: 5,
    title: "COMEBACK 0-2 vs CFO",
    subtitle: "First Stand Seoul \u2014 demi-finale",
    eraId: "international-2025-firststand",
    year: 2025,
    date: "2025-03-14",
    narrative:
      "Premier tournoi international de KC. Seoul. Demi-finale vs CTBC Flying Oyster (PCS). KC perd le premier game. Puis le second. 0-2 dans un BO5. Eliminees en vue. Puis Vladi se reveille. Caliste sort un Xayah de legende. KC gagne game 3. Game 4. Game 5. Le comeback international le plus legendaire d'une equipe francaise depuis H2K Worlds. Premier BO5 gagne 0-2 a 3-2 de l'histoire du club.",
    quote: "En Coree, contre une equipe coreenne, on a fait un comeback 0-2. En Coree.",
    quoteAuthor: "Kameto, stream debrief",
    videoId: "8AJP6HleZh8",
    stats: [
      "0-2 -> 3-2 en BO5",
      "Meilleur resultat international d'une equipe FR depuis H2K",
      "Prize : $225 000",
    ],
    color: "#0AC8B9",
    icon: "\uD83D\uDD04",
    tag: "comeback",
  },
  {
    rank: 6,
    title: "REKKLES PENTAKILL JINX",
    subtitle: "Premier penta KC vs GameWard",
    eraId: "lfl-2022-spring",
    year: 2022,
    date: "2022-02-15",
    narrative:
      "Le premier pentakill de l'histoire de la Karmine Corp, pose par Rekkles sur Jinx pendant un match LFL Spring 2022 vs GameWard. Debut d'un teamfight en mid game, Rekkles commence avec Super Mega Death Rocket pour initier. Puis il flash, auto-reset le passif, chaine les kills. Penta. Le casting francais explose. Twitter explose. Les streams de reaction explosent. C'est le moment ou le monde comprend que Rekkles a vraiment rejoint la LFL et qu'il allait y briller.",
    quote: "REKKLES ! PENTAKILL ! LA KARMINE CORP ! IL Y EST !",
    quoteAuthor: "Casters OTPLOL, LFL Spring 2022",
    videoId: "j9JlExfa9mY",
    stats: [
      "Premier pentakill KC \u2014 all time",
      "Jinx Flash-reset combo",
      "Viral Twitter 24h (500K+ vues)",
    ],
    color: "#FFD700",
    icon: "\u2694\uFE0F",
    tag: "play",
  },
  {
    rank: 7,
    title: "KCX3 LA DEFENSE ARENA",
    subtitle: "28 000 fans \u2014 record europeen esport",
    eraId: "lfl-2023-summer",
    year: 2023,
    date: "2023-09-16",
    narrative:
      "KCX3 \u00ab KCorp vs The World \u00bb le 16 septembre 2023 a Paris La Defense Arena. 28 000 fans dans la salle. Plus gros evenement esport d'Europe a date. G2 Rocket League, LOUD Valorant, ENCE CS:GO, des shows musicaux, des reveals de merch. 5h30 de spectacle. Kameto declare : \u00ab On veut montrer qu'on est un des plus grands clubs du monde. \u00bb Un mois plus tard, KC rachete le slot LEC d'Astralis. L'evenement devient le prelude de l'entree en LEC.",
    quote: "On veut montrer qu'on est un des plus grands clubs du monde.",
    quoteAuthor: "Kameto, KCX3 La Defense Arena",
    stats: [
      "28 000 fans en salle",
      "Plus gros event esport d'Europe 2023",
      "Prelude au rachat du slot LEC",
    ],
    color: "#2196F3",
    icon: "\uD83C\uDFDF\uFE0F",
    tag: "milestone",
  },
  {
    rank: 8,
    title: "RACHAT DU SLOT LEC",
    subtitle: "KC achete Astralis \u2014 15M\u20ac",
    eraId: "lfl-2023-summer",
    year: 2023,
    date: "2023-10-18",
    narrative:
      "Le 18 octobre 2023, la Karmine Corp rachete 66.67% du slot LEC d'Astralis Group pour 129 millions de couronnes danoises (~15M\u20ac). KC devient la premiere equipe francaise a entrer en LEC via un rachat de slot. Kameto : \u00ab On vise le Championnat du Monde dans 5 a 10 ans. \u00bb Deux ans plus tard, ils sont champions LEC et en First Stand. L'un des paris les plus fous de l'histoire de l'esport europeen a ete remporte en 16 mois.",
    quote: "On vise le Championnat du Monde dans 5 a 10 ans.",
    quoteAuthor: "Kameto, annonce du rachat",
    stats: [
      "129M DKK / ~15M\u20ac",
      "66.67% du slot LEC d'Astralis",
      "18 octobre 2023",
    ],
    color: "#2196F3",
    icon: "\uD83D\uDCB8",
    tag: "milestone",
  },
  {
    rank: 9,
    title: "LE TWEET DE MACRON",
    subtitle: "Le president congratule KC \u2014 EU Masters Spring 2021",
    eraId: "lfl-2021-spring",
    year: 2021,
    date: "2021-05-03",
    narrative:
      "Apres la victoire de KC en finale EU Masters Spring 2021 (3-1 vs BT Excel), Emmanuel Macron, President de la Republique francaise, tweete ses felicitations au club. Premier esport a avoir ete congratule officiellement par un chef d'Etat francais. Le tweet est partage des centaines de milliers de fois. Les membres du club se prennent en photo avec leurs familles en hurlant. C'est le moment ou l'esport francais entre officiellement dans la culture mainstream.",
    quote: "Felicitations a la @KarmineCorp pour cette victoire historique ! Une belle reussite francaise.",
    quoteAuthor: "@EmmanuelMacron, 3 mai 2021",
    stats: [
      "Premier tweet de chef d'Etat sur un esport FR",
      "~500K retweets / likes",
      "PSG, Macron, LeMagIT \u2014 la France entiere s'y met",
    ],
    color: "#00C853",
    icon: "\uD83C\uDDEB\uD83C\uDDF7",
    tag: "milestone",
  },
  {
    rank: 10,
    title: "LE BACK-TO-BACK 2021",
    subtitle: "2 EU Masters consecutifs \u2014 record historique",
    eraId: "lfl-2021-summer",
    year: 2021,
    date: "2021-09-19",
    narrative:
      "Deux EU Masters consecutifs en une annee. Spring 2021 (3-1 BT Excel) puis Summer 2021 (3-2 Fnatic Rising). La finale Summer etait un match de folie : KC mene 2-0, FNC Rising revient a 2-2, puis KC stomp le Game 5 en 21 minutes grace a un Cinkrof Jarvan IV qui dicte le tempo. KC devient la premiere equipe de l'histoire a remporter deux EU Masters dans la meme annee. Ce titre a ouvert la voie a Rekkles et a la LEC deux ans plus tard.",
    quote: "Premiere equipe de l'histoire a realiser le back-to-back EU Masters.",
    quoteAuthor: "Dotesports, 20 septembre 2021",
    videoId: "tQCYNY2nbPY",
    stats: [
      "2 EU Masters en 2021 (record)",
      "Finale Summer KC 3-2 FNC Rising",
      "Game 5 stomp en 21 minutes (Cinkrof Jarvan IV)",
    ],
    color: "#FFD700",
    icon: "\uD83C\uDFC5",
    tag: "record",
  },
];

export function getMomentByRank(rank: number): HofMoment | undefined {
  return HALL_OF_FAME.find((m) => m.rank === rank);
}

export function getMomentsByTag(tag: HofMoment["tag"]): HofMoment[] {
  return HALL_OF_FAME.filter((m) => m.tag === tag);
}
