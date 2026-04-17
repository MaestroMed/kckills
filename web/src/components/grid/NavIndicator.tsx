"use client";

import type { GridAxisId } from "@/lib/grid/axis-config";
import { GRID_AXES } from "@/lib/grid/axis-config";

interface NavIndicatorProps {
  axisX: GridAxisId;
  axisY: GridAxisId;
  cellX: string | null;
  cellY: string | null;
  /** Neighbour labels so the HUD reads like "← G2  Caliste ↓  T1 →". */
  prevXLabel?: string;
  nextXLabel?: string;
  prevYLabel?: string;
  nextYLabel?: string;
}

/**
 * Top/bottom/left/right HUD hints for the grid. Mirrors the "directional
 * preference" feedback that powers V2 adaptive axes: even in V1 the user
 * always sees what a given scroll direction will reveal.
 */
export function NavIndicator({
  axisX,
  axisY,
  cellX,
  cellY,
  prevXLabel,
  nextXLabel,
  prevYLabel,
  nextYLabel,
}: NavIndicatorProps) {
  const xAxis = GRID_AXES[axisX];
  const yAxis = GRID_AXES[axisY];

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 text-[10px] font-data uppercase tracking-[0.2em] text-white/70"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* Top: current X-axis bucket */}
      <div className="absolute inset-x-0 top-3 flex justify-center">
        <span className="rounded-full border border-[var(--gold)]/30 bg-black/60 px-3 py-1 backdrop-blur-md">
          <span className="text-white/50 mr-2">{xAxis.short}</span>
          <span className="text-[var(--gold)]">{cellX ?? "—"}</span>
        </span>
      </div>

      {/* Bottom: current Y-axis bucket */}
      <div className="absolute inset-x-0 bottom-3 flex justify-center">
        <span className="rounded-full border border-[var(--cyan)]/30 bg-black/60 px-3 py-1 backdrop-blur-md">
          <span className="text-white/50 mr-2">{yAxis.short}</span>
          <span className="text-[var(--cyan)]">{cellY ?? "—"}</span>
        </span>
      </div>

      {/* Left: previous X or Y hint */}
      {prevXLabel ? (
        <div className="absolute left-3 top-1/2 -translate-y-1/2">
          <span className="rounded-full border border-white/20 bg-black/50 px-2.5 py-1 backdrop-blur-md">
            {"\u2190"} {prevXLabel}
          </span>
        </div>
      ) : null}

      {/* Right: next X hint */}
      {nextXLabel ? (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <span className="rounded-full border border-white/20 bg-black/50 px-2.5 py-1 backdrop-blur-md">
            {nextXLabel} {"\u2192"}
          </span>
        </div>
      ) : null}

      {/* Diagonal hints — signaled with discrete tiny chips so the UI stays quiet */}
      {prevYLabel ? (
        <div className="absolute left-3 top-3">
          <span className="rounded border border-white/15 bg-black/40 px-2 py-0.5 text-[9px] backdrop-blur-md">
            {"\u2196"} {prevYLabel}
          </span>
        </div>
      ) : null}
      {nextYLabel ? (
        <div className="absolute right-3 top-3">
          <span className="rounded border border-white/15 bg-black/40 px-2 py-0.5 text-[9px] backdrop-blur-md">
            {nextYLabel} {"\u2198"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
