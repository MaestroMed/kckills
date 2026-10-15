/**
 * Équipes du Mondial 2026 — généré par scripts/team-brands.py (ne pas éditer à la main).
 * Logos : API lolesports getTeams, copiés dans public/images/teams/. Couleurs d'étendard :
 * couleur dominante saturée du logo (logo monochrome → drap noir, fil argent).
 * Liste : Wikipédia « 2026 League of Legends World Championship », lue le 15/10/2026.
 */

export interface TeamBrand {
  code: string;
  name: string;
  region: string;
  /** Phase de départ au Mondial 2026. */
  phase: string;
  /** Logo local (même origine : peint dans la broderie de l'étendard). */
  logo: string;
  fabricA: number;
  fabricB: number;
  sheen: number;
  glow: number;
  thread: "gold" | "silver";
}

export const WORLDS_2026_TEAMS: readonly TeamBrand[] = [
  { code: "KC", name: "Karmine Corp", region: "LEC", phase: "Play-ins", logo: "/images/teams/KC.png", fabricA: 0x005861, fabricB: 0x00bed1, sheen: 0x73f2ff, glow: 0x00e8ff, thread: "gold" },
  { code: "C9", name: "Cloud9", region: "LCS", phase: "Play-ins", logo: "/images/teams/C9.png", fabricA: 0x00435b, fabricB: 0x0090c5, sheen: 0x73d3f7, glow: 0x00aff1, thread: "gold" },
  { code: "MVK", name: "MVK Esports", region: "LCP", phase: "Play-ins", logo: "/images/teams/MVK.png", fabricA: 0x0d0f14, fabricB: 0x262a33, sheen: 0x9aa3b5, glow: 0xc9d2e6, thread: "silver" },
  { code: "FUR", name: "FURIA", region: "CBLOL", phase: "Play-ins", logo: "/images/teams/FUR.png", fabricA: 0x0d0f14, fabricB: 0x262a33, sheen: 0x9aa3b5, glow: 0xc9d2e6, thread: "silver" },
  { code: "GEN", name: "Gen.G", region: "LCK", phase: "Système suisse", logo: "/images/teams/GEN.png", fabricA: 0x47381a, fabricB: 0x9a7937, sheen: 0xdac498, glow: 0xbc9443, thread: "silver" },
  { code: "HLE", name: "Hanwha Life Esports", region: "LCK", phase: "Système suisse", logo: "/images/teams/HLE.png", fabricA: 0x5d2704, fabricB: 0xc95308, sheen: 0xfaab78, glow: 0xf5660a, thread: "gold" },
  { code: "T1", name: "T1", region: "LCK", phase: "Système suisse", logo: "/images/teams/T1.png", fabricA: 0x570010, fabricB: 0xbc0023, sheen: 0xf1738a, glow: 0xe5002b, thread: "gold" },
  { code: "DK", name: "Dplus KIA", region: "LCK", phase: "Système suisse", logo: "/images/teams/DK.png", fabricA: 0x0d0f14, fabricB: 0x262a33, sheen: 0x9aa3b5, glow: 0xc9d2e6, thread: "silver" },
  { code: "AL", name: "Anyone's Legend", region: "LPL", phase: "Système suisse", logo: "/images/teams/AL.png", fabricA: 0x4a1111, fabricB: 0xa02525, sheen: 0xde8c8c, glow: 0xc32e2e, thread: "gold" },
  { code: "BLG", name: "Bilibili Gaming", region: "LPL", phase: "Système suisse", logo: "/images/teams/BLG.png", fabricA: 0x044c5d, fabricB: 0x09a4c8, sheen: 0x79e1f9, glow: 0x0bc8f4, thread: "gold" },
  { code: "TES", name: "Top Esports", region: "LPL", phase: "Système suisse", logo: "/images/teams/TES.png", fabricA: 0x610c00, fabricB: 0xd11900, sheen: 0xff8373, glow: 0xff1e00, thread: "gold" },
  { code: "IG", name: "Invictus Gaming", region: "LPL", phase: "Système suisse", logo: "/images/teams/IG.png", fabricA: 0x0d0f14, fabricB: 0x262a33, sheen: 0x9aa3b5, glow: 0xc9d2e6, thread: "silver" },
  { code: "G2", name: "G2 Esports", region: "LEC", phase: "Système suisse", logo: "/images/teams/G2.png", fabricA: 0x0d0f14, fabricB: 0x262a33, sheen: 0x9aa3b5, glow: 0xc9d2e6, thread: "silver" },
  { code: "MKOI", name: "Movistar KOI", region: "LEC", phase: "Système suisse", logo: "/images/teams/MKOI.png", fabricA: 0x083059, fabricB: 0x1168c0, sheen: 0x7eb8f4, glow: 0x157fea, thread: "gold" },
  { code: "TLAW", name: "Team Liquid", region: "LCS", phase: "Système suisse", logo: "/images/teams/TLAW.png", fabricA: 0x0d0f14, fabricB: 0x262a33, sheen: 0x9aa3b5, glow: 0xc9d2e6, thread: "silver" },
  { code: "LYON", name: "LYON", region: "LCS", phase: "Système suisse", logo: "/images/teams/LYON.png", fabricA: 0x403321, fabricB: 0x8b6f46, sheen: 0xd0bda2, glow: 0xa98756, thread: "silver" },
  { code: "TSW", name: "Team Secret Whales", region: "LCP", phase: "Système suisse", logo: "/images/teams/TSW.png", fabricA: 0x0d0f14, fabricB: 0x262a33, sheen: 0x9aa3b5, glow: 0xc9d2e6, thread: "silver" },
  { code: "CFO", name: "CTBC Flying Oyster", region: "LCP", phase: "Système suisse", logo: "/images/teams/CFO.png", fabricA: 0x56450b, fabricB: 0xba9517, sheen: 0xefd782, glow: 0xe3b61c, thread: "silver" },
  { code: "LOS", name: "Los Grandes", region: "CBLOL", phase: "Système suisse", logo: "/images/teams/LOS.png", fabricA: 0x5b1706, fabricB: 0xc4310d, sheen: 0xf7947b, glow: 0xf03c0f, thread: "gold" },
];

export function teamBrand(code: string): TeamBrand | undefined {
  return WORLDS_2026_TEAMS.find((t) => t.code === code);
}
