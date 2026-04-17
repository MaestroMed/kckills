/**
 * Client-only analytics for the Scroll Vivant grid.
 *
 * V1 collects every axis pivot, cell view, and scroll direction via Umami
 * custom events. V2 (post-launch) will feed these into an adaptive
 * algorithm that remaps the axis pool per user — for now they are
 * aggregate-only signals.
 *
 * Safe to call from any client component: no-ops when Umami isn't loaded.
 */

type UmamiFn = (event: string, data?: Record<string, unknown>) => void;

interface UmamiWindow extends Window {
  umami?: UmamiFn | { track: UmamiFn };
}

export type GridEventName =
  | "grid_axis_pivot"
  | "grid_cell_view"
  | "grid_cell_zoom_in"
  | "grid_scroll_direction";

export function trackGridEvent(
  event: GridEventName,
  data?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  const w = window as UmamiWindow;
  const u = w.umami;
  if (!u) return;
  try {
    if (typeof u === "function") {
      u(event, data);
    } else if (typeof u.track === "function") {
      u.track(event, data);
    }
  } catch {
    // Analytics failures must never break the UI.
  }
}
