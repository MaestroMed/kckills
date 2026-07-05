"use client";

/**
 * Client half of HomeGridSection (Vague 3).
 *
 * Desktop (≥768px): the full 2D GridCanvas engine — keyboard, wheel,
 * pinch, diagonal axis pivots — lazy-loaded via next/dynamic ssr:false
 * so its 400-line engine never ships to mobile.
 *
 * Mobile: arbitrage produit 2026-07-05 « desktop-first » — the
 * homepage mobile is memory-fragile (the hero video rotator had to be
 * disabled for iOS crashes), so mobile gets a lightweight horizontal
 * snap row of the top cells instead of the untested 2D engine. Both
 * are gated through DesktopOnly (matchMedia — the mobile subtree
 * never MOUNTS on desktop and vice-versa, no hidden-CSS double cost).
 */

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { DesktopOnly } from "@/components/DesktopOnly";
import type { GridCellData } from "@/components/grid/GridCell";
import type { GridAxisId } from "@/lib/grid/axis-config";
import { useT } from "@/lib/i18n/use-lang";

const GridCanvasLazy = dynamic(
  () => import("@/components/grid/GridCanvas").then((m) => m.GridCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full animate-pulse rounded-3xl border border-[var(--gold)]/10 bg-white/[0.02]"
        style={{ aspectRatio: "16 / 10", maxHeight: "70vh" }}
      />
    ),
  },
);

interface Props {
  cells: GridCellData[];
  axisXInitial: GridAxisId;
  axisYInitial: GridAxisId;
  axisValues: Record<GridAxisId, { value: string; label: string }[]>;
}

export function HomeGridClient({
  cells,
  axisXInitial,
  axisYInitial,
  axisValues,
}: Props) {
  return (
    <DesktopOnly
      fallback={
        <GridMobileRow
          cells={cells}
          axisValues={axisValues}
          axisX={axisXInitial}
          axisY={axisYInitial}
        />
      }
    >
      <GridCanvasLazy
        cells={cells}
        axisXInitial={axisXInitial}
        axisYInitial={axisYInitial}
        axisValues={axisValues}
      />
    </DesktopOnly>
  );
}

/**
 * GridMobileRow — the simplified mobile face of the grid: the top
 * cells (by kill volume) as a horizontal snap strip. Pure CSS
 * scroll-snap, next/image thumbnails, zero engine JS.
 */
function GridMobileRow({
  cells,
  axisValues,
  axisX,
  axisY,
}: {
  cells: GridCellData[];
  axisValues: Record<GridAxisId, { value: string; label: string }[]>;
  axisX: GridAxisId;
  axisY: GridAxisId;
}) {
  const t = useT();
  const labelFor = (axis: GridAxisId, value: string) =>
    axisValues[axis]?.find((v) => v.value === value)?.label ?? value;

  const top = [...cells]
    .sort((a, b) => b.kill_count - a.kill_count)
    .slice(0, 12);

  return (
    <div>
      <p className="mb-3 text-center text-xs text-[var(--text-muted)]">
        {t("p_grid.mobile_sub")}
      </p>
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2"
        role="list"
        aria-label={t("p_grid.mobile_heading")}
      >
        {top.map((cell) => (
          <Link
            key={`${cell.cell_x}::${cell.cell_y}`}
            role="listitem"
            href={`/kill/${cell.top_kill_id}`}
            className="relative block w-[62vw] max-w-[240px] flex-shrink-0 snap-center overflow-hidden rounded-2xl border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
          >
            <div className="relative aspect-[9/12] bg-[var(--bg-elevated)]">
              {cell.top_thumbnail && (
                <Image
                  src={cell.top_thumbnail}
                  alt=""
                  fill
                  sizes="62vw"
                  className="object-cover"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
              <div className="absolute inset-x-3 bottom-3">
                <p className="font-data text-[10px] uppercase tracking-[0.2em] text-white/60">
                  {labelFor(axisX, cell.cell_x)}{" "}
                  <span className="text-[var(--gold)]">vs</span>{" "}
                  {labelFor(axisY, cell.cell_y)}
                </p>
                <p className="mt-1 text-xs font-bold text-white">
                  {cell.kill_count} kill{cell.kill_count > 1 ? "s" : ""}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
