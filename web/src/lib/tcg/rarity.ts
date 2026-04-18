/**
 * TCG Rarity Engine — V1 (presentational only).
 *
 * Computes a 0-100 rarity score for any clip from its public metadata,
 * then maps it to a TCG-style band. Strict rules per ARCHITECTURE.md §4:
 *   - Rarity is COMPUTED, never assigned. No moderator handouts.
 *   - No monetization, no packs, no currency. Cards are how clips LOOK,
 *     not what they DO.
 *   - The visual treatment (frame, glow, particles) ladders up with
 *     rarity but never gates content — every viewer sees every card.
 *
 * V1 inputs are limited to what we already have on `kills`:
 *   highlight_score (Gemini)
 *   avg_rating + rating_count (community)
 *   multi_kill (penta/quadra/triple)
 *   is_first_blood
 *   tracked_team_involvement (KC kill bonus)
 *   fight_type (gank/teamfight/solo_kill)
 *
 * Phase 1 will add `historic_significance`, `event_tier`,
 * `match_point`, `comeback_moment`, `mechanic_highlight[]`,
 * `caster_reaction_score`, `crowd_reaction_score` per ARCHITECTURE.md
 * §3.5 — the formula here is forward-compatible: those signals are
 * mixed in if present, ignored if null.
 */

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";

export interface RaritySignals {
  highlightScore?: number | null;       // Gemini, 1-10
  avgRating?: number | null;            // Community, 1-5
  ratingCount?: number | null;          // 0..N
  multiKill?: string | null;            // 'penta'|'quadra'|'triple'|'double'|null
  isFirstBlood?: boolean | null;
  trackedTeamInvolvement?: string | null; // 'team_killer'|'team_victim'|null
  fightType?: string | null;            // 'solo_kill'|'gank'|'teamfight_5v5'|...
  // Phase 1+ signals (folded in when populated)
  historicSignificance?: "routine" | "notable" | "iconic" | "legendary" | null;
  eventTier?: string | null;            // 'international'|'regional_playoff'|...
  matchPoint?: boolean | null;
  comebackMoment?: boolean | null;
  mechanicHighlightCount?: number | null;
  casterReactionScore?: number | null;  // 0..1
  crowdReactionScore?: number | null;   // 0..1
}

export interface RarityResult {
  /** 0..100 — the raw composite. */
  score: number;
  /** Band derived from score. */
  rarity: Rarity;
  /** Human-readable breakdown — surfaced in tooltips / debug overlays. */
  breakdown: { label: string; points: number }[];
}

/**
 * Compute the rarity score + band.
 *
 * Caps every contribution so a single signal can't dominate. Total cap
 * at 100. Bands tuned so MYTHIC is genuinely scarce (< 1% of clips
 * realistically reach it without Phase 1 signals).
 */
