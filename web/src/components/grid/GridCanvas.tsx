"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GridCell, type GridCellData, buildZoomInHref } from "./GridCell";
import { NavIndicator } from "./NavIndicator";
import { AxisPivot } from "./AxisPivot";
import { DirectionHint } from "./DirectionHint";
import { useGridEngine } from "@/hooks/useGridEngine";
import { trackGridEvent } from "@/lib/grid/analytics";
import type { GridAxisId } from "@/lib/grid/axis-config";
import { GRID_AXES } from "@/lib/grid/axis-config";

interface GridCanvasProps {
  cells: GridCellData[];
  axisXInitial: GridAxisId;
  axisYInitial: GridAxisId;
  /** Dynamic axis value dictionaries (player UUID → "Caliste", etc.). */
  axisValues: Record<GridAxisId, { value: string; label: string }[]>;
}

const DIAGONAL_SWIPE_THRESHOLD = 70; // px — diagonal distance required to pivot
const KEY_REPEAT_MS = 60;

/**
 * The Scroll Vivant grid canvas. Renders a 3×3 viewport around the active
 * cursor (one active cell + 8 neighbours), listens for keyboard + wheel +
 * touch gestures, and dispatches pan / pivot actions to the engine.
 *
 * Diagonal swipes (↘ / ↙) trigger an axis-swap tilt: the Y or X axis
 * cycles through the pool. The animation happens via CSS transition on
 * the whole container — no Framer dependency in V1 to keep the bundle small.
 */
