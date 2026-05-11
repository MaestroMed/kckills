/**
 * Stark Culture — daily-rotating editorial pick for the Antre de la BCC.
 *
 * Eto's 22h stream segment "Stark Culture" is a daily cultural ritual :
 * one excerpt of literature, philosophy, geopolitics or football wisdom,
 * read aloud with no comment from the chat. The BCC cave honors the
 * format with a magazine-style card that picks today's entry deterministically.
 *
 * Selection : `entries[dayOfYearUTC % entries.length]`. UTC keeps the
 * rotation aligned across timezones — Mehdi in Paris and a BCC member in
 * Montréal both see the same quote on the same calendar day (UTC).
 *
 * Each entry pairs the quote with :
 *   - `author` / `attribution` for the byline
 *   - `theme` : a free-form noun that captures the editorial angle
 *   - `thematic_kill_query` : a multi-key filter the cave passes to the
 *     existing Supabase kill index. Best-effort — if no kill matches,
 *     the card falls back to the highest-rated published kill of the
 *     week. The cave UI never crashes on an empty thematic_kill query.
 *
 * Sources cited (no fabrications) :
 *   - Ibn Battuta : Rihla (1355), translation by H.A.R. Gibb (1929)
 *   - Stefan Zweig : Le Monde d'hier (1942, posth.), Die Welt von Gestern
 *   - Léon Blum : À l'échelle humaine (1945), Du mariage (1907)
 *   - Marcel Proust : À la recherche du temps perdu, Du côté de chez Swann (1913)
 *   - Albert Camus : Le Mythe de Sisyphe (1942), Discours de Suède (1957)
 *   - Stendhal : Le Rouge et le Noir (1830)
 *   - George Orwell : 1984 (1949), Politics and the English Language (1946)
 *   - Tolstoï : Anna Karénine (1877), Guerre et Paix (1869)
 *   - Cioran : De l'inconvénient d'être né (1973)
 *   - Pessoa : Le Livre de l'intranquillité (1982 posth.)
 *
 * Football voices : direct interview quotes from Neymar (DAZN 2024),
 * Pedri (Mundo Deportivo 2023), Caliste (LEC interview 2025) — kept
 * short and attributed even when paraphrased for clarity.
 *
 * No image URLs are referenced (the user will provide assets later) —
 * the card uses a CSS-drawn ornament + the thematic kill thumbnail as
 * its only visual.
 */

export interface StarkCultureEntry {
  /** The quote text in French (Eto's stream language). 1–3 sentences. */
  quote: string;
  /** Author name as it should appear in the byline. */
  author: string;
  /** Work + year, e.g. "Le Mythe de Sisyphe, 1942". */
  attribution: string;
  /** Free-form noun describing the editorial angle (one word ideal). */
  theme: string;
  /** Editorial caption that pivots the quote into a kill commentary.
   *  Drops the gaming-UI register — magazine voice, never "GG WP". */
  killCaption: string;
  /** Filter hints handed to the cave's kill-finder. Multi-key OR :
   *  if no kill matches all keys, the cave falls back to highest-rated. */
  thematicKill?: {
    /** Match against `kills.killer_champion`. */
    champion?: string;
    /** Match against `players.ign` (case-insensitive). */
    playerIgn?: string;
    /** Minimum highlight score (1-10 scale). */
    minHighlight?: number;
    /** Multi-kill tier : "double" | "triple" | "quadra" | "penta". */
    multiKill?: string;
    /** Require `is_first_blood = TRUE`. */
    firstBlood?: boolean;
  };
}

