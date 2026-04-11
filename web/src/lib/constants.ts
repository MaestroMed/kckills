export const KC_TEAM_SLUG = "karmine-corp";

export const ROLE_ORDER: Record<string, number> = {
  top: 0,
  jungle: 1,
  mid: 2,
  adc: 3,
  bottom: 3,
  support: 4,
};

export const KILL_TYPE_LABELS: Record<string, string> = {
  solo_kill: "Solo Kill",
  first_blood: "First Blood",
  double_kill: "Double Kill",
  triple_kill: "Triple Kill",
  quadra_kill: "Quadra Kill",
  penta_kill: "Penta Kill",
  ace: "Ace",
  shutdown: "Shutdown",
  regular: "Kill",
};

export const KILL_TYPE_COLORS: Record<string, string> = {
  solo_kill: "bg-purple-500/20 text-purple-300",
  first_blood: "bg-red-500/20 text-red-300",
  double_kill: "bg-orange-500/20 text-orange-300",
  triple_kill: "bg-orange-500/20 text-orange-300",
  quadra_kill: "bg-yellow-500/20 text-yellow-300",
  penta_kill: "bg-yellow-500/20 text-yellow-200",
  ace: "bg-green-500/20 text-green-300",
  shutdown: "bg-blue-500/20 text-blue-300",
  regular: "bg-gray-500/20 text-gray-300",
};

const DDRAGON = "16.7.1";

export function championIconUrl(championName: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${DDRAGON}/img/champion/${championName}.png`;
}

/** Full splash art — used as background in scroll mode */
export function championSplashUrl(championName: string, skinNum = 0): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championName}_${skinNum}.jpg`;
}

/** Loading screen art — tall format, good for vertical */
export function championLoadingUrl(championName: string, skinNum = 0): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championName}_${skinNum}.jpg`;
}

export function formatGameTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
