"use client";

import { FilterChips } from "@/components/ui/FilterChips";
import type { GridAxisId } from "@/lib/grid/axis-config";
import { GRID_AXES, allowedAxesExcept } from "@/lib/grid/axis-config";

interface AxisPivotProps {
  axisX: GridAxisId;
  axisY: GridAxisId;
  onChangeX: (next: GridAxisId) => void;
  onChangeY: (next: GridAxisId) => void;
}

/**
 * Manual fallback controls for axis swapping. The primary interaction is
 * the diagonal swipe on the GridCanvas, but some users will never discover
 * that — these chips are always visible so nobody is blocked.
 */
export function AxisPivot({ axisX, axisY, onChangeX, onChangeY }: AxisPivotProps) {
  const xOptions = allowedAxesExcept(axisY).map((a) => ({
    value: a.id,
    label: a.short,
  }));
  const yOptions = allowedAxesExcept(axisX).map((a) => ({
    value: a.id,
    label: a.short,
  }));

  return (
    <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-white/50">
      <div className="flex items-center gap-2">
        <span aria-hidden className="font-data">
          X
        </span>
        <FilterChips
          options={xOptions}
          value={axisX}
          onChange={onChangeX}
          label={`Axe horizontal (actuellement ${GRID_AXES[axisX].label})`}
        />
      </div>
      <div className="flex items-center gap-2">
        <span aria-hidden className="font-data">
          Y
        </span>
        <FilterChips
          options={yOptions}
          value={axisY}
          onChange={onChangeY}
          label={`Axe vertical (actuellement ${GRID_AXES[axisY].label})`}
        />
      </div>
    </div>
  );
}
