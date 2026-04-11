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
