"use client";

import Image from "next/image";
import Link from "next/link";
import { memo } from "react";
import { trackGridEvent } from "@/lib/grid/analytics";
import type { GridAxisId } from "@/lib/grid/axis-config";

export interface GridCellData {
  cell_x: string;
  cell_y: string;
  kill_count: number;
  top_kill_id: string;
  top_thumbnail: string | null;
  avg_rating: number | null;
  avg_highlight: number | null;
}

interface GridCellProps {
  cell: GridCellData;
  active: boolean;
  xLabel: string;
  yLabel: string;
  /** Current grid Y axis — used to build the zoom-in query string so the
   *  scroll feed filters on the slice the user was looking at. */
  axisY: GridAxisId;
}

/** Build the deep-link URL that opens /scroll at the tapped kill with the
 *  Y axis pre-applied as a filter. The X axis is deliberately NOT applied
 *  as a filter (too narrow — two overlapping filters often leaves 0 clips). */
export function buildZoomInHref(cell: GridCellData, axisY: GridAxisId): string {
  const params = new URLSearchParams({
    kill: cell.top_kill_id,
    axis: axisY,
    value: cell.cell_y,
  });
  return `/scroll?${params.toString()}`;
}

/**
 * Single cell of the Scroll Vivant grid. Renders the top-ranked clip's
 * thumbnail + kill count + x/y bucket labels. Becomes visually prominent
 * when it's the cursor-centered cell (`active`).
 */
export const GridCell = memo(function GridCell({
  cell,
  active,
  xLabel,
  yLabel,
  axisY,
}: GridCellProps) {
  const rating = typeof cell.avg_rating === "number" ? cell.avg_rating.toFixed(1) : null;
  const href = buildZoomInHref(cell, axisY);
  return (
    <Link
      href={href}
      onClick={() => {
        trackGridEvent("grid_cell_zoom_in", {
          kill_id: cell.top_kill_id,
          cell_x: cell.cell_x,
          cell_y: cell.cell_y,
          axis_y: axisY,
        });
      }}
      prefetch={false}
      className={
        "group relative block h-full w-full overflow-hidden rounded-2xl border transition-all duration-300 " +
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)] motion-reduce:transition-none " +
        (active
          ? "border-[var(--gold)] scale-[1.02] shadow-2xl shadow-[var(--gold)]/20 motion-reduce:scale-100"
          : "border-white/10 hover:border-[var(--gold)]/40")
      }
      aria-label={`Clip ${xLabel} × ${yLabel}, ${cell.kill_count} kill${cell.kill_count > 1 ? "s" : ""}`}
    >
      {cell.top_thumbnail ? (
        <Image
          src={cell.top_thumbnail}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className={
            "object-cover transition-transform duration-500 motion-reduce:transition-none " +
            (active ? "scale-100" : "scale-105 group-hover:scale-100 motion-reduce:scale-100")
          }
          // Only the active cell exposes the transition name — multiple
          // matching names on the same page break the View Transitions API.
          style={
            active
              ? ({ viewTransitionName: `kill-${cell.top_kill_id}` } as React.CSSProperties)
              : undefined
          }
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]" />
      )}
      {/* Darkening overlay so labels stay readable across any thumbnail */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

      <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/60 font-data">
            {xLabel} · {yLabel}
          </p>
          <p className="mt-1 text-xs font-bold text-white truncate">
            {cell.kill_count} kill{cell.kill_count > 1 ? "s" : ""}
          </p>
        </div>
        {rating ? (
          <span className="flex-shrink-0 rounded-full border border-[var(--gold)]/40 bg-black/60 px-2 py-0.5 text-[10px] font-bold text-[var(--gold)]">
            {"\u2605"} {rating}
          </span>
        ) : null}
      </div>

      {active ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-[var(--gold)]/60"
          style={{
            boxShadow: "inset 0 0 40px rgba(200,170,110,0.25)",
          }}
        />
      ) : null}
    </Link>
  );
});
