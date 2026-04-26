"use client";

import { useId } from "react";

interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  fillOpacity?: number;
  /** When true, draws a smooth Catmull-Rom-ish bezier instead of polyline. */
  smooth?: boolean;
  /** When true, fills the area under the curve with a vertical gradient. */
  gradient?: boolean;
  /** Show the trailing point dot. Defaults to true. */
  showDot?: boolean;
}

/**
 * Sparkline — minimal inline SVG line chart.
 *
 * V2 (PR-arch P2) adds:
 *   - `smooth: true`     → bezier-curve path instead of polyline
 *   - `gradient: true`   → vertical gradient under the line
 *   - `showDot: false`   → omit the trailing dot for dense rows
 *
 * Defaults preserve the V1 visual contract (polyline + dot + flat fill)
 * so existing callers don't have to change.
 */
export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = "var(--gold)",
  className = "",
  fillOpacity = 0.2,
  smooth = false,
  gradient = false,
  showDot = true,
}: Props) {
  const gradientId = useId();

  if (data.length === 0) {
    return <svg width={width} height={height} className={className} aria-hidden="true" />;
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const pts: { x: number; y: number }[] = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * width;
    const y = height - ((v - min) / range) * height;
    return { x, y };
  });

  // Path builder — polyline OR smooth bezier (Catmull-Rom approximation).
  // Tension 0.5 is the safe default that doesn't overshoot data extremes.
  let linePath: string;
  if (!smooth || pts.length < 3) {
    linePath = `M ${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")}`;
  } else {
    const segments: string[] = [`M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      // Catmull-Rom → cubic bezier conversion (tension = 0.5).
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      segments.push(
        `C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
      );
    }
    linePath = segments.join(" ");
  }

  const fillPath = `${linePath} L ${width.toFixed(1)},${height} L 0,${height} Z`;
  const fillRef = gradient ? `url(#${gradientId})` : color;
  const lastPoint = pts[pts.length - 1];

  return (
    <svg
      width={width}
      height={height}
      className={className}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {gradient ? (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={fillOpacity * 1.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
      ) : null}
      <path d={fillPath} fill={fillRef} fillOpacity={gradient ? 1 : fillOpacity} />
      <path
        d={linePath}
        stroke={color}
        strokeWidth={1.5}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {showDot && lastPoint ? (
        <circle cx={lastPoint.x} cy={lastPoint.y} r={2} fill={color} />
      ) : null}
    </svg>
  );
}