export function computeRarity(s: RaritySignals): RarityResult {
  const breakdown: { label: string; points: number }[] = [];
  let score = 0;

  // ─── Gemini highlight (max 25) ──────────────────────────────────────
  if (typeof s.highlightScore === "number") {
    const pts = Math.min(25, Math.round(((s.highlightScore - 1) / 9) * 25));
    if (pts > 0) {
      breakdown.push({ label: `IA score ${s.highlightScore.toFixed(1)}/10`, points: pts });
      score += pts;
    }
  }

  // ─── Community rating with credibility floor (max 15) ───────────────
  // Don't let 1-vote averages dominate — need >= 3 ratings to count.
  if (
    typeof s.avgRating === "number" &&
    typeof s.ratingCount === "number" &&
    s.ratingCount >= 3
  ) {
    const pts = Math.min(15, Math.round(((s.avgRating - 1) / 4) * 15));
    if (pts > 0) {
      breakdown.push({
        label: `Communaute ${s.avgRating.toFixed(1)}/5 (${s.ratingCount})`,
        points: pts,
      });
      score += pts;
    }
  }

  // ─── Multi-kill (max 25) — the big differentiator at V1 ─────────────
  if (s.multiKill) {
    const map: Record<string, [number, string]> = {
      penta: [25, "PENTAKILL"],
      quadra: [16, "Quadrakill"],
      triple: [8, "Triple kill"],
      double: [3, "Double kill"],
    };
    const entry = map[s.multiKill.toLowerCase()];
    if (entry) {
      breakdown.push({ label: entry[1], points: entry[0] });
      score += entry[0];
    }
  }

  // ─── First Blood (5) ────────────────────────────────────────────────
  if (s.isFirstBlood) {
    breakdown.push({ label: "First Blood", points: 5 });
    score += 5;
  }

  // ─── KC kill bonus (3) — pilot-specific signal ──────────────────────
  if (s.trackedTeamInvolvement === "team_killer") {
    breakdown.push({ label: "KC kill", points: 3 });
    score += 3;
  }

  // ─── Fight context (max 5) ──────────────────────────────────────────
  if (s.fightType === "teamfight_5v5") {
    breakdown.push({ label: "Teamfight 5v5", points: 5 });
    score += 5;
  } else if (s.fightType === "teamfight_4v4") {
    breakdown.push({ label: "Teamfight 4v4", points: 3 });
    score += 3;
  } else if (s.fightType === "skirmish_3v3") {
    breakdown.push({ label: "Skirmish 3v3", points: 2 });
    score += 2;
  }

  // ─── Phase 1 signals (folded in when populated) ─────────────────────
  if (s.historicSignificance) {
    const map: Record<string, [number, string]> = {
      legendary: [25, "Significance: legendary"],
      iconic: [15, "Significance: iconic"],
      notable: [6, "Significance: notable"],
      routine: [0, ""],
    };
    const entry = map[s.historicSignificance];
    if (entry && entry[0] > 0) {
      breakdown.push({ label: entry[1], points: entry[0] });
      score += entry[0];
    }
  }

  if (s.eventTier === "international") {
    breakdown.push({ label: "International event", points: 12 });
    score += 12;
  } else if (s.eventTier === "regional_playoff") {
    breakdown.push({ label: "Regional playoff", points: 6 });
    score += 6;
  }

  if (s.matchPoint) {
    breakdown.push({ label: "Match point", points: 8 });
    score += 8;
  }
  if (s.comebackMoment) {
    breakdown.push({ label: "Comeback moment", points: 5 });
    score += 5;
  }
  if (typeof s.mechanicHighlightCount === "number" && s.mechanicHighlightCount > 0) {
    const pts = Math.min(8, s.mechanicHighlightCount * 3);
    breakdown.push({ label: `${s.mechanicHighlightCount} mechanic highlight(s)`, points: pts });
    score += pts;
  }
  if (typeof s.casterReactionScore === "number" && s.casterReactionScore > 0.5) {
    const pts = Math.round(s.casterReactionScore * 5);
    breakdown.push({ label: "Caster hype", points: pts });
    score += pts;
  }
  if (typeof s.crowdReactionScore === "number" && s.crowdReactionScore > 0.5) {
    const pts = Math.round(s.crowdReactionScore * 5);
    breakdown.push({ label: "Crowd hype", points: pts });
    score += pts;
  }

  score = Math.min(100, Math.max(0, Math.round(score)));

  return { score, rarity: rarityFromScore(score), breakdown };
}

export function rarityFromScore(score: number): Rarity {
  if (score >= 90) return "mythic";
  if (score >= 75) return "legendary";
  if (score >= 55) return "epic";
  if (score >= 35) return "rare";
  if (score >= 18) return "uncommon";
  return "common";
}

/** Visual config for each rarity band — a single source of truth that
 *  CardFrame, MultiKillBadge, FeaturedClip and any future surface can read. */
