/** KC Eras — granular splits with factually verified content.
 *  Last research pass: April 2026 (verified via Liquipedia, Leaguepedia,
 *  dotesports, sheepesports, egamersworld, invenglobal, escharts). */

export interface EraLink {
  label: string;
  url: string;
  type: "youtube" | "article" | "wiki" | "twitch" | "tiktok";
}

export interface Era {
  id: string;
  period: string;         // "Spring 2021", "Winter 2025", etc.
  phase: string;          // "LFL" | "EU Masters" | "LEC" | "International" | "Community"
  label: string;          // "La Genese"
  subtitle: string;       // Short tagline
  color: string;
  result: string;
  icon: string;
  image: string | null;
  dateStart: string;      // YYYY-MM-DD
  dateEnd: string;        // YYYY-MM-DD
  roster?: string;
  coach?: string;
  keyMoment: string;      // Longer narrative paragraph
  viewership?: string;
  links: EraLink[];
  events?: string[];
  clipsQuery?: string;    // YouTube search query for clips from this era
}

export const ERAS: Era[] = [
  {
    id: "lfl-2021-spring",
    period: "Spring 2021",
    phase: "LFL",
    label: "La Genese",
    subtitle: "Le tout premier split",
    color: "#00C853",
    result: "\uD83C\uDFC6 LFL + \uD83C\uDFC6 EU Masters",
    icon: "\u2694\uFE0F",
    image: "/images/eras/2021-lfl-spring-champions.jpg",
    dateStart: "2021-01-12",
    dateEnd: "2021-05-02",
    roster: "Adam (top) \u00b7 Cinkrof (jgl) \u00b7 Saken (mid) \u00b7 xMatty (adc) \u00b7 Targamas (sup)",
    coach: "Striker",
    keyMoment:
      "Pour leur tout premier split competitif, les cinq membres originaux de la Karmine Corp dominent la LFL et remportent le trophee. Aux EU Masters, ils perdent le Game 1 vs BT Excel apres un combat de 40+ minutes, puis enchainent 3 victoires pour s'imposer 3-1 en finale. xMatty devient le premier joueur anglais a remporter les EU Masters. Pic de 377 000 viewers sur la finale \u2014 record de l'epoque pour un tournoi ERL.",
    viewership: "377K peak viewers \u2014 Finale EU Masters",
    events: [
      "LFL Spring 2021 \u2014 Champions (1\u00e8re place regular season)",
      "EU Masters Spring 2021 \u2014 KC 3-1 BT Excel",
      "xMatty : premier joueur UK champion EU Masters",
    ],
    clipsQuery: "karmine corp eu masters spring 2021 final bt excel",
    links: [
      {
        label: "Finale EU Masters Spring 2021 vs BT Excel",
        url: "https://www.youtube.com/results?search_query=Riot+Games+EU+Masters+2021+Spring+Final+BT+Excel+Karmine+Corp",
        type: "youtube",
      },
      {
        label: "Best plays LFL Spring 2021",
        url: "https://www.youtube.com/results?search_query=OTPLOL+LFL+Spring+2021+Karmine+Corp+final",
        type: "youtube",
      },
      {
        label: "Article \u2014 xMatty premier UK champion",
        url: "https://esports-news.co.uk/2021/05/02/xmatty-first-uk-player-win-eu-masters-karmine-corp-bt-excel/",
        type: "article",
      },
      {
        label: "Article \u2014 Finale 3-1 vs BT Excel (Dotesports)",
        url: "https://dotesports.com/league-of-legends/news/karmine-corp-take-down-bt-excel-to-win-european-masters-spring",
        type: "article",
      },
    ],
  },
  {
    id: "lfl-2021-summer",
    period: "Summer 2021",
    phase: "LFL",
    label: "Back to Back",
    subtitle: "L'arrivee de Cabochard",
    color: "#FFD700",
    result: "\uD83C\uDFC6 LFL + \uD83C\uDFC6 EU Masters",
    icon: "\uD83C\uDFC6",
    image: "/images/eras/2021-lfl.jpg",
    dateStart: "2021-06-01",
    dateEnd: "2021-09-19",
    roster: "Cabochard (top) \u00b7 Cinkrof (jgl) \u00b7 Saken (mid) \u00b7 xMatty (adc) \u00b7 Hantera (sup)",
    coach: "Striker",
    keyMoment:
      "Adam part a Fnatic LEC, Cabochard arrive de Vitality apres 5 ans la-bas \u2014 il refuse une offre de Fnatic pour rester. KC remporte un second titre LFL consecutif puis s'attaque aux EU Masters. En finale vs Fnatic Rising, KC prend 2-0, Fnatic revient 2-2, puis KC stomp le Game 5 en 21 minutes grace a un Cinkrof Jarvan IV qui dicte le tempo. Premiere equipe de l'histoire a remporter deux EU Masters consecutifs.",
    events: [
      "LFL Summer 2021 \u2014 Champions",
      "EU Masters Summer 2021 \u2014 KC 3-2 Fnatic Rising (Game 5 en 21 minutes)",
      "Premiere equipe \u00e0 realiser le back-to-back EU Masters",
      "KCX1 \u2014 Palais des Congres Paris, 26 juillet 2021, 3700 places",
    ],
    clipsQuery: "karmine corp eu masters summer 2021 fnatic rising",
    links: [
      {
        label: "Full BO5 \u2014 KC vs FNC.R EU Masters Summer 2021",
        url: "https://www.youtube.com/watch?v=tQCYNY2nbPY",
        type: "youtube",
      },
      {
        label: "Finale Game 1 vs Fnatic Rising",
        url: "https://www.youtube.com/watch?v=fshmFmnkTzc",
        type: "youtube",
      },
      {
        label: "Finale Game 4 vs Fnatic Rising",
        url: "https://www.youtube.com/watch?v=C_8MnJqUmdE",
        type: "youtube",
      },
      {
        label: "OTP VODs \u2014 Finale complete",
        url: "https://www.youtube.com/watch?v=3bTnsLX3euw",
        type: "youtube",
      },
      {
        label: "KCX1 Recap \u2014 Palais des Congres",
        url: "https://www.youtube.com/results?search_query=KCX1+Karmine+Corp+Palais+des+Congres+2021",
        type: "youtube",
      },
      {
        label: "Article \u2014 Back-to-back EU Masters (Dotesports)",
        url: "https://dotesports.com/league-of-legends/news/karmine-corp-back-to-back-eu-masters-fnatic-rising",
        type: "article",
      },
    ],
  },
  {
    id: "lfl-2021-showmatch",
    period: "December 2021",
    phase: "Community",
    label: "KC vs KOI",
    subtitle: "Showmatch legendaire \u2014 477K",
    color: "#FF6B00",
    result: "KOI 2-1 KC \u2014 Show historique",
    icon: "\uD83D\uDD25",
    image: null,
    dateStart: "2021-12-01",
    dateEnd: "2021-12-31",
    coach: "Striker",
    keyMoment:
      "Showmatch historique organise entre Kameto et Ibai au Palau Sant Jordi de Barcelone le 15 decembre 2021. KOI (Ibai + Pique + amis) gagne 2-1 devant 15 000 fans espagnols \u2014 mais 257 fans du Blue Wall ont fait le voyage en terre hostile et couvrent le stade en chants KC. Le show atteint 477 000 viewers simultanes sur Twitch, depassant la finale LCS Summer 2021 (364K). Match retour le 8 janvier 2022 au Carrousel du Louvre a Paris. Naissance de la rivalite KC vs KOI et preuve que les showmatchs Streamer Legend pouvaient rivaliser avec le plus haut niveau competitif.",
    viewership: "477K peak viewers Twitch \u00b7 257 Blue Wall en terre hostile",
    events: [
      "15 dec 2021 \u2014 Palau Sant Jordi, Barcelone (15 000 places)",
      "257 Blue Wall en terre hostile \u2014 les legendes du voyage",
      "477K peak viewers Twitch \u2014 plus que la finale LCS Summer 2021 (364K)",
      "Match retour 8 jan 2022 \u2014 Carrousel du Louvre, Paris",
      "Naissance de la rivalite KC vs KOI",
    ],
    clipsQuery: "karmine corp vs koi showmatch barcelona 2021 ibai",
    links: [
      {
        label: "KC vs KOI Showmatch Full",
        url: "https://www.youtube.com/results?search_query=karmine+corp+vs+koi+showmatch+barcelona+2021+ibai+kameto",
        type: "youtube",
      },
      {
        label: "Kameto reactions KOI",
        url: "https://www.youtube.com/results?search_query=kameto+reaction+koi+ibai+showmatch",
        type: "youtube",
      },
    ],
  },
  {
    id: "lfl-2022-spring",
    period: "Spring 2022",
    phase: "LFL",
    label: "L'Ere Rekkles",
    subtitle: "16/1/25 \u2014 le triple EUM",
    color: "#FFD700",
    result: "\uD83C\uDFC6 EU Masters \u00b7 3-peat historique",
    icon: "\uD83D\uDC51",
    image: "/images/eras/2022-rekkles.jpg",
    dateStart: "2022-01-10",
    dateEnd: "2022-05-07",
    roster: "Cabochard (top) \u00b7 113 (jgl) \u00b7 Saken (mid) \u00b7 Rekkles (adc) \u00b7 Hantera (sup)",
    coach: "Striker",
    keyMoment:
      "Rekkles, legende de Fnatic, rejoint la LFL \u2014 le plus gros transfert ERL de l'histoire. En LFL, playoffs decevants (3e, elimines en lower bracket par BDS Academy). Premier pentakill de KC par Rekkles sur Jinx vs GameWard. Aux EU Masters, reverse sweep en demi-finale vs Vitality.Bee (0-2 a 3-2), puis Rekkles sort un 16/1/25 sur toute la finale vs LDLC OL \u2014 UNE SEULE MORT en 4 games. KC devient la premiere equipe a remporter 3 EU Masters consecutifs.",
    events: [
      "Transfert historique de Rekkles (ex-Fnatic)",
      "Premier pentakill KC \u2014 Rekkles Jinx vs GameWard",
      "LFL Spring 2022 \u2014 3e place (elimines par BDS Academy)",
      "EU Masters Spring 2022 \u2014 Reverse sweep semi vs Vitality.Bee",
      "EU Masters Spring 2022 \u2014 KC 3-1 LDLC OL (Rekkles 16/1/25)",
      "KCX2 \u2014 AccorHotels Arena, 12 000 places vendues en <10h",
    ],
    clipsQuery: "karmine corp rekkles eu masters spring 2022 ldlc",
    links: [
      {
        label: "Rekkles PENTAKILL Jinx vs GameWard (Kameto Clips)",
        url: "https://www.youtube.com/watch?v=j9JlExfa9mY",
        type: "youtube",
      },
      {
        label: "Rekkles Pentakill \u2014 EpicSkillshot",
        url: "https://www.youtube.com/watch?v=XlBBtLR2ZIY",
        type: "youtube",
      },
      {
        label: "Rekkles Pentakill \u2014 EsportTV",
        url: "https://www.youtube.com/watch?v=xpTfK-c4724",
        type: "youtube",
      },
      {
        label: "Finale EUM Spring 2022 \u2014 Game 2 KC vs LDLC",
        url: "https://www.youtube.com/watch?v=cTs8IKYW5lI",
        type: "youtube",
      },
      {
        label: "Finale EUM Spring 2022 \u2014 Game 2 Highlights EN",
        url: "https://www.youtube.com/watch?v=_WpInkIi7RM",
        type: "youtube",
      },
      {
        label: "Finale EUM Spring 2022 \u2014 Full broadcast OTP",
        url: "https://www.youtube.com/watch?v=XnDoVuynLr8",
        type: "youtube",
      },
      {
        label: "Article \u2014 KC 3-1 LDLC (Inven Global)",
        url: "https://www.invenglobal.com/articles/17126/karmine-corp-defeats-ldlc-ol-3-1-to-win-2022-eu-masters-spring-finals",
        type: "article",
      },
      {
        label: "Article \u2014 Rekkles Pentakill (Dotesports)",
        url: "https://dotesports.com/league-of-legends/news/rekkles-sends-lfl-crowd-into-frenzy-with-his-first-pentakill-with-karmine-corp",
        type: "article",
      },
    ],
  },
  {
    id: "lfl-2022-summer",
    period: "Summer 2022",
    phase: "LFL",
    label: "Le Plafond",
    subtitle: "Fin d'une domination",
    color: "#A09B8C",
    result: "\u00c9chec EU Masters Summer",
    icon: "\uD83D\uDCC9",
    image: "/images/eras/2022-lfl-summer-plafond.jpg",
    dateStart: "2022-06-01",
    dateEnd: "2022-10-31",
    roster: "Cabochard (top) \u00b7 113 (jgl) \u00b7 Saken (mid) \u00b7 Rekkles (adc) \u00b7 Hantera (sup)",
    coach: "Striker",
    keyMoment:
      "Apres le sommet du 3-peat EU Masters, KC ne parvient pas a se qualifier pour la finale EU Masters Summer 2022. Premier coup de froid pour le cycle LFL. La KC Army commence a reclamer une place en LEC \u2014 et Kameto commence a discuter en coulisses du rachat d'un slot.",
    clipsQuery: "karmine corp lfl summer 2022",
    links: [
      {
        label: "LFL Summer 2022 highlights",
        url: "https://www.youtube.com/results?search_query=OTPLOL+LFL+Summer+2022+Karmine+Corp",
        type: "youtube",
      },
    ],
  },
  {
    id: "lfl-2023-spring",
    period: "Spring 2023",
    phase: "LFL",
    label: "Le Split Oublie",
    subtitle: "KC LEONA, Whiteinn, et la fin d'un monde",
    color: "#5B6A8A",
    result: "\uD83D\uDC94 Hors playoffs \u00b7 lore community",
    icon: "\uD83C\uDF2B\uFE0F",
    image: "/images/eras/2023-lfl-spring-desert.jpg",
    dateStart: "2023-01-15",
    dateEnd: "2023-04-20",
    roster: "Cabochard (top) \u00b7 Skeanz (jgl) \u00b7 Saken (mid) \u00b7 Kaori (adc) \u00b7 WhiteInn (sup)",
    coach: "Striker",
    keyMoment:
      "Le split que tout le monde veut oublier mais que la KC Army a transforme en legende. Pour la premiere fois de son histoire, la Karmine Corp rate les playoffs LFL. Depart de Rekkles, 113 et Hantera. Alchimie inexistante. Fond de classement. Le meme WhiteInn Leona devient immortel — un support enferme dans un seul champion pool, la com' qui crie \u00ab KC LEONA \u00bb apres chaque pick, les highlights improbables qui tournent sur Twitter. La KC Army detourne la douleur en meme. C'est le point le plus bas du club, et paradoxalement une des periodes les plus memorables pour la base de fans. Quelques mois plus tard, KC reviendra avec Caliste en LFL Summer puis rachetera le slot LEC d'Astralis.",
    viewership: "Le meme KC LEONA vit encore en 2026",
    events: [
      "Premiere elimination sans playoffs LFL de l'histoire de KC",
      "Whiteinn \u00ab KC LEONA \u00bb \u2014 naissance du meme community",
      "Saken solo au mid, Cabochard sous-utilise",
      "La KC Army transforme le drame en legende",
    ],
    clipsQuery: "karmine corp whiteinn leona lfl spring 2023",
    links: [
      {
        label: "LFL Spring 2023 highlights",
        url: "https://www.youtube.com/results?search_query=OTPLOL+LFL+Spring+2023+Karmine+Corp",
        type: "youtube",
      },
      {
        label: "\u00ab KC LEONA \u00bb \u2014 meme compilation",
        url: "https://www.youtube.com/results?search_query=KC+Leona+Whiteinn+compilation",
        type: "youtube",
      },
    ],
  },
  {
    id: "lfl-2023-summer",
    period: "Summer 2023",
    phase: "LFL",
    label: "La Renaissance",
    subtitle: "Caliste rookie \u00b7 rachat Astralis",
    color: "#2196F3",
    result: "\uD83C\uDFC6 LFL + Promotion LEC",
    icon: "\uD83D\uDE80",
    image: "/images/eras/2023-lec.jpg",
    dateStart: "2023-06-01",
    dateEnd: "2023-12-31",
    roster: "Cabochard (top) \u00b7 Cinkrof (jgl) \u00b7 Saken (mid) \u00b7 Caliste (adc) \u00b7 Targamas (sup)",
    coach: "Striker",
    keyMoment:
      "Retour de Cinkrof et Targamas, debut en pro du rookie Caliste (18 ans \u2014 futur ROY). KC sort une serie de 7 victoires d'affilee, termine 1er en regular season, et balaie BK ROG 3-0 en finale LFL. Le 18 octobre 2023, l'annonce tombe : KC rachete 66,67% du slot LEC d'Astralis pour 129M DKK (~15M\u20ac). Kameto : \u00ab On vise le Championnat du Monde dans 5 a 10 ans. \u00bb Le meme week-end, KCX3 explose le record europeen d'affluence esport avec 28 000 fans a Paris La Defense Arena.",
    events: [
      "LFL Summer 2023 \u2014 KC 3-0 BK ROG",
      "Debut de Caliste en pro (18 ans)",
      "Rachat slot LEC Astralis \u2014 18 octobre 2023",
      "KCX3 Paris La Defense Arena \u2014 28 000 fans (record EU esport)",
    ],
    clipsQuery: "karmine corp lfl summer 2023 bk rog final",
    links: [
      {
        label: "Finale LFL Summer 2023 vs BK ROG",
        url: "https://www.youtube.com/results?search_query=Karmine+Corp+BK+ROG+LFL+Summer+2023+Final",
        type: "youtube",
      },
      {
        label: "KCX3 Recap \u2014 La Defense Arena",
        url: "https://www.youtube.com/results?search_query=KCX3+Karmine+Corp+La+Defense+Arena",
        type: "youtube",
      },
      {
        label: "Annonce officielle rachat Astralis",
        url: "https://lolesports.com/en-US/news/karmine-corp-acquires-astralis-lec-slot",
        type: "article",
      },
      {
        label: "KCX3 \u2014 28 000 fans (42mag)",
        url: "https://42mag.fr/2023/09/karmine-corp-attire-28-000-fans-a-paris-la-defense-arena-pour-kcx3-ce-16-septembre-objectif-devenir-lun-des-plus-grands-clubs-mondiaux/",
        type: "article",
      },
    ],
  },
  {
    id: "lec-2024-winter",
    period: "Winter 2024",
    phase: "LEC",
    label: "Bienvenue en LEC",
    subtitle: "L'entree dans l'ere sombre",
    color: "#FF9800",
    result: "\uD83D\uDC94 10e (dernier)",
    icon: "\uD83C\uDF31",
    image: "/images/eras/2024-lec-winter-slot.jpg",
    dateStart: "2024-01-13",
    dateEnd: "2024-03-10",
    roster: "Cabochard (top) \u00b7 Bo (jgl) \u00b7 Saken (mid) \u00b7 Upset (adc) \u00b7 Targamas (sup)",
    coach: "Striker",
    keyMoment:
      "Premier split LEC de l'histoire de KC \u2014 et debut de l'ere sombre. Porte par la plus grosse fanbase d'Europe apres le rachat du slot Astralis, le club arrive a Berlin avec des attentes ecrasantes : le Blue Wall s'attend a voir KC se battre pour les playoffs des le premier split. Roster renforce : Bo (ex-Vitality, ex-BLG, reputation mechanique top-tier) et Upset (ex-Fnatic, Worlds multiple). Caliste, deja dans le pipeline, ne peut pas jouer \u2014 la LEC exige 18 ans, il en a 17. Il va dominer la LFL sur KCB en attendant son heure. Sur la scene LEC pourtant, tout s'ecroule : 10e et dernier. Aucun playoff, aucun momentum, les casts francais parlent de \u00ab choc culturel \u00bb. L'apprentissage est brutal et la scene de Berlin, sans pitie.",
    events: [
      "Premier match LEC de l'histoire de KC",
      "Bo & Upset recrutes depuis Vitality et Fnatic",
      "Caliste age-restricted (17 ans) \u2014 domine la LFL sur KCB",
      "\uD83D\uDC94 10e LEC Winter 2024 \u2014 aucun playoff",
    ],
    clipsQuery: "karmine corp lec winter 2024 debut",
    links: [
      {
        label: "LEC Winter 2024 highlights KC",
        url: "https://www.youtube.com/results?search_query=karmine+corp+lec+winter+2024+highlights",
        type: "youtube",
      },
      {
        label: "Annonce roster LEC 2024",
        url: "https://dotesports.com/league-of-legends/news/karmine-corp-kicks-off-lec-era-with-2-lol-signings",
        type: "article",
      },
    ],
  },
  {
    id: "lec-2024-spring",
    period: "Spring 2024",
    phase: "LEC",
    label: "Le Cauchemar",
    subtitle: "L'ere sombre \u00b7 reverse sweep G2 brise",
    color: "#E84057",
    result: "\uD83D\uDC94 10e (dernier)",
    icon: "\uD83D\uDCA5",
    image: "/images/eras/2024-rookie.jpg",
    dateStart: "2024-03-16",
    dateEnd: "2024-05-15",
    roster: "Cabochard (top) \u00b7 Bo (jgl) \u00b7 Saken (mid) \u00b7 Upset (adc) \u00b7 Targamas (sup)",
    coach: "Striker",
    keyMoment:
      "Deuxieme split LEC, meme resultat : 10e et dernier \u2014 deux derniers rangs consecutifs, une premiere pour un club de cette taille. La lueur d'espoir arrive en playoffs : KC bat GIANTX et accroche G2 en BO5. Menes 0-2, KC sort de ses tripes, remonte 2-2 dans une ambiance electrique... puis s'effondre au Game 5. Le reverse sweep reverse \u2014 une cruaute rare, diffusee en prime-time. Kameto, en larmes a la fin du match, publie un message aux fans reconnaissant la profondeur de l'echec. Ce soir-la, tout le monde comprend que le statu quo est fini : la reconstruction doit etre totale, immediate, impitoyable. Cabochard, Bo et Saken seront benches des fins mai.",
    events: [
      "\uD83D\uDC94 2 derniers rangs LEC consecutifs (record negatif du club)",
      "BO5 G2 \u2014 KC remonte 0-2 a 2-2 puis perd Game 5",
      "Kameto public apology \u2014 reconstruction annoncee",
    ],
    clipsQuery: "karmine corp g2 lec spring 2024 bo5",
    links: [
      {
        label: "KC vs G2 LEC Spring 2024 Playoffs",
        url: "https://www.youtube.com/results?search_query=karmine+corp+g2+lec+spring+2024+playoffs+bo5",
        type: "youtube",
      },
    ],
  },
  {
    id: "lec-2024-summer",
    period: "Summer 2024",
    phase: "LEC",
    label: "Le Pari Coreen",
    subtitle: "La fin de l'ere sombre \u00b7 Canna + Vladi",
    color: "#FF9800",
    result: "4e place Summer",
    icon: "\uD83C\uDF1F",
    image: "/images/eras/2024-rookie.jpg",
    dateStart: "2024-06-15",
    dateEnd: "2024-09-08",
    roster: "Canna (top) \u00b7 Closer (jgl) \u00b7 Vladi (mid) \u00b7 Upset (adc) \u00b7 Targamas (sup)",
    coach: "Striker",
    keyMoment:
      "Le 2 mai 2024, KC annonce un remaniement massif qui met un terme a l'ere sombre : Cabochard, Bo et Saken sont benches. Canna (ex-T1, ex-Dplus KIA, champion du monde 2020) arrive \u2014 premier import LCK majeur de l'histoire du club et l'un des plus gros transferts LEC jamais signes par une equipe francaise. Closer (ex-100 Thieves) prend la jungle. Vladi est promu depuis l'academie KCB ou il vient de remporter le LFL Spring. Le resultat est spectaculaire : de dernier a 4e en un seul split. Premier playoff LEC gagne dans l'histoire du club. L'ombre de 2024 n'est pas tout a fait dissipee, mais le renouveau est la \u2014 et il porte deja les graines du Sacre de 2025.",
    events: [
      "Arrivee de Canna (ex-T1)",
      "Closer recrute depuis 100 Thieves",
      "Vladi promu depuis la KCB academie",
      "4e place LEC Summer \u2014 de dernier a 4e en un split",
      "KCX4 Forever Rivals \u2014 30 000 fans, 174K peak stream",
    ],
    clipsQuery: "karmine corp lec summer 2024 canna vladi",
    links: [
      {
        label: "Canna highlights KC 2024",
        url: "https://www.youtube.com/results?search_query=canna+karmine+corp+lec+summer+2024+highlights",
        type: "youtube",
      },
      {
        label: "KCX4 Forever Rivals recap",
        url: "https://www.youtube.com/results?search_query=KCX4+Forever+Rivals+Karmine+Corp+KOI+2024",
        type: "youtube",
      },
      {
        label: "Article \u2014 Signature de Canna (Dotesports)",
        url: "https://dotesports.com/league-of-legends/news/former-t1-top-laner-joins-karmine-corp-for-2024-lec-summer-split",
        type: "article",
      },
    ],
  },
  {
    id: "lec-2025-winter",
    period: "Winter 2025",
    phase: "LEC",
    label: "LE SACRE",
    subtitle: "KC 3-0 G2 \u2014 801K viewers",
    color: "#C8AA6E",
    result: "\uD83C\uDFC6 CHAMPIONS LEC",
    icon: "\uD83C\uDFC6",
    image: "/images/eras/2025-sacre.jpg",
    dateStart: "2025-01-18",
    dateEnd: "2025-03-02",
    roster: "Canna (top) \u00b7 Yike (jgl) \u00b7 Vladi (mid) \u00b7 Caliste (adc) \u00b7 Targamas (sup)",
    coach: "Striker",
    keyMoment:
      "Le moment le plus important de l'histoire de KC. Moins d'un an apres un split a la 10e place (dernier), KC realise la redemption la plus folle de l'histoire de la LEC. Caliste, enfin majeur, rejoint le roster principal. Yike arrive depuis l'ecosysteme G2/MAD. Parcours en bracket : victoire contre Fnatic, puis effondrement en upper bracket final \u2014 G2 stomp KC 3-1. La KC Army tremble. Lower bracket : KC bat Vitality, puis Movistar KOI dans une serie de folie. Retour en Grand Final pour affronter G2 une TROISIEME fois. Puis l'impensable : 3-0 SEC a la Riot Games Arena de Berlin. Vladi est MVP avec un Game 3 Viktor a 10/1/7 \u2014 il demonte Caps en ligne. Yike tue Caps (son ex-coequipier) match apres match. Canna immovable top side. A 18 ans, Caliste devient le plus jeune champion LEC de l'histoire (Royal Roader \u2014 trophee en rookie split). Premiere equipe francaise a remporter la LEC. Premier trophee LEC de l'histoire du club. Emmanuel Macron congratulait KC en 2021 pour les EU Masters \u2014 cette fois, c'est le president qui devrait s'incliner. 801 369 pics de viewers (dont 233 351 sur le co-stream de Kameto).",
    viewership: "801 369 peak \u00b7 Kameto co-stream 233K \u00b7 Record LEC",
    events: [
      "LEC Winter 2025 Finals Berlin \u2014 2 mars 2025",
      "Lower bracket run : FNC \u2192 VIT \u2192 MKOI",
      "Upper bracket final : KC 1-3 G2 (l'effondrement)",
      "Grand Final : KC 3-0 G2 (la redemption absolue)",
      "Vladi MVP \u2014 Game 3 Viktor 10/1/7",
      "Caliste : plus jeune champion LEC de l'histoire (18 ans, Royal Roader)",
      "Premier titre LEC de l'histoire de KC",
      "Premiere equipe francaise championne LEC",
      "De 10e en 2024 a champions en 2025 \u2014 la redemption arc",
    ],
    clipsQuery: "karmine corp g2 lec winter 2025 grand finals",
    links: [
      {
        label: "G2 vs KC \u2014 LEC Winter 2025 Split Final (Official LEC)",
        url: "https://www.youtube.com/watch?v=N9NA4wfvOiY",
        type: "youtube",
      },
      {
        label: "G2 vs KC Highlights ALL GAMES (Kaza)",
        url: "https://www.youtube.com/watch?v=bqBVNEm52A0",
        type: "youtube",
      },
      {
        label: "Finale KC vs G2 \u2014 Full Karmine Corp Replay",
        url: "https://www.youtube.com/watch?v=js_M0Pvxnw0",
        type: "youtube",
      },
      {
        label: "\u00ab WE ARE THE CHAMPIONS ! \u00bb \u2014 KC LEC VoiceComms",
        url: "https://www.youtube.com/watch?v=AelCWTFNOZQ",
        type: "youtube",
      },
      {
        label: "Le discours de Kameto apres la finale",
        url: "https://www.youtube.com/watch?v=VXdc0Q2HdCg",
        type: "youtube",
      },
      {
        label: "Caedrel co-stream LEC Winter Grand Finals",
        url: "https://www.youtube.com/watch?v=J3q06LUN6tY",
        type: "youtube",
      },
      {
        label: "OTP VODs \u2014 KC vs G2 ils sont champions",
        url: "https://www.youtube.com/watch?v=_W8Ga_bLojU",
        type: "youtube",
      },
      {
        label: "Game 3 Highlights \u2014 Loleventvods",
        url: "https://www.youtube.com/watch?v=pMSFp7wku5Y",
        type: "youtube",
      },
      {
        label: "Game 3 Highlights \u2014 EpicSkillshot",
        url: "https://www.youtube.com/watch?v=apoTJw7aV4c",
        type: "youtube",
      },
      {
        label: "G2 VoiceComms \u2014 How it sounds to NOT win LEC",
        url: "https://www.youtube.com/watch?v=dxSmn9_yCj0",
        type: "youtube",
      },
      {
        label: "Recap \u2014 Sheep Esports",
        url: "https://www.sheepesports.com/en/articles/lol-lec-karmine-corp-are-lec-champions-after-clean-sweeping-g2-esports/en",
        type: "article",
      },
      {
        label: "Viewership record \u2014 Escharts",
        url: "https://escharts.com/news/lec-winter-2025-viewership-results",
        type: "article",
      },
    ],
  },
  {
    id: "international-2025-firststand",
    period: "March 2025",
    phase: "International",
    label: "First Stand",
    subtitle: "Seoul \u2014 2e place internationale",
    color: "#0AC8B9",
    result: "2e \u2014 KC 1-3 HLE",
    icon: "\uD83C\uDF0D",
    image: "/images/eras/2025-spring.jpg",
    dateStart: "2025-03-10",
    dateEnd: "2025-03-16",
    roster: "Canna (top) \u00b7 Yike (jgl) \u00b7 Vladi (mid) \u00b7 Caliste (adc) \u00b7 Targamas (sup)",
    coach: "Striker",
    keyMoment:
      "Premier tournoi international de l'histoire du roster LoL de KC. Au LoL Park de Seoul, KC cree l'exploit en battant Top Esports en groupes. En demi-finale vs CTBC Flying Oyster, comeback legendaire de 0-2 a 3-2. En finale, defaite 1-3 vs Hanwha Life Esports. Meilleur resultat international d'une equipe francaise depuis la course aux Worlds de H2K. Prize money : 225 000 $.",
    events: [
      "First Stand 2025 \u2014 LoL Park Seoul",
      "Upset KC vs Top Esports en groupes",
      "Comeback 0-2 a 3-2 vs CTBC Flying Oyster (demi)",
      "Finale KC 1-3 HLE",
      "Meilleur resultat international d'une equipe FR depuis H2K",
    ],
    clipsQuery: "karmine corp first stand 2025 seoul hle",
    links: [
      {
        label: "CFO vs KC Game 1 \u2014 First Stand Semifinals (Loleventvods)",
        url: "https://www.youtube.com/watch?v=U13_8VpxH4M",
        type: "youtube",
      },
      {
        label: "KC vs CFO \u2014 Demi-finale complete (KC Replay)",
        url: "https://www.youtube.com/watch?v=yuXlKZyJEfo",
        type: "youtube",
      },
      {
        label: "OTP VODs \u2014 KC vs CFO un match dans la legende",
        url: "https://www.youtube.com/watch?v=8AJP6HleZh8",
        type: "youtube",
      },
      {
        label: "KC vs HLE \u2014 Finale First Stand (KC Replay)",
        url: "https://www.youtube.com/watch?v=2AhbiChWFPM",
        type: "youtube",
      },
      {
        label: "HLE vs KC Highlights ALL GAMES",
        url: "https://www.youtube.com/watch?v=qZvljnaSNHU",
        type: "youtube",
      },
      {
        label: "OTP VODs \u2014 HLE vs KC une finale pour l'histoire",
        url: "https://www.youtube.com/watch?v=XH4x-Fy4jMU",
        type: "youtube",
      },
      {
        label: "First Stand 2025 (Wikipedia)",
        url: "https://en.wikipedia.org/wiki/2025_First_Stand_Tournament",
        type: "wiki",
      },
    ],
  },
  {
    id: "lec-2025-spring",
    period: "Spring 2025",
    phase: "LEC",
    label: "Le Royaume Caliste",
    subtitle: "Top 1 CS + Gold + Damage",
    color: "#0AC8B9",
    result: "3e playoffs",
    icon: "\uD83D\uDC51",
    image: "/images/eras/2025-spring.jpg",
    dateStart: "2025-04-15",
    dateEnd: "2025-06-15",
    roster: "Canna (top) \u00b7 Yike (jgl) \u00b7 Vladi (mid) \u00b7 Caliste (adc) \u00b7 Targamas (sup)",
    coach: "Striker",
    keyMoment:
      "Saison regular de domination absolue : 8-1. Caliste signe une statistique historique : #1 de la LEC en CS/min, en gold/min ET en damage/min \u2014 aucun ADC n'avait realise ce triple depuis Rekkles en 2021. Il rafle la plupart des MVPs de semaine. En playoffs, defaite cruelle 2-3 vs Movistar KOI en lower bracket final. 3e place malgre tout.",
    events: [
      "Regular season 8-1 \u2014 1er",
      "Caliste #1 en CS/min, gold/min, damage/min (comme Rekkles 2021)",
      "Playoffs : eliminations 2-3 vs MKOI en lower bracket final",
    ],
    clipsQuery: "karmine corp caliste lec spring 2025",
    links: [
      {
        label: "Caliste highlights Spring 2025",
        url: "https://www.youtube.com/results?search_query=Caliste+Karmine+Corp+LEC+Spring+2025+highlights",
        type: "youtube",
      },
      {
        label: "LEC Spring 2025 playoffs",
        url: "https://www.youtube.com/results?search_query=karmine+corp+lec+spring+2025+playoffs",
        type: "youtube",
      },
    ],
  },
  {
    id: "lec-2025-summer",
    period: "Summer 2025",
    phase: "LEC",
    label: "Le Drame",
    subtitle: "Pas de Worlds",
    color: "#E84057",
    result: "\uD83D\uDC94 \u00c9limines par FNC",
    icon: "\uD83D\uDCA5",
    image: "/images/eras/2025-summer.jpg",
    dateStart: "2025-07-01",
    dateEnd: "2025-09-26",
    roster: "Canna (top) \u00b7 Yike (jgl) \u00b7 Vladi (mid) \u00b7 Caliste (adc) \u00b7 Targamas (sup)",
    coach: "Striker",
    keyMoment:
      "En playoffs, KC bat Vitality 3-1. Perd vs G2 en upper bracket. Dans le lower bracket, la rencontre fatidique : FNATIC 3-1 KC. Oscarinin detruit Canna en top lane sur les 4 games. La foule de Madrid assiste a l'elimination. PAS DE WORLDS pour les champions d'hiver. Seule consolation : Caliste est nomme LEC Rookie of the Year 2025 (28/38 votes, 60,6% WR, 5.4 KDA, 9.8 CS/min, 739.5 damage/min).",
    events: [
      "KC 3-1 Vitality (playoffs)",
      "Fnatic 3-1 KC \u2014 elimination Worlds",
      "PAS DE WORLDS 2025",
      "Caliste : LEC Rookie of the Year 2025",
    ],
    clipsQuery: "karmine corp fnatic lec summer 2025 playoffs",
    links: [
      {
        label: "KC Caliste \u2014 2025 LEC Rookie of the Year (Official)",
        url: "https://www.youtube.com/watch?v=a953ZreZp8A",
        type: "youtube",
      },
      {
        label: "Top 10 Caliste Plays \u2014 Best of 2025 (GWP)",
        url: "https://www.youtube.com/watch?v=EfN64vP2n2o",
        type: "youtube",
      },
      {
        label: "FNC 3-1 KC \u2014 recherche elimination",
        url: "https://www.youtube.com/results?search_query=LEC+Summer+2025+Fnatic+Karmine+Corp+playoffs+Oscarinin",
        type: "youtube",
      },
      {
        label: "Kameto reaction elimination",
        url: "https://www.youtube.com/results?search_query=kameto+reaction+karmine+corp+fnatic+worlds+2025",
        type: "youtube",
      },
      {
        label: "Caliste ROY 2025 (Sheep Esports)",
        url: "https://www.sheepesports.com/en/articles/lol-lec-caliste-named-2025-rookie-of-the-year/en",
        type: "article",
      },
    ],
  },
  {
    id: "lec-2026-versus",
    period: "Versus 2026",
    phase: "LEC",
    label: "Le Renouveau",
    subtitle: "kyeahoo + Busio + Reapered",
    color: "#0057FF",
    result: "Finalistes \u00b7 KC 2-3 G2",
    icon: "\u26A1",
    image: "/images/eras/2026-versus.jpg",
    dateStart: "2026-01-12",
    dateEnd: "2026-03-08",
    roster: "Canna (top) \u00b7 Yike (jgl) \u00b7 kyeahoo (mid) \u00b7 Caliste (adc) \u00b7 Busio (sup)",
    coach: "Reapered (Bok Han-gyu)",
    keyMoment:
      "Gros remaniement intersaison : Vladi rejoint Fnatic, kyeahoo (ex-DRX Challengers, KR) arrive au mid. Targamas part vers French Flair, remplace par Busio (ex-FlyQuest, vet Worlds 2024-2025, US/PL). Nouveau coach : Reapered (ex-C9, ex-100T), premiere experience EMEA, contrat jusqu'au lendemain de Worlds 2027. Parcours : perte UB vs G2 1-3, victoire 2-1 vs Vitality, sweep GIANTX 3-0, victoire 3-2 vs MKOI en lower bracket final (epique), defaite 2-3 vs G2 en grande finale a Barcelone. Caps MVP.",
    events: [
      "Intersaison 2025-26 : Vladi \u2192 FNC, kyeahoo (KR) \u2192 mid",
      "Targamas \u2192 French Flair, Busio (ex-FlyQuest) \u2192 support",
      "Reapered nomme head coach (contrat jusqu'a Worlds 2027)",
      "LEC Versus Finals Barcelona \u2014 KC 2-3 G2",
    ],
    clipsQuery: "karmine corp g2 lec versus 2026",
    links: [
      {
        label: "Finale Game 1 (LEC Official)",
        url: "https://www.youtube.com/watch?v=qHAn7zWJE_Q",
        type: "youtube",
      },
      {
        label: "Finale Game 3 (LEC Official)",
        url: "https://www.youtube.com/watch?v=0pBxCGvx6xU",
        type: "youtube",
      },
      {
        label: "Finale Game 5 (LEC Official)",
        url: "https://www.youtube.com/watch?v=02qq94BQoPY",
        type: "youtube",
      },
      {
        label: "All Games Highlights (LEC)",
        url: "https://www.youtube.com/watch?v=9aM1SIsGWDk",
        type: "youtube",
      },
      {
        label: "All Games Highlights (Kaza)",
        url: "https://www.youtube.com/watch?v=42lv5jASq9I",
        type: "youtube",
      },
      {
        label: "Caedrel co-stream \u2014 Legendary LEC Finals",
        url: "https://www.youtube.com/watch?v=ed9u6RRmZgk",
        type: "youtube",
      },
      {
        label: "OTP VODs \u2014 Une des meilleures finales LEC",
        url: "https://www.youtube.com/watch?v=XxnW57M0l5o",
        type: "youtube",
      },
      {
        label: "LEC full broadcast (7h22)",
        url: "https://www.youtube.com/watch?v=JIw6VIycNto",
        type: "youtube",
      },
      {
        label: "KC vs GIANTX 3-0 Playoffs",
        url: "https://www.youtube.com/watch?v=3OqPWoZTKFI",
        type: "youtube",
      },
      {
        label: "Article \u2014 Reapered signe (Sheep)",
        url: "https://www.sheepesports.com/en/articles/sources-reapered-set-to-join-karmine-corp-as-head-coach-for-the-2026-season/en",
        type: "article",
      },
    ],
  },
  {
    id: "lec-2026-spring",
    period: "Spring 2026",
    phase: "LEC",
    label: "En Cours",
    subtitle: "Objectif MSI",
    color: "#C8AA6E",
    result: "Spring en cours \uD83D\uDD25",
    icon: "\uD83D\uDD25",
    image: "/images/hero-bg.jpg",
    dateStart: "2026-03-15",
    dateEnd: "2026-06-30",
    roster: "Canna (top) \u00b7 Yike (jgl) \u00b7 kyeahoo (mid) \u00b7 Caliste (adc) \u00b7 Busio (sup)",
    coach: "Reapered",
    keyMoment:
      "KC demarre Spring en force : record 8-3 en regular season, 1re place. Caliste continue d'etre monstrueux (5.1K / 1.1D / 4.9A, 80% WR, 11.3 CS/min). Duree moyenne des games : 33:33. En 267 matchs KC depuis ses debuts LFL en 2021, le club affiche 172 victoires et un winrate carriere de 64.4%. Objectif : MSI 2026.",
    clipsQuery: "karmine corp lec spring 2026",
    links: [
      {
        label: "KC vs VIT Highlights \u2014 LEC Spring Week 1 Day 1 (LEC Official)",
        url: "https://www.youtube.com/watch?v=M7xaenPvPU4",
        type: "youtube",
      },
      {
        label: "Caliste highlights Spring 2026 (recherche)",
        url: "https://www.youtube.com/results?search_query=caliste+karmine+corp+lec+spring+2026",
        type: "youtube",
      },
      {
        label: "Caliste highlights Spring 2026",
        url: "https://www.youtube.com/results?search_query=caliste+karmine+corp+lec+spring+2026",
        type: "youtube",
      },
      {
        label: "Liquipedia Spring 2026",
        url: "https://liquipedia.net/leagueoflegends/LEC/2026/Spring",
        type: "wiki",
      },
    ],
  },
];

export function getEraById(id: string): Era | undefined {
  return ERAS.find((e) => e.id === id);
}

export function getErasSortedByDate(): Era[] {
  return [...ERAS].sort((a, b) => a.dateStart.localeCompare(b.dateStart));
}
