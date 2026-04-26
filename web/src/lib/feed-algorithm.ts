/**
 * Wilson score confidence interval for ranking kills.
 * Better than raw average — accounts for sample size.
 */

export function wilsonScore(positiveRatio: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const phat = positiveRatio;
  const denominator = 1 + (z * z) / n;
  const centre = phat + (z * z) / (2 * n);
  const spread = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
  return (centre - spread) / denominator;
}

export interface ScoredKill {
  playerName: string;
  champion: string;
  opponentName: string;
  opponentChampion: string;
  kills: number;
  deaths: number;
  assists: number;
  matchId: string;
  matchDate: string;
  opponent: string;
  stage: string;
  gameNumber: number;
  gameKcKills: number;
  gameOppKills: number;
  isKcKiller: boolean;
  kcWon: boolean;
  gold: number;
  score: number;
}

/**
 * Score a player's performance in a game.
 * Higher = more highlight-worthy.
 */
export function computeKillScore(
  kills: number,
  deaths: number,
  assists: number,
  teamKills: number,
  isKcKiller: boolean,
  kcWon: boolean,
): number {
  // KDA contribution
  const kda = deaths > 0 ? (kills + assists) / deaths : (kills + assists) * 1.5;

  // Kill participation
  const kp = teamKills > 0 ? (kills + assists) / teamKills : 0;

  // Score components
  let score = 0;
  score += Math.min(kills * 1.5, 15); // kills (capped)
  score += Math.min(kda * 0.8, 10);   // kda
  score += kp * 5;                      // kill participation
  score += kcWon ? 2 : 0;              // win bonus
  score += isKcKiller ? 1 : 0;         // KC perspective bonus

  // Multi-kill bonus
  if (kills >= 5) score *= 2.0;        // penta territory
  else if (kills >= 4) score *= 1.5;   // quadra
  else if (kills >= 3) score *= 1.2;   // triple

  // Death penalty
  if (deaths === 0) score *= 1.3;      // deathless bonus
  if (deaths >= 5) score *= 0.7;       // too many deaths

  return Math.round(score * 10) / 10;
}

// ─── Personalised feed score (PR-loltok DI / Wave 11) ─────────────────
//
// Wilson is a global ranking — same for everyone. The recommendation
// engine adds a per-session signal : how similar is this clip to what
// the user just watched, in embedding space (cosine similarity, 0..1) ?
//
// We blend the two so the personalised feed is :
//   * still anchored on global quality (Wilson + freshness +
//     engagement + multi-kill bonuses) — bad clips never bubble up
//   * but tilted ~20% toward similarity so the user gets a coherent
//     run of related content (Yike ganks, Caliste teamfights, …)
//
// The 0.20 weight came out of the spec ("similarity should personalise
// meaningfully without dominating"). Tunable below — DO NOT push past
// ~0.40 without re-evaluating, or the feed degenerates into a single
// player / champion echo chamber.
export const SIMILARITY_WEIGHT = 0.20;

/**
 * Minimal kill shape consumed by `personalizedFeedScore`. Keeping this
 * narrow (instead of importing PublishedKillRow) lets the function be
 * called from both server-side feed builders and from the client-side
 * useRecommendationFeed hook without dragging the bigger view-model
 * into the bundle.
 */
export interface FeedScoreInput {
  highlight_score: number | null;
  avg_rating: number | null;
  rating_count: number;
  impression_count: number;
  comment_count: number;
  multi_kill: string | null;
  is_first_blood: boolean;
  /** "team_killer" = KC kill, "team_victim" = KC death. */
  tracked_team_involvement: string | null;
  killer_player_id: string | null;
  created_at: string;
}

/**
 * Compose a personalised feed score for one kill, mixing the existing
 * global Wilson signals with the per-session similarity.
 *
 * @param kill              minimal kill shape — see FeedScoreInput.
 * @param similarity        cosine 0..1 from the recommender. Pass 0
 *                          when no anchor is available (cold start) —
 *                          the function then degenerates back to a
 *                          standard Wilson-only score.
 * @param recentKillerIds   recent killer player_ids (last ~5 in feed
 *                          order) — used for the diversity damping
 *                          factor that prevents the same player from
 *                          monopolising N consecutive slots.
 * @param sideAffinityBoostValue Optional 1.0/1.2/0.x multiplier for
 *                          affinity tilt (e.g. user has rated 3+ KC-side
 *                          kills → boost similar KC-side ones). Defaults
 *                          to 1.0.
 */
export function personalizedFeedScore(
  kill: FeedScoreInput,
  similarity: number,
  recentKillerIds: string[],
  sideAffinityBoostValue: number = 1.0,
): number {
  const quality = (kill.highlight_score ?? 5) / 10;
  const community =
    kill.rating_count > 0
      ? wilsonScore((kill.avg_rating ?? 0) / 5, kill.rating_count)
      : 0.5;
  const hoursOld =
    (Date.now() - new Date(kill.created_at).getTime()) / 3_600_000;
  const freshness = Math.exp(-hoursOld / 168); // half-life 1 week
  const engagement =
    kill.impression_count > 10
      ? Math.min(
          1,
          (kill.rating_count + kill.comment_count) / kill.impression_count,
        )
      : 0.3;
  // Diversity : if this killer appears in the last 5 slots, halve the
  // baseline diversity factor. Same rule the existing scroll algo uses.
  const diversity = recentKillerIds
    .slice(-5)
    .includes(kill.killer_player_id ?? "")
    ? 0.5
    : 1.0;

  // Clamp similarity to a safe 0..1 range — the RPC math should already
  // do this but a stray NaN here would poison the blend.
  const sim = Number.isFinite(similarity)
    ? Math.max(0, Math.min(1, similarity))
    : 0;

  // Weighted sum. Weights add to 1.0 minus SIMILARITY_WEIGHT so that the
  // personalised tilt is purely additive on top of the global ranking.
  const baseWeight = 1 - SIMILARITY_WEIGHT;
  let score =
    baseWeight *
      (quality * 0.30 +
        community * 0.25 +
        freshness * 0.20 +
        engagement * 0.15 +
        diversity * 0.10) +
    SIMILARITY_WEIGHT * sim;

  // Multi-kill / first-blood bumps mirror the existing scroll algo so
  // pentas keep their viral edge regardless of similarity.
  if (kill.multi_kill === "penta") score *= 2.0;
  else if (kill.multi_kill === "quadra") score *= 1.5;
  else if (kill.multi_kill === "triple") score *= 1.2;
  if (kill.is_first_blood) score *= 1.1;

  // Per-user side affinity tilt (optional).
  score *= sideAffinityBoostValue;

  return score;
}

/**
 * Compute the side-affinity boost to feed into `personalizedFeedScore`.
 *
 * When a user has rated 3+ kills with the same `tracked_team_involvement`
 * (typically "team_killer" — the KC-perspective kills), the similar-side
 * candidates get a 1.2x bump. Conversely, if a user has rated 3+
 * "team_victim" kills (they like watching KC get clowned), team_victim
 * candidates get the bump.
 *
 * `targetSide` should be the candidate kill's `tracked_team_involvement`.
 * `affinityCounts` is a small histogram { side → ratings_count } the
 * client-side hook can build from the user's rating history. Returning
 * 1.0 (no bump) is the safe default when affinity isn't established yet.
 */
export function sideAffinityBoost(
  targetSide: string | null,
  affinityCounts: Partial<Record<string, number>>,
  threshold: number = 3,
): number {
  if (!targetSide) return 1.0;
  const count = affinityCounts[targetSide] ?? 0;
  return count >= threshold ? 1.2 : 1.0;
}
