/**
 * Visitor names — deterministic aristocratic alias generator for the
 * Registre des Membres (Room VI of the Antre).
 *
 * Input  : a 32-hex-char session hash (bcc-<hex32>) from getBCCSessionHash().
 * Output : a stable, vaguely-18th-century French alias, e.g.
 *          "Le Baron de Pizzaland" / "Madame du 11ème" / "Lord BCC #4216".
 *
 * Constraints :
 *   • DETERMINISTIC — same hash → same alias every render. We hash the
 *     hex using a tiny FNV-1a 32 mixer (no crypto, no fetch).
 *   • CULTURE-SAFE — no real-person impersonation, no slurs. The dictionary
 *     mixes 18th-century French titles with absurd BCC in-jokes (Pizzaland,
 *     Ahou Ahou, Kameto, the 11th arrondissement of Paris where the KC
 *     gaming-house famously isn't, etc.). Targeted humor, gentle, opt-in.
 *
 * The function is pure : safe to call during SSR (returns a deterministic
 * alias based on the SSR placeholder hash). The cave's Room VI re-renders
 * client-side on first effect with the user's real session hash anyway.
 */

const TITLES = [
  "Le Baron",
  "La Baronne",
  "Le Comte",
  "La Comtesse",
  "Le Marquis",
  "La Marquise",
  "Le Vicomte",
  "Le Chevalier",
  "Madame",
  "Monsieur",
  "Lord",
  "Lady",
  "Maître",
  "Le Duc",
  "L'Abbé",
];

// Particles : "de", "de la", "du", "des" — fudges the grammar but reads
// charmingly antique in the registre.
const PARTICLES = ["de", "de la", "du", "des", "von", "de von"];

const PLACES = [
  "Pizzaland",
  "Bronze-sur-Lane",
  "Roubaix",
  "Saint-Étouvirage",
  "Mont d'Ahou",
  "Faille de l'Invocateur",
  "Sololane",
  "Berlin-Tegel",
  "Versailles-bot",
  "la Faille",
  "Cantal",
  "Bois de Rift",
  "Saint-Cloud Drake",
  "Vaugirard",
  "le 11ᵉ",
  "Ménilmont-Bouclier",
  "Trifirage",
  "Sentinelle-sur-Mer",
  "Carcassonne-Top",
  "Aubervilliers-Mid",
  "Pantin-Jungle",
  "Wassuverre",
  "Belleville-Drake",
  "Anjou-Tilteur",
];

const EPITHETS = [
  "le Téméraire",
  "le Sage",
  "l'Ahou Ahou",
  "le Tilté",
  "le Patient",
  "le Magnanime",
  "le Mécontent",
  "le Goldfunneur",
  "l'Insondable",
  "le Lecteur",
  "le Stark",
  "l'Invocateur",
  "le Bronze Éternel",
  "le Galant",
  "le Sceptique",
  "le Pieux",
  "la Foudre",
];

const NUMERIC_TITLES = [
  "BCC",
  "Officier de la BCC",
  "Membre fondateur",
  "Sénéchal de la BCC",
  "Doyen de Pizzaland",
];

/** Tiny FNV-1a 32-bit mixer — cheap, deterministic, no crypto needed. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    // 32-bit Math.imul wrap
    h = Math.imul(h, 0x01000193);
  }
  // unsigned
  return h >>> 0;
}

/** Pick deterministically from an array using a salted hash. */
function pick<T>(arr: T[], hash: string, salt: string): T {
  return arr[fnv1a(hash + ":" + salt) % arr.length];
}

/**
 * Generate the aristocratic alias for a given BCC session hash.
 *
 * 70% of the time : "<Title> <Particle> <Place>"
 * 20%             : "<Title> <Particle> <Place>, <Epithet>"
 * 10%             : "<NumericTitle> #<4-digit number>"
 *
 * The split is determined by `mod 10` of the hash so two different users
 * get different shapes — keeps the registre visually varied.
 */
export function visitorNameFromHash(hash: string): string {
  const variant = fnv1a(hash + ":shape") % 10;
  if (variant < 1) {
    // numeric variant — homage to "BCC #4216"
    const title = pick(NUMERIC_TITLES, hash, "ntitle");
    const num = fnv1a(hash + ":num") % 9000 + 1000; // 1000-9999
    return `${title} #${num}`;
  }
  const title = pick(TITLES, hash, "title");
  const particle = pick(PARTICLES, hash, "particle");
  const place = pick(PLACES, hash, "place");
  if (variant < 3) {
    const epithet = pick(EPITHETS, hash, "epithet");
    return `${title} ${particle} ${place}, ${epithet}`;
  }
  return `${title} ${particle} ${place}`;
}

/**
 * Generate a small fixed seed of "past visitors" for the guestbook — used
 * to populate the registre before the user's own entry. These are
 * deterministic (seeded by a constant) so the page looks alive on the
 * first render and the order stays stable across navigations.
 */
export function seedVisitors(count = 18): Array<{ name: string; key: string }> {
  // A handful of canonical session-hash-like seeds. Mixing 0-9 and a-f.
  const seeds = [
    "bcc-7f3a9c2b1e8d4f0a6c5e3b7d8a2f9c1b",
    "bcc-2e4b8c9d1a3f5e7b9c1d3e5f7a9b1c3d",
    "bcc-9d7e5c3a1f8b6d4e2c0a8f6e4d2c0a8f",
    "bcc-4c8e2a6f0b4d8e2c6a0f4b8d2e6c0a4f",
    "bcc-1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b",
    "bcc-8f6d4b2c0e8a6f4d2b0c8e6a4f2d0b8e",
    "bcc-3e1c9b7d5f3a1e9c7b5d3f1a9e7c5b3d",
    "bcc-6a4c2e0d8f6b4a2c0e8d6f4b2a0c8e6d",
    "bcc-c5a3e1b9d7f5c3a1e9b7d5f3c1a9e7b5",
    "bcc-2f0d8b6a4c2e0f8d6b4a2c0e8f6d4b2a",
    "bcc-7c5a3e1b9d7f5c3a1e9b7d5f3c1a9e7b",
    "bcc-d3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3",
    "bcc-0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a",
    "bcc-5e7c9a1d3f5b7e9c1a3d5f7b9e1c3a5d",
    "bcc-a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1",
    "bcc-8d6b4f2a0c8e6d4b2f0a8c6e4d2b0f8a",
    "bcc-4b2d0f8e6c4a2d0f8b6e4c2a0d8f6b4e",
    "bcc-f1d3b5a7c9e1f3d5b7a9c1e3f5d7b9a1",
  ];
  return seeds.slice(0, count).map((s, i) => ({
    name: visitorNameFromHash(s),
    key: `seed-${i}`,
  }));
}
