/**
 * Scroll Vivant V1 — 4 fixed pivot axes for the homepage grid.
 *
 * Each axis maps 1:1 to a column on `kills` (or a computed derivation for
 * `opponent_team_code`). The labels + orderings here are consumed by the
 * grid RPC wrapper and rendered by NavIndicator + AxisPivot.
 *
 * V2 (post-launch) will allow remapping these axes dynamically based on
 * behavioral signals — for V1 the set is static.
 */

export type GridAxisId =
  | "game_minute_bucket"
  | "killer_player_id"
  | "opponent_team_code"
  | "fight_type";

export type GridDirection = "horizontal" | "vertical" | "diagonal_br" | "diagonal_bl";

export interface GridAxis {
  id: GridAxisId;
  label: string;
  short: string;
  hint: string;
  direction: GridDirection;
  /** Display order for cells along this axis (stable across renders). */
  values: { value: string; label: string }[];
}

export const MINUTE_BUCKETS = [
  { value: "0-5", label: "0-5" },
  { value: "5-10", label: "5-10" },
  { value: "10-15", label: "10-15" },
  { value: "15-20", label: "15-20" },
  { value: "20-25", label: "20-25" },
  { value: "25-30", label: "25-30" },
  { value: "30-35", label: "30-35" },
  { value: "35+", label: "35+" },
] as const;

export const FIGHT_TYPES = [
  { value: "solo_kill", label: "Solo" },
  { value: "gank", label: "Gank" },
  { value: "skirmish_2v2", label: "2v2" },
  { value: "skirmish_3v3", label: "3v3" },
  { value: "teamfight_4v4", label: "4v4" },
  { value: "teamfight_5v5", label: "5v5" },
  { value: "pick", label: "Pick" },
] as const;

/**
 * The V1 pivot matrix. Horizontal scrolls through game time, vertical
 * through the KC roster, and diagonals pivot to the opponent team /
 * fight type — the 4 axes the user explicitly asked for.
 */
export const GRID_AXES: Record<GridAxisId, GridAxis> = {
  game_minute_bucket: {
    id: "game_minute_bucket",
    label: "Minute de jeu",
    short: "Minute",
    hint: "Scroll horizontal",
    direction: "horizontal",
    values: [...MINUTE_BUCKETS],
  },
  killer_player_id: {
    id: "killer_player_id",
    label: "Joueur KC",
    short: "Joueur",
    hint: "Scroll vertical",
    direction: "vertical",
    // Values are filled at runtime from the fetched cells (roster isn't
    // hardcoded — we follow whoever the worker ingested).
    values: [],
  },
  opponent_team_code: {
    id: "opponent_team_code",
    label: "Adversaire",
    short: "Adversaire",
    hint: "Diagonale ↘",
    direction: "diagonal_br",
    values: [],
  },
  fight_type: {
    id: "fight_type",
    label: "Type de fight",
    short: "Fight",
    hint: "Diagonale ↙",
    direction: "diagonal_bl",
    values: [...FIGHT_TYPES],
  },
};

export const DEFAULT_AXIS_X: GridAxisId = "game_minute_bucket";
export const DEFAULT_AXIS_Y: GridAxisId = "killer_player_id";

/** Which axes can live on X, Y, or neither (forbidding self-pairings). */
export function allowedAxesExcept(excluded: GridAxisId): GridAxis[] {
  return (Object.values(GRID_AXES) as GridAxis[]).filter((a) => a.id !== excluded);
}

/** Cycle through axes for diagonal swipe pivots. */
export function nextAxis(current: GridAxisId, excluded: GridAxisId): GridAxisId {
  const pool = allowedAxesExcept(excluded);
  const idx = pool.findIndex((a) => a.id === current);
  if (idx < 0) return pool[0].id;
  return pool[(idx + 1) % pool.length].id;
}
