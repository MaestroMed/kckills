"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridAxisId } from "@/lib/grid/axis-config";
import { GRID_AXES, nextAxis } from "@/lib/grid/axis-config";
import type { GridCellData } from "@/components/grid/GridCell";
import { trackGridEvent } from "@/lib/grid/analytics";

export interface GridEngineInput {
  axisXInitial: GridAxisId;
  axisYInitial: GridAxisId;
  cells: GridCellData[];
  /** Dynamic value order per axis (overrides the static config when the data
   *  defines its own universe, e.g. player UUIDs or opponent team codes). */
  axisValues: Record<GridAxisId, { value: string; label: string }[]>;
}

export interface GridEngineState {
  axisX: GridAxisId;
  axisY: GridAxisId;
  cursorX: number;
  cursorY: number;
  activeCell: GridCellData | null;
  xValues: { value: string; label: string }[];
  yValues: { value: string; label: string }[];
  move: (dx: number, dy: number) => void;
  pivotX: (next: GridAxisId) => void;
  pivotY: (next: GridAxisId) => void;
  swapDiagonal: (dir: "br" | "bl") => void;
}

/**
 * Engine state for the Scroll Vivant grid. Owns the axis pair, the cursor
 * coordinates, and emits analytics events for V2's adaptive algorithm.
 */
export function useGridEngine({
  axisXInitial,
  axisYInitial,
  cells,
  axisValues,
}: GridEngineInput): GridEngineState {
  const [axisX, setAxisX] = useState<GridAxisId>(axisXInitial);
  const [axisY, setAxisY] = useState<GridAxisId>(axisYInitial);
  const [cursorX, setCursorX] = useState(0);
  const [cursorY, setCursorY] = useState(0);
  const lastDirectionAt = useRef<number>(0);

  const xValues = useMemo(
    () => axisValues[axisX] ?? GRID_AXES[axisX].values,
    [axisValues, axisX],
  );
  const yValues = useMemo(
    () => axisValues[axisY] ?? GRID_AXES[axisY].values,
    [axisValues, axisY],
  );

  // Build a lookup so cursor coordinates resolve to a cell in O(1).
  const cellMap = useMemo(() => {
    const m = new Map<string, GridCellData>();
    for (const c of cells) {
      m.set(`${c.cell_x}::${c.cell_y}`, c);
    }
    return m;
  }, [cells]);

  const activeCell = useMemo(() => {
    const xv = xValues[cursorX]?.value;
    const yv = yValues[cursorY]?.value;
    if (!xv || !yv) return null;
    return cellMap.get(`${xv}::${yv}`) ?? null;
  }, [cellMap, cursorX, cursorY, xValues, yValues]);

  // Clamp the cursor if the axis value set shrinks (axis swap).
  useEffect(() => {
    setCursorX((c) => Math.min(c, Math.max(0, xValues.length - 1)));
  }, [xValues.length]);
  useEffect(() => {
    setCursorY((c) => Math.min(c, Math.max(0, yValues.length - 1)));
  }, [yValues.length]);

  const move = useCallback(
    (dx: number, dy: number) => {
      if (dx === 0 && dy === 0) return;
      setCursorX((c) => {
        const next = c + dx;
        if (next < 0 || next >= xValues.length) return c;
        return next;
      });
      setCursorY((c) => {
        const next = c + dy;
        if (next < 0 || next >= yValues.length) return c;
        return next;
      });
      // Light-weight analytics: emit at most every 200ms so continuous drags
      // don't flood Umami.
      const now = Date.now();
      if (now - lastDirectionAt.current > 200) {
        lastDirectionAt.current = now;
        const axis =
          dx !== 0 && dy !== 0
            ? dx > 0
              ? "diagonal_br"
              : "diagonal_bl"
            : dx !== 0
              ? "x"
              : "y";
        trackGridEvent("grid_scroll_direction", { axis });
      }
    },
    [xValues.length, yValues.length],
  );

  const pivotX = useCallback(
    (next: GridAxisId) => {
      if (next === axisX || next === axisY) return;
      trackGridEvent("grid_axis_pivot", { axis: "x", from: axisX, to: next });
      setAxisX(next);
      setCursorX(0);
    },
    [axisX, axisY],
  );

  const pivotY = useCallback(
    (next: GridAxisId) => {
      if (next === axisY || next === axisX) return;
      trackGridEvent("grid_axis_pivot", { axis: "y", from: axisY, to: next });
      setAxisY(next);
      setCursorY(0);
    },
    [axisX, axisY],
  );

  const swapDiagonal = useCallback(
    (dir: "br" | "bl") => {
      // ↘ swaps Y to the next axis in the pool; ↙ swaps X.
      if (dir === "br") {
        pivotY(nextAxis(axisY, axisX));
      } else {
        pivotX(nextAxis(axisX, axisY));
      }
    },
    [axisX, axisY, pivotX, pivotY],
  );

  return {
    axisX,
    axisY,
    cursorX,
    cursorY,
    activeCell,
    xValues,
    yValues,
    move,
    pivotX,
    pivotY,
    swapDiagonal,
  };
}
