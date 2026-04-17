import { getGridCells } from "@/lib/supabase/grid";
import { getTrackedRoster } from "@/lib/supabase/players";
import {
  DEFAULT_AXIS_X,
  DEFAULT_AXIS_Y,
  FIGHT_TYPES,
  GRID_AXES,
  MINUTE_BUCKETS,
  type GridAxisId,
} from "@/lib/grid/axis-config";
import { GridCanvas } from "./GridCanvas";

/**
 * RSC wrapper that hydrates the Scroll Vivant grid with its initial data.
 * Fetches the default axis pair (minute × player) and the KC roster so we
 * can render UUIDs as readable IGNs. Subsequent axis pivots re-fetch
 * client-side via the fn_get_grid_cells RPC exposed through Supabase.
 */
export async function ScrollVivantSection() {
  const [cells, roster] = await Promise.all([
    getGridCells(DEFAULT_AXIS_X, DEFAULT_AXIS_Y),
    getTrackedRoster(),
  ]);

  if (cells.length === 0 || roster.length === 0) {
    // Graceful degradation: nothing to pivot on → render nothing.
    // The homepage keeps its existing sections so the page is never broken.
    return null;
  }

  // Gather the opponent codes present in the data so the diagonal axis has
  // a real value set instead of the empty static config.
  const opponentSet = new Set<string>();
  for (const c of cells) {
    if (GRID_AXES[DEFAULT_AXIS_X].id === "opponent_team_code") opponentSet.add(c.cell_x);
    if (GRID_AXES[DEFAULT_AXIS_Y].id === "opponent_team_code") opponentSet.add(c.cell_y);
  }

  const axisValues = {
    game_minute_bucket: [...MINUTE_BUCKETS],
    killer_player_id: roster.map((p) => ({ value: p.id, label: p.ign })),
    opponent_team_code: [...opponentSet].map((code) => ({ value: code, label: code })),
    fight_type: [...FIGHT_TYPES],
  } satisfies Record<GridAxisId, { value: string; label: string }[]>;

  return (
    <section className="max-w-7xl mx-auto px-6 md:px-10 lg:px-16 py-16">
      <div className="mb-8 text-center">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
          Scroll Vivant · v1
        </p>
        <h2 className="font-display text-4xl md:text-5xl font-black">
          <span className="text-shimmer">Scrolle sur 4 axes</span>
        </h2>
        <p className="mt-3 max-w-xl mx-auto text-sm text-white/60 leading-relaxed">
          Chaque cellule un kill. Flèches ou swipe pour naviguer, diagonale pour
          changer d&apos;axe — minute, joueur, adversaire, type de fight.
        </p>
      </div>
      <GridCanvas
        cells={cells}
        axisXInitial={DEFAULT_AXIS_X}
        axisYInitial={DEFAULT_AXIS_Y}
        axisValues={axisValues}
      />
    </section>
  );
}