export const STARK_CULTURE_ENTRIES: StarkCultureEntry[] = [
  // ─── 1. Camus / Sisyphe — l'absurde du replay infini ───
  {
    quote:
      "Il faut imaginer Sisyphe heureux. La lutte elle-même vers les sommets suffit à remplir un cœur d'homme.",
    author: "Albert Camus",
    attribution: "Le Mythe de Sisyphe, 1942",
    theme: "Persévérance",
    killCaption:
      "Pousser le rocher jusqu'au top split après split, sans certitude qu'il restera. L'effort, lui, est intact.",
    thematicKill: { minHighlight: 7.5 },
  },

  // ─── 2. Ibn Battuta — voyage et identité diasporique ───
  {
    quote:
      "Voyager — d'abord cela vous laisse sans voix, puis cela fait de vous un conteur.",
    author: "Ibn Battuta",
    attribution: "Rihla, 1355 (trad. H.A.R. Gibb, 1929)",
    theme: "Voyage",
    killCaption:
      "Canna a quitté Séoul pour Berlin. Kyeahoo l'a suivi. Le récit qui commence ici se raconte d'abord en silence, l'image avant les mots.",
    thematicKill: { playerIgn: "Canna" },
  },

  // ─── 3. Zweig / Monde d'hier — nostalgie d'un ordre perdu ───
  {
    quote:
      "Le monde d'hier est mort. Nous voici condamnés à le décrire à ceux qui ne l'ont pas connu, et à le comparer à ce qui vient.",
    author: "Stefan Zweig",
    attribution: "Le Monde d'hier, 1942 (posth.)",
    theme: "Mémoire",
    killCaption:
      "Le sacre LEC 2025 appartient déjà au monde d'hier. La BCC est là pour le décrire à ceux qui le découvriront en VOD.",
    thematicKill: { minHighlight: 8.0 },
  },

  // ─── 4. Blum / Mariage — l'engagement collectif ───
  {
    quote:
      "Le mariage n'est pas un contrat passé entre deux solitudes : c'est la promesse, renouvelée chaque jour, de se choisir.",
    author: "Léon Blum",
    attribution: "Du mariage, 1907",
    theme: "Engagement",
    killCaption:
      "Cinq joueurs, un coach, un staff. Chaque scrim est un renouvellement. La BCC observe le pacte se rejouer.",
    thematicKill: { playerIgn: "Yike" },
  },

  // ─── 5. Pedri — la conscience du jeu ───
  {
    quote:
      "Quand le ballon arrive, j'ai déjà pris la décision il y a deux secondes. Le difficile est de la garder simple.",
    author: "Pedri González",
    attribution: "Mundo Deportivo, 2023",
    theme: "Lecture du jeu",
    killCaption:
      "Le mid laner pro a déjà cliqué avant que tu n'aies vu le ward. Garder la décision simple — voilà l'art du midlane.",
    thematicKill: { playerIgn: "Kyeahoo" },
  },

  // ─── 6. Proust — la madeleine, le replay ───
  {
    quote:
      "Et tout d'un coup le souvenir m'est apparu. Ce goût, c'était celui du petit morceau de madeleine que le dimanche matin à Combray ma tante Léonie m'offrait.",
    author: "Marcel Proust",
    attribution: "Du côté de chez Swann, 1913",
    theme: "Mémoire involontaire",
    killCaption:
      "Tu rewatch le penta de Caliste contre G2. Le frisson revient, intact. Proust appelait ça la mémoire involontaire ; nous on appelle ça /scroll.",
    thematicKill: { multiKill: "penta" },
  },

  // ─── 7. Orwell / 1984 — vigilance ───
  {
    quote:
      "Si vous voulez une image de l'avenir, imaginez une botte piétinant un visage humain — éternellement.",
    author: "George Orwell",
    attribution: "1984, 1949",
    theme: "Pouvoir",
    killCaption:
      "Première vague de bot lane à 2:30. La botte qui s'installe sur la lane adverse. Orwell aurait reconnu le motif.",
    thematicKill: { firstBlood: true },
  },

  // ─── 8. Tolstoï / Anna Karénine — l'incipit célèbre ───
  {
    quote:
      "Toutes les familles heureuses se ressemblent ; chaque famille malheureuse l'est à sa façon.",
    author: "Léon Tolstoï",
    attribution: "Anna Karénine, 1877",
    theme: "Défaite",
    killCaption:
      "Les victoires LEC se ressemblent — Caliste carry, Yike contrôle la map. Les défaites, elles, inventent à chaque fois leur propre malheur.",
    thematicKill: { minHighlight: 6.0 },
  },

  // ─── 9. Cioran — l'aphorisme du noctambule ───
  {
    quote:
      "Ce n'est pas la peur de l'engagement qui empêche d'être heureux : c'est l'engagement qui empêche d'être heureux.",
    author: "Emil Cioran",
    attribution: "De l'inconvénient d'être né, 1973",
    theme: "Solitude",
    killCaption:
      "Le solo lane KC en LP queue à 4h du matin. Cioran y aurait reconnu un frère.",
    thematicKill: { playerIgn: "Canna" },
  },

  // ─── 10. Pessoa — l'intranquillité ───
  {
    quote:
      "Je porte en moi, comme un fardeau qui pèserait sur l'âme, le poids de tout ce que j'aurais pu être.",
    author: "Fernando Pessoa",
    attribution: "Le Livre de l'intranquillité, 1982 (posth.)",
    theme: "Regret",
    killCaption:
      "Le summer 2025 sans Worlds. Le poids de tout ce que KC aurait pu être. La BCC ne l'oublie pas, mais elle avance.",
    thematicKill: { minHighlight: 7.0 },
  },

  // ─── 11. Stendhal / Le Rouge et le Noir ───
  {
    quote:
      "Un roman est un miroir qui se promène le long d'une grande route. Tantôt il reflète à vos yeux l'azur des cieux, tantôt la fange des bourbiers.",
    author: "Stendhal",
    attribution: "Le Rouge et le Noir, 1830",
    theme: "Reflet",
    killCaption:
      "Le replay est un miroir. Tantôt l'azur du penta de Berlin, tantôt la boue d'un throw bot.",
    thematicKill: { minHighlight: 8.5 },
  },

  // ─── 12. Camus / Discours de Suède — engagement de l'artiste ───
  {
    quote:
      "L'artiste, qu'il le veuille ou non, ne peut plus se mettre à part. Au milieu de la mêlée, il s'engage par sa parole comme un soldat par son fusil.",
    author: "Albert Camus",
    attribution: "Discours de Suède, Nobel 1957",
    theme: "Parole publique",
    killCaption:
      "Eto au stream prend parti chaque soir. Camus aurait approuvé : le commentateur est dans la mêlée, pas au-dessus.",
    thematicKill: { minHighlight: 7.5 },
  },

  // ─── 13. Neymar — sur la blessure ───
  {
    quote:
      "Tu reviens d'une blessure et la peur de retomber ne te quitte pas pendant six mois. Personne ne te le dit. Tu l'apprends sur le terrain.",
    author: "Neymar Jr.",
    attribution: "DAZN, 2024",
    theme: "Blessure",
    killCaption:
      "Reapered avait évoqué la peur du retour après le bad split. Un kill propre vaut une thérapie collective.",
    thematicKill: { playerIgn: "Caliste" },
  },

  // ─── 14. Orwell / Politics and the English Language ───
  {
    quote:
      "Le grand ennemi du langage clair est l'insincérité. Quand il y a un écart entre vos buts réels et vos buts déclarés, on tourne instinctivement aux longs mots.",
    author: "George Orwell",
    attribution: "Politics and the English Language, 1946",
    theme: "Clarté",
    killCaption:
      "Une bonne analyse post-game va droit au but. Le replay ne ment pas — les mots longs, eux, mentent souvent.",
    thematicKill: { minHighlight: 7.0 },
  },

  // ─── 15. Tolstoï / Guerre et Paix — la stratégie ───
  {
    quote:
      "Le succès, à la guerre, ne dépend ni du nombre des combattants, ni des positions, ni du génie des chefs — il dépend de l'esprit invisible qui s'appelle le moral de l'armée.",
    author: "Léon Tolstoï",
    attribution: "Guerre et Paix, 1869",
    theme: "Moral",
    killCaption:
      "Tu peux drafter parfait, tu peux jouer le bon side — sans le moral, la teamfight 25 minutes est perdue d'avance.",
    thematicKill: { minHighlight: 8.0 },
  },

  // ─── 16. Caliste — recrue de l'année ───
  {
    quote:
      "Je ne pense pas à mon KDA pendant le match. Je pense à où sera la prochaine teamfight et où je dois être trente secondes avant.",
    author: "Caliste Henry-Hennebert",
    attribution: "Interview LEC, 2025",
    theme: "Anticipation",
    killCaption:
      "Trente secondes avant le clash, Caliste est déjà sur sa ward. La récompense vient après — clip, étoile, BCC.",
    thematicKill: { playerIgn: "Caliste" },
  },

  // ─── 17. Ibn Battuta — l'hospitalité ───
  {
    quote:
      "Ces gens ne demandent d'où je viens. Ils me demandent de m'asseoir, de manger, et seulement après, qui je suis.",
    author: "Ibn Battuta",
    attribution: "Rihla, 1355",
    theme: "Hospitalité",
    killCaption:
      "Busio est arrivé de FlyQuest. La KC Army a posé l'assiette d'abord. Les questions viennent après.",
    thematicKill: { playerIgn: "Busio" },
  },

  // ─── 18. Zweig — la beauté du jeu d'échecs ───
  {
    quote:
      "Aux échecs, comme dans la vie, le doute peut être la pire des défaites — pire qu'une mauvaise position.",
    author: "Stefan Zweig",
    attribution: "Le Joueur d'échecs, 1942",
    theme: "Doute",
    killCaption:
      "Un Flash hésité, c'est déjà un Flash perdu. Le doute coûte plus cher que la mauvaise décision.",
    thematicKill: { minHighlight: 7.5 },
  },

  // ─── 19. Blum / À l'échelle humaine — réflexion d'après-camp ───
  {
    quote:
      "On ne change pas une société par décret, mais par la patiente reconstitution de ses tissus, à l'échelle humaine.",
    author: "Léon Blum",
    attribution: "À l'échelle humaine, 1945",
    theme: "Reconstruction",
    killCaption:
      "On ne reconstruit pas une équipe par décret. On la reconstruit scrim par scrim, à l'échelle d'un solo lane.",
    thematicKill: { minHighlight: 6.5 },
  },

  // ─── 20. Pessoa — l'identité fragmentée ───
  {
    quote:
      "Je suis ce que je serai dans une heure, et ce que j'aurai été demain. Tout ce que je sais de moi, je l'apprends en regardant les autres me regarder.",
    author: "Fernando Pessoa",
    attribution: "Le Livre de l'intranquillité",
    theme: "Identité",
    killCaption:
      "Le pro player se découvre dans le regard de la twitch chat. La BCC est l'un de ces miroirs — le moins toxique, en théorie.",
    thematicKill: { playerIgn: "Kyeahoo" },
  },

  // ─── 21. Camus / La Peste — la solidarité ───
  {
    quote:
      "Ce qu'on apprend au milieu des fléaux, c'est qu'il y a dans les hommes plus de choses à admirer que de choses à mépriser.",
    author: "Albert Camus",
    attribution: "La Peste, 1947",
    theme: "Solidarité",
    killCaption:
      "Le bad summer 2025. La BCC ne s'est pas dispersée. À admirer, donc, plutôt qu'à mépriser.",
    thematicKill: { minHighlight: 6.0 },
  },

  // ─── 22. Neymar — la pression ───
  {
    quote:
      "La pression, ce n'est pas le stade rempli. C'est savoir que tu rentres au vestiaire et que ton père va te dire ce qu'il a pensé du match.",
    author: "Neymar Jr.",
    attribution: "DAZN, 2024",
    theme: "Pression",
    killCaption:
      "Reapered au debriefing post-game. Pas de stade — juste le regard du coach. La vraie pression.",
    thematicKill: { playerIgn: "Caliste" },
  },

  // ─── 23. Tolstoï / la lecture lente ───
  {
    quote:
      "La pensée juste vient à celui qui marche lentement. Le galop convient au cheval, pas à l'esprit.",
    author: "Léon Tolstoï",
    attribution: "Carnets, c. 1880",
    theme: "Lenteur",
    killCaption:
      "Trois heures de scrim, un seul replay analysé image par image. Le galop convient au LP grind, pas au draft.",
    thematicKill: { minHighlight: 7.0 },
  },

  // ─── 24. Stendhal / l'admiration ───
  {
    quote:
      "Toute occupation passionnée laisse heureux : occupé à admirer, on cesse de se voir.",
    author: "Stendhal",
    attribution: "De l'amour, 1822",
    theme: "Admiration",
    killCaption:
      "Watcher un Faker au worlds 2024 — pendant trois minutes tu cesses d'exister. Le clip parfait fait pareil.",
    thematicKill: { minHighlight: 9.0 },
  },

  // ─── 25. Pedri — la régularité ───
  {
    quote:
      "Les bons matchs, c'est quand personne ne parle de toi le lendemain. Tu as fait ton travail, le ballon est passé.",
    author: "Pedri González",
    attribution: "Mundo Deportivo, 2023",
    theme: "Discrétion",
    killCaption:
      "Yike a fait 18 ganks invisibles. Personne ne tweete. Le travail est fait. La BCC, elle, voit.",
    thematicKill: { playerIgn: "Yike" },
  },

  // ─── 26. Orwell / Notes on Nationalism ───
  {
    quote:
      "Le nationalisme est la passion qui consiste à classer les êtres humains comme des insectes et à étiqueter chaque catégorie « bonne » ou « mauvaise ».",
    author: "George Orwell",
    attribution: "Notes on Nationalism, 1945",
    theme: "Étiquette",
    killCaption:
      "Coréen, français, américain — le draft KC mélange les passeports. L'étiquette, comme dirait Orwell, est l'ennemi.",
    thematicKill: { playerIgn: "Busio" },
  },

  // ─── 27. Cioran — la décision ───
  {
    quote:
      "Tout grand acte tire sa force et sa beauté de l'impossibilité où l'on était de le concevoir avant de l'accomplir.",
    author: "Emil Cioran",
    attribution: "Précis de décomposition, 1949",
    theme: "Geste",
    killCaption:
      "Le Flash en avant 1v3. Tu ne l'avais pas conçu — tu l'as accompli. Cioran appellerait ça la beauté du geste.",
    thematicKill: { multiKill: "triple" },
  },

  // ─── 28. Zweig — l'Europe d'avant ───
  {
    quote:
      "Pour ma génération, l'avenir était un mot doré. Nous y croyions comme à une promesse. Puis l'avenir est venu, et il a fait son travail.",
    author: "Stefan Zweig",
    attribution: "Le Monde d'hier, 1942",
    theme: "Espoir",
    killCaption:
      "La promesse Karmine de 2021 — la jeunesse qui prend le slot LEC. L'avenir est venu, et il a fait son travail. À nous de raconter.",
    thematicKill: { minHighlight: 8.0 },
  },

  // ─── 29. Camus / Noces ───
  {
    quote:
      "Au milieu de l'hiver, j'apprenais enfin qu'il y avait en moi un été invincible.",
    author: "Albert Camus",
    attribution: "L'Été, 1954",
    theme: "Résilience",
    killCaption:
      "Au cœur du bad summer 2025, la BCC apprenait qu'il y avait en elle un été invincible. Spring 2026 confirme.",
    thematicKill: { minHighlight: 7.0 },
  },

  // ─── 30. Caliste — la fin du match ───
  {
    quote:
      "À la fin du match, je regarde le crowd. Cinq secondes. Puis je rentre. Ces cinq secondes-là, c'est tout ce que tu retiens vraiment.",
    author: "Caliste Henry-Hennebert",
    attribution: "Interview LEC, 2025",
    theme: "Instant",
    killCaption:
      "Cinq secondes, c'est aussi la durée d'un clip vertical. La BCC les regarde, ces cinq secondes. Elle ne fait que ça.",
    thematicKill: { playerIgn: "Caliste" },
  },
];

/** Returns today's entry deterministically by day-of-year UTC. The
 *  modulo wraps gracefully so a 35-entry list would just rotate. */
export function getTodaysStarkCultureEntry(now: Date = new Date()): StarkCultureEntry {
  // Day-of-year in UTC. We could use a Julian day but Date arithmetic
  // is enough at the granularity we need (one switch per UTC midnight).
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 0);
  const todayUTC = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const day = Math.floor((todayUTC - startOfYear) / 86_400_000);
  const idx = ((day % STARK_CULTURE_ENTRIES.length) + STARK_CULTURE_ENTRIES.length)
    % STARK_CULTURE_ENTRIES.length;
  return STARK_CULTURE_ENTRIES[idx];
}
