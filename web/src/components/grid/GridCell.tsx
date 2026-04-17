"use client";

import Image from "next/image";
import Link from "next/link";
import { memo } from "react";

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
  /** Shared layout id so Framer Motion animates the thumbnail into the
   *  fullscreen scroll-feed on tap. Kept optional so Phase 4 can wire it
   *  without this component depending on Framer. */
  layoutId?: string;
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
}: GridCellProps) {
  const rating = typeof cell.avg_rating === "number" ? cell.avg_rating.toFixed(1) : null;
  return (
    <Link
      href={`/kill/${cell.top_kill_id}`}
      className={
        "group relative block h-full w-full overflow-hidden rounded-2xl border transition-all duration-300 " +
        (active
          ? "border-[var(--gold)] scale-[1.02] shadow-2xl shadow-[var(--gold)]/20"
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
            "object-cover transition-transform duration-500 " +
            (active ? "scale-100" : "scale-105 group-hover:scale-100")
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
