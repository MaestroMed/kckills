/**
 * Server-side wrapper around the `fn_get_grid_cells` RPC.
 *
 * Runs only in RSC / route handlers. Reads anonymously — the RPC is marked
 * SECURITY DEFINER with an axis whitelist, so the anon role can safely
 * invoke it without opening the kills table to arbitrary projections.
 */

import "server-only";
import { createServerSupabase, rethrowIfDynamic } from "./server";
import type { GridAxisId } from "@/lib/grid/axis-config";

export interface GridCellRow {
  cell_x: string;
  cell_y: string;
  kill_count: number;
  top_kill_id: string;
  top_thumbnail: string | null;
  top_vertical_url: string | null;
  top_vertical_low_url: string | null;
  avg_rating: number | null;
  rating_count: number;
  avg_highlight: number | null;
}

/**
 * Filter values accepted by the grid RPC. The jsonb is intentionally
 * loose because each axis defines its own filter keys, but each leaf
 * value is constrained — an accidental object/array would crash the RPC
 * silently. Catching that at the call site beats debugging a "no cells"
 * empty grid in production.
 */
export type GridFilterValue = string | number | boolean | null;
export type GridFilters = Record<string, GridFilterValue>;

/**
 * Fetch one row per (cell_x, cell_y) bucket for the requested axis pair.
 * Returns [] on error so the grid can fall back to a skeleton state.
 */
export async function getGridCells(
  axisX: GridAxisId,
  axisY: GridAxisId,
  filters: GridFilters = {},
): Promise<GridCellRow[]> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("fn_get_grid_cells", {
      p_axis_x: axisX,
      p_axis_y: axisY,
      p_filters: filters,
    });
    if (error) {
      console.warn("[supabase/grid] fn_get_grid_cells error:", error.message);
      return [];
    }
    return (data ?? []) as GridCellRow[];
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/grid] fn_get_grid_cells threw:", err);
    return [];
  }
}
