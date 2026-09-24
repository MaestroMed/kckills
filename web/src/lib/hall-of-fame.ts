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
      "Le moment le plus important de l'histoire de la Karmine Corp. Une redemption arc complète : 10e place en Winter 2024, titre LEC en Winter 2025. Après un 1-3 cruel en upper bracket final vs G2, KC revient du lower bracket après avoir battu FNC, VIT puis MKOI, et offre la plus belle revanche esport française de la décennie avec un 3-0 sec à la Riot Games Arena de Berlin. Premier trophée LEC du club. Première équipe française championne LEC.",
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
      "Sur 4 games de finale BO5 contre LDLC OL, Rekkles meurt UNE SEULE FOIS. 16 kills, 1 death, 25 assists. Performance individuelle la plus dominante jamais vue en finale EU Masters. KC décroche son 3e titre EUM consécutif \u2014 personne n'a jamais fait mieux, personne n'a jamais reproduit. Rekkles était déjà une légende, ce jour-là il est devenu une catégorie à part.",
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
    quote: "Le moment où le rookie de 2024 devient une légende.",
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
      "En 2024, Caliste a 17 ans. Trop jeune pour la LEC (règle âge minimum 18). Il fait 16 matches en LFL avec KCB pour attendre. En janvier 2025, il fête ses 18 ans, rejoint le roster principal. Mars 2025, 2 mois plus tard : Champion LEC. Il devient le plus jeune joueur de l'histoire de la LEC à remporter un titre. Un Royal Roader, comme on dit en Coree : champion dès son premier split. Puis en 2025 Rookie of the Year avec 28 voix sur 38.",
    quote: "J'ai attendu 12 mois pour etre eligible, je voulais pas attendre plus pour gagner.",
    quoteAuthor: "Caliste, après la finale",
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
      "Premier tournoi international de KC. Seoul. Demi-finale vs CTBC Flying Oyster (PCS). KC perd le premier game. Puis le second. 0-2 dans un BO5. Éliminées en vue. Puis Vladi se réveille. Caliste sort un Xayah de légende. KC gagne game 3. Game 4. Game 5. Le comeback international le plus légendaire d'une équipe française depuis H2K Worlds. Premier BO5 gagné 0-2 à 3-2 de l'histoire du club.",
    quote: "En Coree, contre une équipe coréenne, on a fait un comeback 0-2. En Coree.",
    quoteAuthor: "Kameto, stream debrief",
    videoId: "8AJP6HleZh8",
    stats: [
      "0-2 -> 3-2 en BO5",
      "Meilleur résultat international d'une équipe FR depuis H2K",
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
      "Le premier pentakill de l'histoire de la Karmine Corp, posé par Rekkles sur Jinx pendant un match LFL Spring 2022 vs GameWard. Début d'un teamfight en mid game, Rekkles commence avec Super Mega Death Rocket pour initier. Puis il flash, auto-reset le passif, chaîne les kills. Penta. Le casting français explose. Twitter explose. Les streams de réaction explosent. C'est le moment où le monde comprend que Rekkles a vraiment rejoint la LFL et qu'il allait y briller.",
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
      "KCX3 \u00ab KCorp vs The World \u00bb le 16 septembre 2023 à Paris La Defense Arena. 28 000 fans dans la salle. Plus gros événement esport d'Europe à date. G2 Rocket League, LOUD Valorant, ENCE CS:GO, des shows musicaux, des reveals de merch. 5h30 de spectacle. Kameto déclare : \u00ab On veut montrer qu'on est un des plus grands clubs du monde. \u00bb Un mois plus tard, KC rachète le slot LEC d'Astralis. L'événement devient le prélude de l'entrée en LEC.",
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
      "Le 18 octobre 2023, la Karmine Corp rachète 66.67% du slot LEC d'Astralis Group pour 129 millions de couronnes danoises (~15M\u20ac). KC devient la première équipe française à entrer en LEC via un rachat de slot. Kameto : \u00ab On vise le Championnat du Monde dans 5 à 10 ans. \u00bb Deux ans plus tard, ils sont champions LEC et en First Stand. L'un des paris les plus fous de l'histoire de l'esport européen a été remporté en 16 mois.",
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
      "Après la victoire de KC en finale EU Masters Spring 2021 (3-1 vs BT Excel), Emmanuel Macron, Président de la République française, tweete ses félicitations au club. Premier esport à avoir été congratulé officiellement par un chef d'État français. Le tweet est partagé des centaines de milliers de fois. Les membres du club se prennent en photo avec leurs familles en hurlant. C'est le moment où l'esport français entre officiellement dans la culture mainstream.",
    quote: "Félicitations à la @KarmineCorp pour cette victoire historique ! Une belle réussite française.",
    quoteAuthor: "@EmmanuelMacron, 3 mai 2021",
    stats: [
      "Premier tweet de chef d'État sur un esport FR",
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
      "Deux EU Masters consécutifs en une année. Spring 2021 (3-1 BT Excel) puis Summer 2021 (3-2 Fnatic Rising). La finale Summer était un match de folie : KC mène 2-0, FNC Rising revient à 2-2, puis KC stomp le Game 5 en 21 minutes grâce à un Cinkrof Jarvan IV qui dicte le tempo. KC devient la première équipe de l'histoire à remporter deux EU Masters dans la même année. Ce titre a ouvert la voie à Rekkles et à la LEC deux ans plus tard.",
    quote: "Première équipe de l'histoire à réaliser le back-to-back EU Masters.",
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