export const RARITY_VISUAL: Record<
  Rarity,
  {
    label: string;
    accent: string;       // primary hex
    accentSoft: string;   // for backgrounds / glows
    border: string;       // computed border colour
    shadow: string;       // CSS box-shadow string
    particles: boolean;   // animated particle field
    foil: boolean;        // foil/holographic shimmer overlay
    crown: boolean;       // crown icon top-right
  }
> = {
  common: {
    label: "COMMON",
    accent: "#7B8DB5",
    accentSoft: "rgba(123,141,181,0.12)",
    border: "rgba(123,141,181,0.35)",
    shadow: "0 6px 20px rgba(0,0,0,0.4)",
    particles: false,
    foil: false,
    crown: false,
  },
  uncommon: {
    label: "UNCOMMON",
    accent: "#0AC8B9",
    accentSoft: "rgba(10,200,185,0.14)",
    border: "rgba(10,200,185,0.45)",
    shadow: "0 8px 26px rgba(10,200,185,0.18), 0 0 0 1px rgba(10,200,185,0.35)",
    particles: false,
    foil: false,
    crown: false,
  },
  rare: {
    label: "RARE",
    accent: "#0057FF",
    accentSoft: "rgba(0,87,255,0.16)",
    border: "rgba(0,87,255,0.5)",
    shadow: "0 12px 30px rgba(0,87,255,0.22), 0 0 0 1px rgba(0,87,255,0.45), 0 0 30px rgba(0,87,255,0.12)",
    particles: false,
    foil: false,
    crown: false,
  },
  epic: {
    label: "EPIC",
    accent: "#A855F7",
    accentSoft: "rgba(168,85,247,0.18)",
    border: "rgba(168,85,247,0.55)",
    shadow: "0 14px 36px rgba(168,85,247,0.28), 0 0 0 1px rgba(168,85,247,0.5), 0 0 40px rgba(168,85,247,0.18)",
    particles: false,
    foil: true,
    crown: false,
  },
  legendary: {
    label: "LEGENDARY",
    accent: "#FF9800",
    accentSoft: "rgba(255,152,0,0.2)",
    border: "rgba(255,152,0,0.65)",
    shadow: "0 18px 44px rgba(255,152,0,0.32), 0 0 0 1px rgba(255,152,0,0.55), 0 0 50px rgba(255,152,0,0.22)",
    particles: true,
    foil: true,
    crown: true,
  },
  mythic: {
    label: "MYTHIC",
    accent: "#FFD700",
    accentSoft: "rgba(255,215,0,0.22)",
    border: "rgba(255,215,0,0.75)",
    shadow:
      "0 22px 56px rgba(255,215,0,0.4), 0 0 0 2px rgba(255,215,0,0.7), 0 0 70px rgba(255,215,0,0.3), inset 0 0 30px rgba(255,215,0,0.15)",
    particles: true,
    foil: true,
    crown: true,
  },
};

/** Computes the flag set per ARCHITECTURE.md §4.4 — auto-assigned only,
 *  no curation. Caller decides which to render. */
export function computeFlags(s: RaritySignals): string[] {
  const flags: string[] = [];
  if (s.multiKill === "penta") flags.push("PENTAKILL");
  if (s.multiKill === "quadra") flags.push("QUADRAKILL");
  if (s.isFirstBlood) flags.push("FIRST BLOOD");
  if (s.historicSignificance === "legendary") flags.push("LEGENDARY");
  if (s.historicSignificance === "iconic") flags.push("ICONIC");
  if (s.matchPoint) flags.push("MATCHPOINT");
  if (s.comebackMoment) flags.push("COMEBACK");
  if (s.eventTier === "international") flags.push("INTERNATIONAL");
  if (typeof s.mechanicHighlightCount === "number" && s.mechanicHighlightCount > 0) {
    flags.push("MECHANICAL");
  }
  if (s.fightType === "teamfight_5v5") flags.push("TEAMFIGHT");
  if (s.trackedTeamInvolvement === "team_killer") flags.push("KARMINE");
  return flags;
}
