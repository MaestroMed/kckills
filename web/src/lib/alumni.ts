/**
 * Alumni — legendary ex-KC players whose narrative is preserved here even
 * when their match data isn't in kc_matches.json (because the data file only
 * covers 2024-2026).
 *
 * These are curated bios, not raw stats. Facts are cross-referenced from
 * Liquipedia, Leaguepedia, dotesports, sheepesports, esports-news.co.uk and
 * the matching era narratives in lib/eras.ts.
 */

export interface AlumniLink {
  label: string;
  url: string;
  type: "article" | "youtube" | "wiki";
}

export interface AlumniStat {
  label: string;
  value: string;
  hint?: string;
}

export interface Alumni {
  /** URL slug — stable, lowercased, no spaces */
  slug: string;
  /** Display name used in the roster (e.g. "Rekkles") */
  name: string;
  /** Real name if known */
  realName?: string;
  /** Nationality emoji or country code letters (used as a plain string) */
  nationality: string;
  /** Role: top, jungle, mid, bottom/adc, support */
  role: "top" | "jungle" | "mid" | "adc" | "support";
  /** Years with KC (e.g. "2022" or "2024") */
  period: string;
  /** One-line subtitle shown under the name */
  subtitle: string;
  /** Small tagline — 3-6 words, ALL CAPS */
  tag: string;
  /** Signature champion (used for splash art background) */
  signatureChampion: string;
  /** Main era IDs this alumni belongs to — for cross-links */
  eras: string[];
  /** Multi-paragraph bio, rendered as Markdown-lite (line breaks preserved) */
  bio: string;
  /** Stats cards — 4 max */
  stats: AlumniStat[];
  /** External links for deeper reading */
  links: AlumniLink[];
  /** Role-based color accent in hex */
  accentColor: string;
}

// ─── Alumni roster ────────────────────────────────────────────────────────

