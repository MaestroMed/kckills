"use client";

interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  fillOpacity?: number;
}

/**
 * Sparkline — minimal inline SVG line chart.
 * Renders a single-line trend over the last N values.
 */
export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = "var(--gold)",
  className = "",
  fillOpacity = 0.2,
}: Props) {
  if (data.length === 0) {
    return <svg width={width} height={height} className={className} />;
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePath = `M ${points.join(" L ")}`;
  const fillPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  return (
    <svg width={width} height={height} className={className} preserveAspectRatio="none">
      <path d={fillPath} fill={color} fillOpacity={fillOpacity} />
      <path d={linePath} stroke={color} strokeWidth={1.5} fill="none" strokeLinejoin="round" />
      {/* Last point dot */}
      <circle
        cx={(data.length - 1) / (data.length - 1 || 1) * width}
        cy={height - ((data[data.length - 1] - min) / range) * height}
        r={2}
        fill={color}
      />
    </svg>
  );
}
