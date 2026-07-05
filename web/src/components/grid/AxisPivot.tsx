"use client";

import { FilterChips } from "@/components/ui/FilterChips";
import type { GridAxisId } from "@/lib/grid/axis-config";
import { allowedAxesExcept } from "@/lib/grid/axis-config";
import { useT } from "@/lib/i18n/use-lang";

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
  const t = useT();
  const xOptions = allowedAxesExcept(axisY).map((a) => ({
    value: a.id,
    label: t(`p_grid.axis_${a.id}`),
  }));
  const yOptions = allowedAxesExcept(axisX).map((a) => ({
    value: a.id,
    label: t(`p_grid.axis_${a.id}`),
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
          label={t("p_grid.axis_x_label", { axis: t(`p_grid.axis_${axisX}`) })}
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
          label={t("p_grid.axis_y_label", { axis: t(`p_grid.axis_${axisY}`) })}
        />
      </div>
    </div>
  );
}