export function GridCanvas({
  cells,
  axisXInitial,
  axisYInitial,
  axisValues,
}: GridCanvasProps) {
  const router = useRouter();
  const engine = useGridEngine({ axisXInitial, axisYInitial, cells, axisValues });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState<"none" | "br" | "bl">("none");
  const wheelAccum = useRef({ x: 0, y: 0, t: 0 });
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const pinchStart = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  const [pinchScale, setPinchScale] = useState<number>(1);
  const [zoomingOut, setZoomingOut] = useState<boolean>(false);
  const cellViewAt = useRef<number>(Date.now());

  // ── Respect prefers-reduced-motion ──────────────────────────────────────
  // Users who opt out of motion get an instant axis swap instead of a 3D
  // tilt, and the CSS transitions collapse to 0s. Updates live with the
  // media query so toggling the OS setting doesn't require a reload.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // ── Record dwell time per cell for V2 feed tuning ───────────────────────
  useEffect(() => {
    const id = engine.activeCell?.top_kill_id;
    if (!id) return;
    cellViewAt.current = Date.now();
    return () => {
      const dwellMs = Date.now() - cellViewAt.current;
      if (dwellMs > 300) {
        trackGridEvent("grid_cell_view", {
          kill_id: id,
          cell_x: engine.activeCell?.cell_x,
          cell_y: engine.activeCell?.cell_y,
          dwell_ms: dwellMs,
        });
      }
    };
  }, [engine.activeCell?.top_kill_id, engine.activeCell?.cell_x, engine.activeCell?.cell_y]);

  // ── Keyboard nav ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === "INPUT") return;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          engine.move(1, 0);
          break;
        case "ArrowLeft":
          e.preventDefault();
          engine.move(-1, 0);
          break;
        case "ArrowDown":
          e.preventDefault();
          engine.move(0, 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          engine.move(0, -1);
          break;
        case " ":
        case "Spacebar": {
          e.preventDefault();
          runTilt("br");
          engine.swapDiagonal("br");
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [engine]);

  // ── Wheel / trackpad panning with snap after idle ───────────────────────
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      // Prevent page scroll so the grid owns vertical gestures inside it.
      e.preventDefault();
      const now = Date.now();
      const acc = wheelAccum.current;
      if (now - acc.t > 200) {
        acc.x = 0;
        acc.y = 0;
      }
      acc.t = now;
      acc.x += e.deltaX;
      acc.y += e.deltaY;
      const step = 80;
      if (Math.abs(acc.x) > step || Math.abs(acc.y) > step) {
        const dx = Math.abs(acc.x) > step ? (acc.x > 0 ? 1 : -1) : 0;
        const dy = Math.abs(acc.y) > step ? (acc.y > 0 ? 1 : -1) : 0;
        engine.move(dx, dy);
        acc.x = 0;
        acc.y = 0;
      }
    },
    [engine],
  );

  // ── Touch gestures ──────────────────────────────────────────────────────
  // Two-finger pinch-out replaces the tap-to-zoom behaviour on mobile:
  // spreading the fingers past PINCH_TRIGGER_RATIO commits a navigation to
  // /scroll filtered on the active cell's Y axis. While the pinch is in
  // progress the grid scales smoothly to give the gesture haptic-style
  // feedback before commit.
  const PINCH_TRIGGER_RATIO = 1.45;
  const PINCH_FOLLOW_LIMIT = 1.55;

  const distance = (a: React.Touch | Touch, b: React.Touch | Touch) => {
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      pinchStart.current = {
        dist: distance(t1, t2),
        cx: (t1.clientX + t2.clientX) / 2,
        cy: (t1.clientY + t2.clientY) / 2,
      };
      touchStart.current = null;
      return;
    }
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStart.current) {
      e.preventDefault();
      const ratio = distance(e.touches[0], e.touches[1]) / pinchStart.current.dist;
      // Soft-clamp so the grid doesn't fly off-screen on very wide spreads.
      const clamped = Math.min(PINCH_FOLLOW_LIMIT, Math.max(0.85, ratio));
      setPinchScale(reduceMotion ? 1 : clamped);
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (pinchStart.current) {
      // Use the most recently observed scale to decide whether to commit.
      const committed = pinchScale >= PINCH_TRIGGER_RATIO;
      const activeCell = engine.activeCell;
      pinchStart.current = null;
      if (committed && activeCell) {
        // Brief "diving in" animation before route change so the transition
        // feels intentional and not a jarring page swap.
        setZoomingOut(true);
        setPinchScale(1);
        trackGridEvent("grid_cell_zoom_in", {
          kill_id: activeCell.top_kill_id,
          cell_x: activeCell.cell_x,
          cell_y: activeCell.cell_y,
          axis_y: engine.axisY,
          gesture: "pinch",
        });
        const href = buildZoomInHref(activeCell, engine.axisY);
        window.setTimeout(() => router.push(href), 220);
      } else {
        setPinchScale(1);
      }
      return;
    }
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    // Diagonal? both dx and dy are beyond the threshold.
    if (absX > DIAGONAL_SWIPE_THRESHOLD && absY > DIAGONAL_SWIPE_THRESHOLD) {
      if (dx < 0 && dy > 0) {
        runTilt("bl");
        engine.swapDiagonal("bl");
        return;
      }
      if (dx > 0 && dy > 0) {
        runTilt("br");
        engine.swapDiagonal("br");
        return;
      }
    }
    if (absX > 40 || absY > 40) {
      engine.move(
        absX > 40 ? (dx > 0 ? -1 : 1) : 0,
        absY > 40 ? (dy > 0 ? -1 : 1) : 0,
      );
    }
  };

  const runTilt = useCallback(
    (dir: "br" | "bl") => {
      if (reduceMotion) return; // motion-sensitive users get the pivot without the 3D animation
      setTilt(dir);
      setTimeout(() => setTilt("none"), 500);
    },
    [reduceMotion],
  );

  // ── Neighbourhood rendering: 3×3 slice centered on cursor ───────────────
  const neighbourhood = useMemo(() => {
    const out: {
      cell: GridCellData | null;
      x: number;
      y: number;
      xLabel: string;
      yLabel: string;
    }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xIdx = engine.cursorX + dx;
        const yIdx = engine.cursorY + dy;
        const xMeta = engine.xValues[xIdx];
        const yMeta = engine.yValues[yIdx];
        if (!xMeta || !yMeta) {
          out.push({ cell: null, x: dx, y: dy, xLabel: "", yLabel: "" });
          continue;
        }
        const cell = cells.find(
          (c) => c.cell_x === xMeta.value && c.cell_y === yMeta.value,
        ) ?? null;
        out.push({ cell, x: dx, y: dy, xLabel: xMeta.label, yLabel: yMeta.label });
      }
    }
    return out;
  }, [cells, engine.cursorX, engine.cursorY, engine.xValues, engine.yValues]);

  const prevXLabel = engine.xValues[engine.cursorX - 1]?.label;
  const nextXLabel = engine.xValues[engine.cursorX + 1]?.label;
  const prevYLabel = engine.yValues[engine.cursorY - 1]?.label;
  const nextYLabel = engine.yValues[engine.cursorY + 1]?.label;

  return (
    <div className="relative">
      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label={`Grille KCKills — axe horizontal ${GRID_AXES[engine.axisX].label}, axe vertical ${GRID_AXES[engine.axisY].label}`}
        onWheel={handleWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="relative overflow-hidden rounded-3xl border border-[var(--gold)]/20 bg-[var(--bg-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)]"
        style={{
          aspectRatio: "16 / 10",
          maxHeight: "72vh",
          touchAction: "none",
          perspective: "1200px",
        }}
      >
        <div
          className={
            "grid h-full w-full gap-3 p-3 " +
            (reduceMotion ? "" : "transition-transform duration-500")
          }
          style={{
            gridTemplateColumns: "repeat(3, 1fr)",
            gridTemplateRows: "repeat(3, 1fr)",
            transform: (() => {
              if (reduceMotion) return "none";
              if (zoomingOut) return "scale(1.6)";
              if (pinchScale !== 1) return `scale(${pinchScale.toFixed(3)})`;
              if (tilt === "br") return "rotate3d(1, -1, 0, 12deg)";
              if (tilt === "bl") return "rotate3d(-1, -1, 0, 12deg)";
              return "none";
            })(),
            transformOrigin: "center center",
            // While the user is actively pinching we kill the long transition
            // so the grid follows the fingers in real time. Other states keep
            // the smooth cubic-bezier spring.
            transitionDuration:
              pinchScale !== 1 && !zoomingOut ? "60ms" : undefined,
            transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
            opacity: zoomingOut ? 0.4 : 1,
          }}
        >
          {neighbourhood.map((slot, i) => (
            <div key={i} className="relative">
              {slot.cell ? (
                <GridCell
                  cell={slot.cell}
                  active={slot.x === 0 && slot.y === 0}
                  xLabel={slot.xLabel}
                  yLabel={slot.yLabel}
                  axisY={engine.axisY}
                />
              ) : (
                <div className="h-full w-full rounded-2xl border border-dashed border-white/5 bg-white/[0.02]" />
              )}
            </div>
          ))}
        </div>

        <NavIndicator
          axisX={engine.axisX}
          axisY={engine.axisY}
          cellX={engine.xValues[engine.cursorX]?.label ?? null}
          cellY={engine.yValues[engine.cursorY]?.label ?? null}
          prevXLabel={prevXLabel}
          nextXLabel={nextXLabel}
          prevYLabel={prevYLabel}
          nextYLabel={nextYLabel}
        />

        <DirectionHint />
      </div>

      <div className="mt-4">
        <AxisPivot
          axisX={engine.axisX}
          axisY={engine.axisY}
          onChangeX={engine.pivotX}
          onChangeY={engine.pivotY}
        />
      </div>
    </div>
  );
}
