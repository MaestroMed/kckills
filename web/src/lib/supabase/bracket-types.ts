/**
 * Bracket — client-safe types and pure helpers.
 *
 * Split off `bracket.ts` (Wave 30o) because the parent file imports
 * `"server-only"` + `./server` (cookies()) — which poisons every client
 * component that needs the bracket shapes or layout helpers. This file
 * has ZERO runtime dependencies so it bundles cleanly into both the
 * server and client targets.
 *
 * Anything that needs DB access lives in `bracket.ts` (server-only).
 * Anything that's a pure shape or arithmetic helper lives here.
 */

// ════════════════════════════════════════════════════════════════════
// Public types
// ════════════════════════════════════════════════════════════════════

export interface BracketTournament {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  status: "open" | "closed" | "archived";
  champion_kill_id: string | null;
  poster_url: string | null;
  bracket_size: number;
  created_at: string;
}

export interface BracketMatch {
  id: string;
  round: number;
  match_index: number;
  kill_a_id: string | null;
  kill_b_id: string | null;
  votes_a: number;
  votes_b: number;
  winner_kill_id: string | null;
  opens_at: string;
  closes_at: string;
  // Kill A snapshot
  kill_a_killer_champion: string | null;
  kill_a_victim_champion: string | null;
  kill_a_killer_name: string | null;
  kill_a_thumbnail: string | null;
  kill_a_clip_vertical: string | null;
  kill_a_clip_vertical_low: string | null;
  kill_a_ai_description: string | null;
  kill_a_multi_kill: string | null;
  kill_a_first_blood: boolean;
  kill_a_highlight_score: number | null;
  kill_a_avg_rating: number | null;
  // Kill B snapshot
  kill_b_killer_champion: string | null;
  kill_b_victim_champion: string | null;
  kill_b_killer_name: string | null;
  kill_b_thumbnail: string | null;
  kill_b_clip_vertical: string | null;
  kill_b_clip_vertical_low: string | null;
  kill_b_ai_description: string | null;
  kill_b_multi_kill: string | null;
  kill_b_first_blood: boolean;
  kill_b_highlight_score: number | null;
  kill_b_avg_rating: number | null;
}

export interface BracketBundle {
  tournament: BracketTournament | null;
  matches: BracketMatch[];
}

export interface PastWinner {
  tournament_id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  poster_url: string | null;
  bracket_size: number;
  champion_kill_id: string | null;
  champion_killer_champion: string | null;
  champion_victim_champion: string | null;
  champion_killer_name: string | null;
  champion_thumbnail: string | null;
  champion_multi_kill: string | null;
  champion_first_blood: boolean;
}

// ════════════════════════════════════════════════════════════════════
// Bracket helpers — used by the client view to lay out the tree
// ════════════════════════════════════════════════════════════════════

/** Total number of rounds for a given bracket size. 64 → 6, 32 → 5, … */
export function roundsForSize(size: number): number {
  if (size >= 64) return 6;
  if (size >= 32) return 5;
  if (size >= 16) return 4;
  if (size >= 8) return 3;
  return 2;
}

/** French label for a round given its index (1-based) + total rounds. */
export function roundLabel(round: number, totalRounds: number): string {
  // Walk back from the final.
  const fromFinal = totalRounds - round;
  switch (fromFinal) {
    case 0:
      return "Finale";
    case 1:
      return "Demi-finales";
    case 2:
      return "Quarts de finale";
    case 3:
      return "Huitièmes";
    case 4:
      return "Seizièmes";
    default:
      return `Tour ${round}`;
  }
}

/** Compute the active round (lowest round with an undecided match). Returns
 *  null when the bracket is fully resolved. */
export function currentRound(matches: BracketMatch[]): number | null {
  if (matches.length === 0) return null;
  let minRound: number | null = null;
  for (const m of matches) {
    if (m.winner_kill_id == null && (m.kill_a_id != null || m.kill_b_id != null)) {
      if (minRound == null || m.round < minRound) minRound = m.round;
    }
  }
  return minRound;
}

/** Count matches whose voting window is currently open. */
export function openMatchCount(matches: BracketMatch[], nowMs: number = Date.now()): number {
  let count = 0;
  for (const m of matches) {
    if (m.winner_kill_id != null) continue;
    if (!m.kill_a_id || !m.kill_b_id) continue;
    const opens = new Date(m.opens_at).getTime();
    const closes = new Date(m.closes_at).getTime();
    if (Number.isFinite(opens) && Number.isFinite(closes) && nowMs >= opens && nowMs <= closes) {
      count += 1;
    }
  }
  return count;
}

/** Earliest `closes_at` among the open matches — used by the hero band. */
export function nextCloseAt(matches: BracketMatch[], nowMs: number = Date.now()): string | null {
  let best: string | null = null;
  let bestMs = Infinity;
  for (const m of matches) {
    if (m.winner_kill_id != null) continue;
    if (!m.kill_a_id || !m.kill_b_id) continue;
    const opens = new Date(m.opens_at).getTime();
    const closes = new Date(m.closes_at).getTime();
    if (!Number.isFinite(opens) || !Number.isFinite(closes)) continue;
    if (nowMs >= opens && nowMs <= closes && closes < bestMs) {
      bestMs = closes;
      best = m.closes_at;
    }
  }
  return best;
}