export const ALUMNI: Alumni[] = [
  {
    slug: "rekkles",
    name: "Rekkles",
    realName: "Martin Larsson",
    nationality: "SE",
    role: "adc",
    period: "2022",
    subtitle: "L'ADC legendaire qui a porte le triple EU Masters",
    tag: "LE TRIPLE EUM",
    signatureChampion: "Jinx",
    eras: ["lfl-2022-spring"],
    accentColor: "#FFD700",
    bio: [
      "Martin \u00ab Rekkles \u00bb Larsson, l\u00e9gende de Fnatic et l'un des plus grands ADC de l'histoire europ\u00e9enne, rejoint la Karmine Corp en janvier 2022 \u2014 le plus gros transfert ERL jamais enregistr\u00e9.",
      "Le split LFL est d\u00e9cevant : KC termine 3e et sort en lower bracket face \u00e0 BDS Academy. La saison semble compromise. Mais aux EU Masters, la machine s'allume enfin.",
      "En demi-finale contre Vitality.Bee, KC remonte un reverse sweep 0-2 \u00e0 3-2 dans une s\u00e9rie sous tension permanente. Puis, en grande finale contre LDLC OL, Rekkles d\u00e9livre l'une des performances les plus propres de l'histoire des EU Masters : <strong>16 kills, 1 mort, 25 assists</strong> sur 4 games. Une seule mort en quatre matchs.",
      "Karmine Corp devient la premi\u00e8re \u00e9quipe \u00e0 remporter trois EU Masters cons\u00e9cutifs. Rekkles restera un seul split \u2014 un souvenir court mais \u00e9crit en lettres dor\u00e9es dans l'histoire KC.",
    ].join("\n\n"),
    stats: [
      { label: "Trophees", value: "1", hint: "EU Masters Spring 2022" },
      { label: "KDA Final EUM", value: "16/1/25", hint: "4 games, 1 mort" },
      { label: "Pentakill KC", value: "1er", hint: "Jinx vs GameWard" },
      { label: "Split avec KC", value: "1", hint: "Spring 2022" },
    ],
    links: [
      {
        label: "Rekkles pentakill Jinx vs GameWard",
        url: "https://www.youtube.com/watch?v=j9JlExfa9mY",
        type: "youtube",
      },
      {
        label: "Rekkles pentakill \u2014 EpicSkillshot",
        url: "https://www.youtube.com/watch?v=XlBBtLR2ZIY",
        type: "youtube",
      },
      {
        label: "Liquipedia \u2014 Rekkles",
        url: "https://liquipedia.net/leagueoflegends/Rekkles",
        type: "wiki",
      },
    ],
  },

  {
    slug: "xmatty",
    name: "xMatty",
    realName: "Matthew Coombs",
    nationality: "UK",
    role: "adc",
    period: "2021",
    subtitle: "Premier UK champion EU Masters \u2014 l'ADC de la Genese",
    tag: "THE GENESIS ADC",
    signatureChampion: "Aphelios",
    eras: ["lfl-2021-spring", "lfl-2021-summer"],
    accentColor: "#00C853",
    bio: [
      "Matthew \u00ab xMatty \u00bb Coombs est l'un des cinq membres originaux de la Karmine Corp. Le 2 mai 2021, il devient le premier joueur anglais de l'histoire \u00e0 remporter les EU Masters, dans la finale Spring 2021 que KC gagne 3-1 face \u00e0 BT Excel.",
      "La finale attire 377 000 viewers au pic \u2014 un record de l'\u00e9poque pour un tournoi ERL, devanc\u00e9 seulement par la LEC elle-m\u00eame. Dans un \u00e9cosyst\u00e8me domin\u00e9 historiquement par les Cor\u00e9ens, les Fran\u00e7ais et les Allemands, xMatty force l'Angleterre \u00e0 prendre sa place sur la carte.",
      "Avec le roster originel \u2014 Adam, Cinkrof, Saken, xMatty, Targamas \u2014 KC emporte deux LFL cons\u00e9cutives et deux EU Masters dans la m\u00eame ann\u00e9e 2021. La l\u00e9gende commence l\u00e0, avec lui.",
    ].join("\n\n"),
    stats: [
      { label: "Trophees", value: "4", hint: "2 LFL + 2 EU Masters 2021" },
      { label: "First UK EUM", value: "2 mai 2021", hint: "BT Excel 3-1" },
      { label: "Peak viewers", value: "377K", hint: "Finale EUM Spring 2021" },
      { label: "Splits KC", value: "2", hint: "Spring + Summer 2021" },
    ],
    links: [
      {
        label: "xMatty premier UK champion (esports-news.co.uk)",
        url: "https://esports-news.co.uk/2021/05/02/xmatty-first-uk-player-win-eu-masters-karmine-corp-bt-excel/",
        type: "article",
      },
      {
        label: "Finale EUM Spring 2021 KC 3-1 BT Excel (Dotesports)",
        url: "https://dotesports.com/league-of-legends/news/karmine-corp-take-down-bt-excel-to-win-european-masters-spring",
        type: "article",
      },
    ],
  },

  {
    slug: "cabochard",
    name: "Cabochard",
    realName: "Lucas Simon-Meslet",
    nationality: "FR",
    role: "top",
    period: "2022-2024",
    subtitle: "Le veteran top laner francais \u2014 porte-drapeau de 2022 a 2024",
    tag: "LE VETERAN",
    signatureChampion: "Aatrox",
    eras: ["lfl-2022-spring", "lfl-2023-summer", "lec-2024-winter", "lec-2024-spring"],
    accentColor: "#C8AA6E",
    bio: [
      "V\u00e9t\u00e9ran de la sc\u00e8ne LoL fran\u00e7aise avec un CV \u00e9tal\u00e9 sur plus d'une d\u00e9cennie (Millenium, Vitality, Ninjas in Pyjamas), Lucas \u00ab Cabochard \u00bb Simon-Meslet rejoint KC en 2022 pour porter le top lane pendant l'\u00e8re Rekkles.",
      "Avec lui, KC remporte son troisi\u00e8me EU Masters cons\u00e9cutif en Spring 2022. Il reste ensuite en LFL pendant 2023 avant de suivre le club vers la LEC pour le slot rachet\u00e9 d'Astralis.",
      "2024 est cruelle. Deux derniers rangs cons\u00e9cutifs en LEC Winter puis Spring. Le reverse sweep reverse contre G2 en playoffs Spring 2024 est son dernier match avec les couleurs bleues. Le 2 mai 2024, KC annonce son benchage. Sa contribution au chapitre le plus lourd de l'histoire du club \u2014 le passage en premi\u00e8re division \u2014 reste in\u00e9dit\u00e9e.",
    ].join("\n\n"),
    stats: [
      { label: "Trophees", value: "1", hint: "EU Masters Spring 2022" },
      { label: "Periode", value: "2022-24", hint: "3 ans avec KC" },
      { label: "Splits LEC", value: "2", hint: "Winter + Spring 2024" },
      { label: "Pourcentage KC", value: "Pionnier LEC", hint: "Premier top laner LEC" },
    ],
    links: [
      {
        label: "Liquipedia \u2014 Cabochard",
        url: "https://liquipedia.net/leagueoflegends/Cabochard",
        type: "wiki",
      },
    ],
  },

  {
    slug: "bo",
    name: "Bo",
    realName: "Zhu Yi-Long",
    nationality: "CN",
    role: "jungle",
    period: "2024",
    subtitle: "Le jungler chinois arrive de Vitality",
    tag: "THE VITALITY TRANSFER",
    signatureChampion: "Viego",
    eras: ["lec-2024-winter", "lec-2024-spring"],
    accentColor: "#E84057",
    bio: [
      "Zhu \u00ab Bo \u00bb Yi-Long est un jungler chinois reconnu pour sa m\u00e9canique solo-queue top-tier, pass\u00e9 par BLG en LPL avant de rejoindre Team Vitality en 2023. KC le recrute pour son d\u00e9but en LEC, d\u00e9cid\u00e9 \u00e0 investir sur des profils individuels forts.",
      "Les deux splits Winter et Spring 2024 sont brutaux pour l'\u00e9quipe enti\u00e8re. KC termine dernier deux fois de suite. Les highlights individuels de Bo existent \u2014 des plays propres sur Viego, des overreach bien ex\u00e9cut\u00e9s \u2014 mais le collectif ne fonctionne pas.",
      "Apr\u00e8s le reverse sweep reverse contre G2 en playoffs Spring 2024, le message de Kameto aux fans promet une reconstruction totale. Bo en fait partie. Il est bench\u00e9 le 2 mai 2024, remplac\u00e9 par Closer pour le Summer \u2014 puis par Yike en 2025 pour Le Sacre.",
    ].join("\n\n"),
    stats: [
      { label: "Splits KC", value: "2", hint: "Winter + Spring 2024" },
      { label: "Origine", value: "LPL", hint: "ex-BLG, ex-Vitality" },
      { label: "Role", value: "Jungle", hint: "solo queue god" },
      { label: "Depart", value: "Mai 2024", hint: "Clean slate" },
    ],
    links: [
      {
        label: "Liquipedia \u2014 Bo",
        url: "https://liquipedia.net/leagueoflegends/Bo",
        type: "wiki",
      },
    ],
  },

  {
    slug: "targamas",
    name: "Targamas",
    realName: "Raphael Crabbe",
    nationality: "BE",
    role: "support",
    period: "2021-2024",
    subtitle: "Le coeur du roster originel \u2014 4 ans au support",
    tag: "LE FIDELE",
    signatureChampion: "Rakan",
    eras: ["lfl-2021-spring", "lfl-2021-summer", "lfl-2023-summer", "lec-2024-winter", "lec-2024-spring", "lec-2024-summer"],
    accentColor: "#0AC8B9",
    bio: [
      "Rapha\u00ebl \u00ab Targamas \u00bb Crabbe est, avec Saken, l'un des derniers membres du roster originel \u00e0 avoir vu toute l'aventure KC de la LFL \u00e0 la LEC. Support belge historique, il porte les couleurs du club depuis la toute premi\u00e8re game comp\u00e9titive en 2021.",
      "Avec le roster originel (Adam, Cinkrof, Saken, xMatty, Targamas), il remporte deux LFL et deux EU Masters en 2021. Il part ensuite pour G2 en 2022, puis revient pour le retour LFL en 2023 o\u00f9 il aide le club \u00e0 r\u00e9cup\u00e9rer son momentum.",
      "En 2024, il est le seul membre du roster originel \u00e0 d\u00e9buter l'\u00e8re LEC avec KC. Il traverse les deux derniers rangs cons\u00e9cutifs, puis reste sur le banc aux c\u00f4t\u00e9s de Vladi, Canna et Upset pour le renouveau Summer 2024. Apr\u00e8s Summer, il passe le flambeau \u00e0 Busio pour le Sacre 2025. Un fid\u00e8le parmi les fid\u00e8les.",
    ].join("\n\n"),
    stats: [
      { label: "Trophees", value: "4+", hint: "2 LFL + 2 EUM 2021 + EUM 2023" },
      { label: "Periode totale", value: "2021-24", hint: "4 ans" },
      { label: "Origine", value: "Belge", hint: "Support de la genese" },
      { label: "Successeur", value: "Busio", hint: "Cede la place en 2025" },
    ],
    links: [
      {
        label: "Liquipedia \u2014 Targamas",
        url: "https://liquipedia.net/leagueoflegends/Targamas",
        type: "wiki",
      },
    ],
  },
  // ─── Saken ────────────────────────────────────────────────────────────
  {
    slug: "saken",
    name: "Saken",
    realName: "Alexandre Mege-Music",
    nationality: "FR",
    role: "mid",
    period: "2021-2022",
    subtitle: "Le premier mid laner de KC, pilier LFL et EU Masters",
    tag: "MID LANER OG",
    signatureChampion: "Akali",
    eras: ["lfl-2021-spring", "lfl-2021-summer", "lfl-2021-showmatch", "lfl-2022"],
    accentColor: "#2196F3",
    bio: "Saken est la dans le roster d'origine de la Karmine Corp en LFL, le mid laner qui a pose les bases du style agressif KC. Pilier du premier titre LFL et des EU Masters 2021, il evolue aux cotes de Rekkles lors de la saison mythique 2022. Son style est marque par une presence en lane dominante et une capacite a creer des avantages en solo. Il quitte KC apres la saison 2022 pour poursuivre en LFL avec d'autres equipes.",
    stats: [
      { label: "Role", value: "MID", hint: "Mid laner" },
      { label: "Periode", value: "2021-22", hint: "2 saisons" },
      { label: "Titres", value: "2 LFL", hint: "+ 2 EU Masters" },
      { label: "Origine", value: "FR", hint: "Mid francais OG" },
    ],
    links: [
      {
        label: "Liquipedia \u2014 Saken",
        url: "https://liquipedia.net/leagueoflegends/Saken",
        type: "wiki",
      },
    ],
  },
  // ─── Cinkrof ──────────────────────────────────────────────────────────
  {
    slug: "cinkrof",
    name: "Cinkrof",
    realName: "Jakub Rokicki",
    nationality: "PL",
    role: "jungle",
    period: "2021",
    subtitle: "Le jungler fondateur, leadership et experience",
    tag: "JUNGLER FONDATEUR",
    signatureChampion: "LeeSin",
    eras: ["lfl-2021-spring", "lfl-2021-summer", "lfl-2021-showmatch"],
    accentColor: "#4CAF50",
    bio: "Cinkrof est le jungler de la toute premiere equipe Karmine Corp en League of Legends, celle qui a conquis la LFL et les EU Masters en 2021. Joueur polonais experimente, il apporte du leadership et une lecture de jeu mature a un roster jeune et fougueux. Sa coordination avec Saken en mid et la botlane est la base du style KC early-game agressif qui deviendra la marque de fabrique de l'equipe. Il quitte KC fin 2021 pour laisser place a la rotation de l'ere Rekkles.",
    stats: [
      { label: "Role", value: "JGL", hint: "Jungler" },
      { label: "Periode", value: "2021", hint: "1 saison fondatrice" },
      { label: "Titres", value: "2 LFL", hint: "+ 2 EU Masters" },
      { label: "Origine", value: "PL", hint: "Experience d'Eastern EU" },
    ],
    links: [
      {
        label: "Liquipedia \u2014 Cinkrof",
        url: "https://liquipedia.net/leagueoflegends/Cinkrof",
        type: "wiki",
      },
    ],
  },
  // ─── 113 ──────────────────────────────────────────────────────────────
  {
    slug: "113",
    name: "113",
    realName: "Mathieu Augereau",
    nationality: "FR",
    role: "top",
    period: "2021",
    subtitle: "Le top laner de la genese, double champion LFL",
    tag: "TOP LANER GENESE",
    signatureChampion: "Renekton",
    eras: ["lfl-2021-spring", "lfl-2021-summer", "lfl-2021-showmatch"],
    accentColor: "#FF5722",
    bio: "113 est le top laner du roster original de KC en LFL 2021, celui qui a tout lance. Francais, combattif, il forme avec Cinkrof, Saken, xMatty et Targamas la premiere equipe qui mettra la Karmine Corp sur la carte du LoL competitif. Double champion LFL, double EU Masters, 113 incarne le spirit combatif de la Blue Wall premiere generation. Son nom de scene numerique est devenu culte dans la communaute KC.",
    stats: [
      { label: "Role", value: "TOP", hint: "Top laner" },
      { label: "Periode", value: "2021", hint: "La genese" },
      { label: "Titres", value: "2 LFL", hint: "+ 2 EU Masters" },
      { label: "Origine", value: "FR", hint: "Top francais OG" },
    ],
    links: [
      {
        label: "Liquipedia \u2014 113",
        url: "https://liquipedia.net/leagueoflegends/113",
        type: "wiki",
      },
    ],
  },
  // ─── Hantera ───────────────────────────────────────────────────────
  {
    slug: "hantera",
    name: "Hantera",
    realName: "Antoine Barbe",
    nationality: "FR",
    role: "support",
    period: "2022",
    subtitle: "Le support francais de l'ere Rekkles",
    tag: "SUPPORT LFL",
    signatureChampion: "Nautilus",
    eras: ["lfl-2022"],
    accentColor: "#00BCD4",
    bio: "Hantera rejoint KC en 2022 comme support aux cotes de Rekkles en botlane. Joueur francais forme en LFL, il apporte une vision de jeu aggressive et une communication native avec le roster francophone. Sa synergie avec Rekkles en lane est l'une des forces du roster qui decroche le triple EU Masters. Il quitte KC a la fin de la saison 2022 quand le club prepare sa transition vers la LEC.",
    stats: [
      { label: "Role", value: "SUP", hint: "Support" },
      { label: "Periode", value: "2022", hint: "Ere Rekkles" },
      { label: "Titres", value: "3 EUM", hint: "Triple EU Masters" },
      { label: "Origine", value: "FR", hint: "Forme en LFL" },
    ],
    links: [
      {
        label: "Liquipedia \u2014 Hantera",
        url: "https://liquipedia.net/leagueoflegends/Hantera",
        type: "wiki",
      },
    ],
  },
  // ─── Adam ─────────────────────────────────────────────────────────
  {
    slug: "adam",
    name: "Adam",
    realName: "Adam Maanane",
    nationality: "FR",
    role: "top",
    period: "2022-2023",
    subtitle: "Le top laner francais, ex-Fnatic, showman de la LFL",
    tag: "TOP LANE SHOWMAN",
    signatureChampion: "Darius",
    eras: ["lfl-2022", "lfl-2023"],
    accentColor: "#FF5722",
    bio: "Adam rejoint KC en 2022 apres son passage eclaire chez Fnatic en LEC. Joueur francais au style ultra-agressif, il est connu pour ses picks non-meta en top lane (Darius, Olaf) qui electrisent le public de la LFL. Sa personnalite forte et son style de jeu spectaculaire en font un favori de la Blue Wall. Il participe a la transition vers la LEC avec KC avant de quitter le club en 2023.",
    stats: [
      { label: "Role", value: "TOP", hint: "Top laner" },
      { label: "Periode", value: "2022-23", hint: "LFL puis transition LEC" },
      { label: "Avant KC", value: "Fnatic", hint: "LEC Summer 2021" },
      { label: "Origine", value: "FR", hint: "Top francais agressif" },
    ],
    links: [
      {
        label: "Liquipedia \u2014 Adam",
        url: "https://liquipedia.net/leagueoflegends/Adam_(French_Player)",
        type: "wiki",
      },
    ],
  },
  // ─── Closer ───────────────────────────────────────────────────────
  {
    slug: "closer",
    name: "Closer",
    realName: "Can Celik",
    nationality: "TR",
    role: "jungle",
    period: "2024",
    subtitle: "Le jungler turc veteran, ex-100 Thieves",
    tag: "VETERAN LCS-LEC",
    signatureChampion: "Viego",
    eras: ["lec-2024-summer"],
    accentColor: "#9C27B0",
    bio: "Closer rejoint KC a l'ete 2024 dans le cadre de la reconstruction post-ere sombre. Jungler turc experimente, il apporte son experience de la LCS (100 Thieves) et du circuit international. Son style proactif en early-game et sa communication en anglais aident KC a sortir de la spirale negative. Bien que les resultats restent modestes (pas de playoffs), son professionnalisme pose les bases de la future reconstruction avec Canna et Yike.",
    stats: [
      { label: "Role", value: "JGL", hint: "Jungler" },
      { label: "Periode", value: "2024 Su", hint: "Ete 2024" },
      { label: "Avant KC", value: "100T", hint: "LCS, Worlds" },
      { label: "Origine", value: "TR", hint: "Veteran international" },
    ],
    links: [
      {
        label: "Liquipedia \u2014 Closer",
        url: "https://liquipedia.net/leagueoflegends/Closer",
        type: "wiki",
      },
    ],
  },
  // ─── Vladi ────────────────────────────────────────────────────────
  {
    slug: "vladi",
    name: "Vladi",
    realName: "Vladimir Naumov",
    nationality: "BG",
    role: "mid",
    period: "2025",
    subtitle: "Le mid laner du Sacre, MVP des finales LEC",
    tag: "MID LANE CHAMPION",
    signatureChampion: "Viktor",
    eras: ["lec-2025-winter", "lec-2025-spring", "lec-2025-summer"],
    accentColor: "#C8AA6E",
    bio: "Vladi est le mid laner qui a accompli le reve KC : gagner un titre LEC. Joueur bulgare recrute pour le roster 2025, il forme avec Canna et Caliste le trio offensif qui defonce la LEC Winter 2025. Son Viktor 10/1/7 en Game 3 de la Grande Finale 3-0 contre G2 est l'un des moments les plus emblematiques de l'histoire KC. Son jeu en teamfight, sa gestion des waves et sa capacite a carry les fins de game tardives font de lui un joueur complet. Il quitte KC a la fin de la saison 2025 quand le club recrute kyeahoo et Busio pour construire la generation suivante.",
    stats: [
      { label: "Role", value: "MID", hint: "Mid laner" },
      { label: "Periode", value: "2025", hint: "L'annee du Sacre" },
      { label: "Titre", value: "LEC Winter", hint: "3-0 vs G2 en finale" },
      { label: "Moment cle", value: "Viktor 10/1/7", hint: "Game 3 Grande Finale" },
    ],
    links: [
      {
        label: "Liquipedia \u2014 Vladi",
        url: "https://liquipedia.net/leagueoflegends/Vladi",
        type: "wiki",
      },
    ],
  },
  // ─── Upset ────────────────────────────────────────────────────────
  {
    slug: "upset",
    name: "Upset",
    realName: "Elias Lipp",
    nationality: "DE",
    role: "adc",
    period: "2024",
    subtitle: "L'ADC allemand veteran, ex-Fnatic, l'ere sombre LEC",
    tag: "ADC WORLDS VETERAN",
    signatureChampion: "Aphelios",
    eras: ["lec-2024-winter", "lec-2024-spring"],
    accentColor: "#FF9800",
    bio: "Upset rejoint KC en janvier 2024 pour la premiere saison LEC du club. ADC allemand de classe mondiale, multiple fois aux Worlds avec Fnatic, il represente le plus gros investissement KC en termes de pedigree international. Sa lane avec Targamas en support est censee etre le moteur de l'equipe. Mais la realite du premier split est cruelle : 10e LEC Winter, 10e LEC Spring, deux derniers rangs consecutifs. Le reverse sweep G2 au Game 5 du Spring restera le moment le plus douloureux. Upset quitte KC a la fin de la saison 2024 quand la reconstruction totale est annoncee par Kameto.",
    stats: [
      { label: "Role", value: "ADC", hint: "AD Carry" },
      { label: "Periode", value: "2024", hint: "L'ere sombre LEC" },
      { label: "Avant KC", value: "Fnatic", hint: "Multiple Worlds" },
      { label: "Resultat", value: "10e x2", hint: "Deux derniers rangs consecutifs" },
    ],
    links: [
      {
        label: "Liquipedia \u2014 Upset",
        url: "https://liquipedia.net/leagueoflegends/Upset",
        type: "wiki",
      },
    ],
  },
];

export function getAlumniBySlug(slug: string): Alumni | undefined {
  return ALUMNI.find((a) => a.slug === slug.toLowerCase());
}

export function getAllAlumniSlugs(): string[] {
  return ALUMNI.map((a) => a.slug);
}
