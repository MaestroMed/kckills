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

/** A short editorial card highlighting a specific KC moment by this alumnus. */
export interface AlumniSignatureMoment {
  title: string;
  /** Human-readable date — "Mai 2022", "2 mars 2025", etc. */
  date: string;
  /** 1-2 sentence editorial copy. Plain text, no HTML. */
  description: string;
  /** Optional champion icon to anchor the card visually. */
  champion?: string;
  /** Optional clip id when the worker has a published kill clip for this. */
  clipId?: string;
}

/** One step of a player's career path — clubs traversed, KC highlighted. */
export interface AlumniCareerStep {
  /** Display name — "Fnatic", "G2 Esports", "Karmine Corp". */
  club: string;
  /** "TOP", "ADC", "SUP" — short uppercase tag. */
  role: string;
  /** Period string — "2018-2020", "2022", "Retraite". */
  period: string;
  /** True when this step is KC. Drives the era-accent highlight. */
  isKC?: boolean;
  /** Optional one-line note shown under the role. */
  note?: string;
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
  /** Editorial highlights — 3-5 cards rendered as MOMENTS SIGNATURES. */
  signatureMoments?: AlumniSignatureMoment[];
  /** Chronological club path — KC step highlighted with isKC flag. */
  careerPath?: AlumniCareerStep[];
  /** Optional pull-quote shown as CITATION TESTAMENTAIRE on the alumni page.
   *  If absent, the page falls back to a Quote from lib/quotes.ts matched
   *  on playerSlug. */
  testamentaryQuote?: {
    text: string;
    author: string;
    role: string;
    source?: string;
  };
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
    testamentaryQuote: {
      text: "La Karmine c'est different. La passion des fans, c'est quelque chose que je n'ai jamais vu en 10 ans de pro.",
      author: "Rekkles",
      role: "ADC KC (2022)",
      source: "Interview sheepesports",
    },
    signatureMoments: [
      {
        title: "Premier pentakill KC",
        date: "Mars 2022",
        description: "Jinx vs GameWard en LFL. La premiere fois qu'un joueur KC realise un penta en officiel \u2014 le public exploiose, Kameto en larmes en cast.",
        champion: "Jinx",
      },
      {
        title: "Reverse sweep vs Vitality.Bee",
        date: "Avril 2022",
        description: "Demi-finale EU Masters Spring 2022. Menes 0-2, KC remonte 3-2 dans une serie sous tension. Rekkles porte le late-game game apres game.",
        champion: "Aphelios",
      },
      {
        title: "16/1/25 en finale EUM",
        date: "7 mai 2022",
        description: "Finale EU Masters Spring 2022 vs LDLC OL. Rekkles signe 16 kills, 1 seule mort, 25 assists sur 4 games. Une stat-line jamais vue en finale ERL.",
        champion: "Jinx",
      },
      {
        title: "Triple EU Masters consecutifs",
        date: "Mai 2022",
        description: "Avec ce trophee, KC devient la premiere equipe de l'histoire a remporter trois EU Masters d'affilee \u2014 une dynastie ecrite avec un seul split de Rekkles.",
        champion: "Sivir",
      },
    ],
    careerPath: [
      { club: "Fnatic", role: "ADC", period: "2014-2017", note: "Trophees LCS EU" },
      { club: "Fnatic", role: "ADC", period: "2018-2020", note: "Finaliste Worlds 2018" },
      { club: "G2 Esports", role: "ADC", period: "2021", note: "Une saison" },
      { club: "Karmine Corp", role: "ADC", period: "Spring 2022", isKC: true, note: "Triple EU Masters" },
      { club: "Fnatic", role: "ADC", period: "2022-2024" },
      { club: "Retraite", role: "Streamer", period: "2024+" },
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
    testamentaryQuote: {
      text: "Personne ne s'attendait a ce qu'on aille aussi loin. Moi non plus, au depart. Et puis la Blue Wall nous a portes.",
      author: "xMatty",
      role: "ADC KC (2021)",
      source: "Interview esports-news.co.uk",
    },
    signatureMoments: [
      {
        title: "Premier UK champion EU Masters",
        date: "2 mai 2021",
        description: "xMatty devient le premier joueur anglais de l'histoire a remporter les EU Masters. Finale KC 3-1 BT Excel devant 377K viewers, un record ERL.",
        champion: "Aphelios",
      },
      {
        title: "Back-to-back EU Masters",
        date: "Septembre 2021",
        description: "Avec Cabochard fraichement arrive, KC remporte les EU Masters Summer en battant Fnatic Rising 3-2. Premiere equipe a realiser le back-to-back.",
        champion: "Jhin",
      },
      {
        title: "KCX1 — Palais des Congres",
        date: "26 juillet 2021",
        description: "Premier evenement physique de la KC Army. 3700 places vendues au Palais des Congres de Paris — la fanbase prend forme, xMatty devient une icone communautaire.",
        champion: "Caitlyn",
      },
    ],
    careerPath: [
      { club: "Excel Esports Academy", role: "ADC", period: "2019-2020" },
      { club: "Karmine Corp", role: "ADC", period: "Spring 2021", isKC: true, note: "La genese" },
      { club: "Karmine Corp", role: "ADC", period: "Summer 2021", isKC: true, note: "Back-to-back EUM" },
      { club: "Fnatic Rising", role: "ADC", period: "2022" },
      { club: "Karmine Corp Blue", role: "ADC", period: "2023" },
      { club: "Free agent", role: "—", period: "2024+" },
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
    testamentaryQuote: {
      text: "On m'a dit que KC en LEC c'etait une blague. J'ai rien a prouver a personne sauf a mes coequipiers.",
      author: "Cabochard",
      role: "TOP KC (2024)",
      source: "Interview pre-saison LEC 2024",
    },
    signatureMoments: [
      {
        title: "Refus du transfert Fnatic",
        date: "Juin 2021",
        description: "Apres 5 ans a Vitality, Cabochard refuse une offre de Fnatic pour rejoindre KC en LFL \u2014 un signal fort que le projet KC depasse deja le simple ERL.",
        champion: "Sett",
      },
      {
        title: "Triple EU Masters",
        date: "Mai 2022",
        description: "Top laner solide pendant le run du 3-peat EU Masters avec Rekkles. Pilier defensif qui contient les diveset laisse l'ADC carry.",
        champion: "Gnar",
      },
      {
        title: "Premiere game LEC KC",
        date: "Janvier 2024",
        description: "Premier match LEC de l'histoire du club. Cabochard est le top laner choisi pour porter le club dans l'elite \u2014 un veteran francais qui ouvre la voie.",
        champion: "Aatrox",
      },
      {
        title: "Le BO5 G2 \u2014 Spring 2024",
        date: "Mai 2024",
        description: "Playoffs LEC Spring 2024. KC remonte 0-2 a 2-2 vs G2, puis s'effondre au Game 5. Dernier match de Cabochard en bleu \u2014 fin de l'ere sombre.",
        champion: "Renekton",
      },
    ],
    careerPath: [
      { club: "Millenium", role: "TOP", period: "2014-2015" },
      { club: "Team Vitality", role: "TOP", period: "2016-2020", note: "5 ans, pilier LEC" },
      { club: "Ninjas in Pyjamas", role: "TOP", period: "2021" },
      { club: "Karmine Corp", role: "TOP", period: "2022-2024", isKC: true, note: "LFL puis LEC" },
      { club: "Free agent", role: "\u2014", period: "2024+" },
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
    testamentaryQuote: {
      text: "Le jeu en LEC est different du LPL. Plus lent, plus macro. Je n'ai pas eu le temps de m'adapter.",
      author: "Bo",
      role: "JGL KC (2024)",
      source: "Interview post-saison 2024 (traduit)",
    },
    signatureMoments: [
      {
        title: "Transfert depuis Vitality",
        date: "Decembre 2023",
        description: "KC mise sur la mecanique solo-queue top-tier du jungler chinois pour son entree en LEC. Un pari individualiste qui ne paie pas a Berlin.",
        champion: "Viego",
      },
      {
        title: "Plays sur Viego",
        date: "Spring 2024",
        description: "Les highlights individuels existent \u2014 des overreach propres, des invades calcules. Mais le collectif KC ne suit pas et les playoffs se referment.",
        champion: "Viego",
      },
      {
        title: "Le BO5 G2 \u2014 Spring 2024",
        date: "Mai 2024",
        description: "Dernier match de Bo en bleu. KC remonte 0-2 a 2-2 vs G2, puis perd au Game 5. Le 2 mai, le bench est annonce. Closer arrive pour le Summer.",
        champion: "Lee Sin",
      },
    ],
    careerPath: [
      { club: "Bilibili Gaming", role: "JGL", period: "2022", note: "LPL Academy" },
      { club: "Team Vitality", role: "JGL", period: "2023" },
      { club: "Karmine Corp", role: "JGL", period: "2024", isKC: true, note: "L'ere sombre" },
      { club: "Retour LPL", role: "JGL", period: "2024+" },
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
    testamentaryQuote: {
      text: "On etait cinq potes en 2021. On est devenu une institution. C'est pas le titre LEC qui change le plus \u2014 c'est tout ce qu'il y a autour.",
      author: "Targamas",
      role: "SUP KC (2021-2024)",
      source: "Interview KC content team",
    },
    signatureMoments: [
      {
        title: "Roster originel",
        date: "Janvier 2021",
        description: "Adam, Cinkrof, Saken, xMatty, Targamas. Cinq joueurs qui ne savent pas encore qu'ils vont creer la plus grosse fanbase europeenne.",
        champion: "Rakan",
      },
      {
        title: "Double EU Masters 2021",
        date: "Mai + Sept 2021",
        description: "Spring + Summer EU Masters consecutifs. Targamas est l'engage du roster, peel parfait sur xMatty, win conditions claires sur chaque dive.",
        champion: "Leona",
      },
      {
        title: "Le retour 2023",
        date: "Summer 2023",
        description: "Targamas revient en LFL apres une saison G2. KC remporte le titre, rachete le slot Astralis, et il monte avec eux en LEC pour 2024.",
        champion: "Nautilus",
      },
      {
        title: "Le seul OG en LEC",
        date: "2024",
        description: "Dernier membre du roster originel a debuter l'ere LEC avec KC. Il traverse les deux derniers rangs avant de ceder sa place a Busio en 2025.",
        champion: "Bard",
      },
      {
        title: "Le Sacre LEC 2025",
        date: "2 mars 2025",
        description: "Avec Vladi, Yike, Canna et Caliste, Targamas remporte le premier titre LEC de l'histoire du club. 3-0 SEC vs G2. Cloture en beaute.",
        champion: "Thresh",
      },
    ],
    careerPath: [
      { club: "Misfits Premier", role: "SUP", period: "2020" },
      { club: "Karmine Corp", role: "SUP", period: "2021", isKC: true, note: "Roster originel" },
      { club: "G2 Esports", role: "SUP", period: "2022", note: "LEC" },
      { club: "Karmine Corp", role: "SUP", period: "2023-2025", isKC: true, note: "LFL puis LEC, Sacre 2025" },
      { club: "French Flair", role: "SUP", period: "2026+" },
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
    testamentaryQuote: {
      text: "Saken c'etait notre rock. Le mid qui arrive a 100% chaque game, peu importe le contexte.",
      author: "Striker",
      role: "Head Coach KC (2021-2024)",
      source: "Interview retrospective",
    },
    signatureMoments: [
      {
        title: "Mid de la genese",
        date: "Janvier 2021",
        description: "Premier mid laner de l'histoire KC. Pose les bases du style agressif KC en lane avec un Akali signature et un pool meta-prouf.",
        champion: "Akali",
      },
      {
        title: "Double EU Masters 2021",
        date: "2021",
        description: "Pilier offensif des deux titres EU Masters consecutifs. Sa pression en lane libere xMatty et Targamas en botlane.",
        champion: "Sylas",
      },
      {
        title: "L'annee Rekkles",
        date: "2022",
        description: "Saken reste pendant l'ere Rekkles, complete avec un mid solide. Triple EU Masters au compteur, mais ce sera sa derniere saison KC.",
        champion: "Akali",
      },
    ],
    careerPath: [
      { club: "Vitality.Bee", role: "MID", period: "2020" },
      { club: "Karmine Corp", role: "MID", period: "2021-2022", isKC: true, note: "Double EUM 2021 + 3-peat 2022" },
      { club: "Karmine Corp", role: "MID", period: "2023-2024", isKC: true, note: "LFL puis LEC Winter/Spring" },
      { club: "Free agent", role: "—", period: "2024+" },
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
    testamentaryQuote: {
      text: "On etait 5 inconnus en LFL. Cinkrof savait deja qu'on allait gagner. Sa confiance a porte toute l'equipe.",
      author: "Targamas",
      role: "SUP KC (2021)",
      source: "Interview retrospective genese",
    },
    signatureMoments: [
      {
        title: "Premier titre LFL",
        date: "Mai 2021",
        description: "Cinkrof dicte le tempo en early-game et installe KC en tete de la LFL des le premier split. La marque de fabrique KC nait avec lui.",
        champion: "Lee Sin",
      },
      {
        title: "Game 5 EUM Summer 2021",
        date: "Septembre 2021",
        description: "Finale EU Masters Summer 2021 vs Fnatic Rising. Game 5 stomp en 21 minutes — Cinkrof Jarvan IV controle chaque dragon, chaque objectif.",
        champion: "JarvanIV",
      },
      {
        title: "Back-to-back EUM",
        date: "Septembre 2021",
        description: "KC devient la premiere equipe a remporter deux EU Masters consecutifs. Cinkrof part en fin d'annee, laissant place a l'ere Rekkles.",
        champion: "Viego",
      },
    ],
    careerPath: [
      { club: "AGO Rogue", role: "JGL", period: "2018-2019", note: "LPLOL/UPL polonais" },
      { club: "Origen", role: "JGL", period: "2020" },
      { club: "Karmine Corp", role: "JGL", period: "2021", isKC: true, note: "Roster originel, 2 LFL + 2 EUM" },
      { club: "Karmine Corp", role: "JGL", period: "Summer 2023", isKC: true, note: "Retour pour la renaissance LFL" },
      { club: "Free agent", role: "—", period: "2024+" },
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
    testamentaryQuote: {
      text: "Mon pseudo c'est juste un numero. Mais quand t'arrives en KC, tu sais que tu vas faire partie d'une histoire.",
      author: "113",
      role: "TOP KC (2021)",
      source: "Interview KC content",
    },
    signatureMoments: [
      {
        title: "Top laner OG",
        date: "Janvier 2021",
        description: "Le top du roster originel KC. Style ultra-combatif, peu de respect pour les meta picks. Renekton signature.",
        champion: "Renekton",
      },
      {
        title: "EU Masters Spring 2021",
        date: "2 mai 2021",
        description: "Champion EU Masters Spring 2021 contre BT Excel. 113 tient son top contre des picks LEC-tier avec serieux et intensite.",
        champion: "Camille",
      },
      {
        title: "Back-to-back EU Masters",
        date: "Septembre 2021",
        description: "Deux EU Masters consecutifs, deux LFL. 113 transmet le flambeau a Cabochard en fin d'annee et part chez Fnatic.",
        champion: "Aatrox",
      },
    ],
    careerPath: [
      { club: "Misfits Premier", role: "TOP", period: "2020", note: "LFL" },
      { club: "Karmine Corp", role: "TOP", period: "2021", isKC: true, note: "Roster originel, 2 LFL + 2 EUM" },
      { club: "Fnatic Rising", role: "TOP", period: "2022" },
      { club: "Solary", role: "TOP", period: "2023+" },
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
    testamentaryQuote: {
      text: "Jouer support de Rekkles c'etait l'opportunite de ma vie. Je devais juste pas le decevoir.",
      author: "Hantera",
      role: "SUP KC (2022)",
      source: "Interview LFL",
    },
    signatureMoments: [
      {
        title: "Support de Rekkles",
        date: "Janvier 2022",
        description: "Hantera est choisi pour completer la botlane avec Rekkles. Communication francaise native, lecture de jeu solide, peel maximale.",
        champion: "Nautilus",
      },
      {
        title: "Pentakill Jinx vs GameWard",
        date: "Mars 2022",
        description: "Hantera setup le penta de Rekkles avec un Lulu peel parfait. Le public LFL explose — premier penta KC de l'histoire.",
        champion: "Lulu",
      },
      {
        title: "Triple EU Masters",
        date: "Mai 2022",
        description: "Le 3-peat. Hantera fait partie du roster qui ecrit la dynastie ERL. Sa contribution defensive sur Rakan/Nautilus est cle.",
        champion: "Rakan",
      },
    ],
    careerPath: [
      { club: "GameWard", role: "SUP", period: "2021", note: "LFL" },
      { club: "Karmine Corp", role: "SUP", period: "2022", isKC: true, note: "Triple EU Masters" },
      { club: "Vitality.Bee", role: "SUP", period: "2023+" },
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
    testamentaryQuote: {
      text: "Quand t'es top laner pour KC, t'as 50 000 personnes derriere toi. T'as pas le droit de jouer petit.",
      author: "Adam",
      role: "TOP KC (2022-2023)",
      source: "Interview LFL post-match",
    },
    signatureMoments: [
      {
        title: "Le Darius KC",
        date: "Spring 2022",
        description: "Adam impose son style ultra-agressif en LFL. Darius/Olaf signature, flash engages risques. Le public adore le spectacle.",
        champion: "Darius",
      },
      {
        title: "Triple EU Masters",
        date: "Mai 2022",
        description: "Champion EU Masters avec KC. Adam est le top de l'ere Rekkles, contrepoint mecanique au calme defensif de Cabochard.",
        champion: "Camille",
      },
      {
        title: "Transition LEC",
        date: "2023",
        description: "Adam participe au split LFL 2023 qui prepare la transition LEC. Il quitte KC en fin d'annee avant le rachat Astralis.",
        champion: "Olaf",
      },
    ],
    careerPath: [
      { club: "LDLC OL", role: "TOP", period: "2020" },
      { club: "Fnatic", role: "TOP", period: "Summer 2021", note: "LEC, eclair" },
      { club: "Karmine Corp", role: "TOP", period: "2022-2023", isKC: true, note: "Triple EUM 2022" },
      { club: "Vitality", role: "TOP", period: "2024+" },
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
    testamentaryQuote: {
      text: "Je suis arrive en pleine reconstruction. L'objectif c'etait pas seulement gagner, c'etait reapprendre a gagner.",
      author: "Closer",
      role: "JGL KC (2024)",
      source: "Interview Summer 2024",
    },
    signatureMoments: [
      {
        title: "Le pari Summer 2024",
        date: "Juin 2024",
        description: "Closer arrive depuis 100 Thieves (LCS). Veteran international, communication anglaise, c'est le pivot pro qui stabilise un roster en pleine reconstruction.",
        champion: "Viego",
      },
      {
        title: "4e place LEC",
        date: "Septembre 2024",
        description: "Avec Canna et Vladi, KC passe de dernier a 4e en un seul split. Premier playoff LEC gagne dans l'histoire du club.",
        champion: "Sejuani",
      },
      {
        title: "Cession a Yike",
        date: "Decembre 2024",
        description: "Closer quitte KC en fin de saison. Le club prepare le Sacre 2025 et recrute Yike pour devenir le jungler du titre LEC.",
        champion: "JarvanIV",
      },
    ],
    careerPath: [
      { club: "Schalke 04", role: "JGL", period: "2020", note: "LEC" },
      { club: "Team Liquid", role: "JGL", period: "2021", note: "LCS" },
      { club: "100 Thieves", role: "JGL", period: "2022-2023", note: "LCS + Worlds 2022" },
      { club: "Karmine Corp", role: "JGL", period: "Summer 2024", isKC: true, note: "4e LEC, fin ere sombre" },
      { club: "FlyQuest", role: "JGL", period: "2025+" },
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
    testamentaryQuote: {
      text: "Quand j'ai signe a KC, on me prenait pour un rookie LFL. J'ai termine MVP de la Grande Finale LEC un an plus tard.",
      author: "Vladi",
      role: "MID KC (2025)",
      source: "Interview post-finale LEC Winter 2025",
    },
    signatureMoments: [
      {
        title: "Promu depuis KCB",
        date: "Juin 2024",
        description: "Apres avoir remporte la LFL Spring avec KCB, Vladi est promu au roster principal pour le Summer LEC. Premier import bulgare en LEC.",
        champion: "Viktor",
      },
      {
        title: "First Stand Seoul",
        date: "Mars 2025",
        description: "Premiere apparition internationale. Vladi tient son mid contre des stars LPL/LCK et porte KC jusqu'a la finale. KC 1-3 HLE.",
        champion: "Azir",
      },
      {
        title: "Viktor 10/1/7 — Game 3 LEC",
        date: "2 mars 2025",
        description: "Grande Finale LEC Winter 2025 vs G2. Vladi sort un Viktor monstrueux, demonte Caps en lane, scelle le 3-0. MVP de la finale.",
        champion: "Viktor",
        clipId: undefined,
      },
      {
        title: "LEC Rookie Champion",
        date: "2 mars 2025",
        description: "Avec Caliste, Vladi devient l'un des plus jeunes mid champions LEC. Premiere equipe francaise titree, premiere mid laner BG sacre.",
        champion: "Sylas",
      },
      {
        title: "Transfert Fnatic",
        date: "Decembre 2025",
        description: "Apres une saison historique, Vladi part chez Fnatic pour 2026. KC le remplace par Kyeahoo (ex-DRX) pour entamer un nouveau cycle.",
        champion: "LeBlanc",
      },
    ],
    careerPath: [
      { club: "Karmine Corp Blue", role: "MID", period: "Spring 2024", note: "LFL champion" },
      { club: "Karmine Corp", role: "MID", period: "2024-2025", isKC: true, note: "Sacre LEC Winter 2025 — MVP" },
      { club: "Fnatic", role: "MID", period: "2026+" },
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
    testamentaryQuote: {
      text: "J'ai signe pour porter ce club en LEC. La realite a ete plus cruelle que tout ce que j'imaginais. Ce sont les fans qui m'ont garde debout.",
      author: "Upset",
      role: "ADC KC (2024)",
      source: "Stream personnel post-saison",
    },
    signatureMoments: [
      {
        title: "Le transfert Fnatic",
        date: "Decembre 2023",
        description: "Multi-Worlds avec Fnatic, Upset est le plus gros pedigree international jamais signe par KC pour son entree LEC. Le pari est total.",
        champion: "Aphelios",
      },
      {
        title: "Premier match LEC KC",
        date: "Janvier 2024",
        description: "Premiere apparition LEC de Karmine Corp. Upset porte les attentes du Blue Wall mais le collectif ne fonctionne pas — 10e Winter.",
        champion: "Zeri",
      },
      {
        title: "Le BO5 G2",
        date: "Mai 2024",
        description: "Playoffs LEC Spring. KC remonte 0-2 a 2-2 vs G2 puis perd au Game 5. Le reverse sweep reverse. Dernier match d'Upset en bleu.",
        champion: "Jhin",
      },
      {
        title: "Retraite courte",
        date: "Mai 2024",
        description: "Apres le bench KC, Upset annonce une pause carriere puis un retour ESL ProLeague en 2025. Trace cruelle pour un ADC top-tier.",
        champion: "Aphelios",
      },
    ],
    careerPath: [
      { club: "Schalke 04", role: "ADC", period: "2018-2019" },
      { club: "Fnatic", role: "ADC", period: "2020-2023", note: "Multiple Worlds, finaliste LEC" },
      { club: "Karmine Corp", role: "ADC", period: "2024", isKC: true, note: "L'ere sombre LEC" },
      { club: "Pause / Free agent", role: "—", period: "2024-2025" },
    ],
  },
];

export function getAlumniBySlug(slug: string): Alumni | undefined {
  return ALUMNI.find((a) => a.slug === slug.toLowerCase());
}

export function getAllAlumniSlugs(): string[] {
  return ALUMNI.map((a) => a.slug);
}
