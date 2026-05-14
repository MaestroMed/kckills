/**
 * Face-off — client-safe types.
 *
 * Split off `face-off.ts` (Wave 30o) so client components (FaceOff.tsx)
 * can import row shapes without dragging `"server-only"` + cookies()
 * into the browser bundle.
 *
 * Anything that needs DB access lives in `face-off.ts` (server-only).
 */

// ════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════

export interface FaceOffPlayerStats {
  slug: string;                    // input slug, lower-cased
  ign: string;                     // canonical ign from DB (or fallback to slug)
  role: string | null;             // top/jungle/mid/bottom/support
  imageUrl: string | null;
  /** Total kills where this player is the killer. */
  totalKills: number;
  /** Total deaths where this player is the victim. */
  totalDeaths: number;
  /** Multi-kills (triple/quadra/penta) counted on the kill side. */
  multiKillCount: number;
  /** First-blood kills landed by this player. */
  firstBloods: number;
  /** Avg highlight_score on this player's kill clips (Gemini IA). */
  avgHighlightScore: number;       // 0-10, null in DB → 0
  /** Avg community avg_rating across this player's kill clips. */
  avgCommunityRating: number;      // 0-5
  /** Single best clip score. */
  bestClipScore: number;
  /** Distinct champions used as killer. */
  championsCount: number;
  /** Total clip count we have published for this player. */
  publishedClipCount: number;
}

/** Per-row shape returned to the UI for the side-by-side top-10 grid. */
export interface FaceOffTopKill {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  victim_name: string | null;
  thumbnail_url: string | null;
  clip_url_vertical: string | null;
  highlight_score: number | null;
  avg_rating: number | null;
  rating_count: number;
  multi_kill: string | null;
  is_first_blood: boolean;
  ai_description: string | null;
  created_at: string;
  match_stage: string | null;
}

export interface MostKilledOpponent {
  victim_ign: string;
  victim_champion: string | null;   // most-used champion when killed
  count: number;
}

export interface FaceOffTally {
  votes_a: number;
  votes_b: number;
  votes_draw: number;
}

export interface FaceOffVoteResult extends FaceOffTally {
  inserted: boolean;
}

export interface TopFaceOffDuel {
  player_a_slug: string;
  player_b_slug: string;
  votes_a: number;
  votes_b: number;
  votes_draw: number;
  total_votes: number;
}
