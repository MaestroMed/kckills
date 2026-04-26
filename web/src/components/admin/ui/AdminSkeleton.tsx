import type { CSSProperties } from "react";

export type AdminSkeletonVariant = "text" | "card" | "row" | "circle" | "block";

interface Props {
  variant?: AdminSkeletonVariant;
  /** For variant="text" / "row" → repeat the placeholder N times. */
  count?: number;
  /** Override width (CSS length). Default depends on variant. */
  width?: string;
  /** Override height. Default depends on variant. */
  height?: string;
  /** rounded-* class override (e.g. "rounded-full"). */
  rounded?: string;
  className?: string;
  /** Additional inline styles. Useful for bespoke aspect ratios. */
  style?: CSSProperties;
}

/**
 * AdminSkeleton — shimmer placeholders for loading admin UI.
 *
 * Variants:
 *   text   → single line of text (height 14px, width 100% by default)
 *   card   → card-shaped block (h-32, full width, rounded-xl)
 *   row    → 1-row table-shaped block (h-12), repeats with `count`
 *   circle → avatar / icon (h-10 w-10 rounded-full)
 *   block  → free-form block, set your own width/height
 *
 * Uses the shared `skel-hextech` class from globals.css → already
 * honours `prefers-reduced-motion` (animation disabled, dim block
 * fallback).
 */
export function AdminSkeleton({
  variant = "text",
  count = 1,
  width,
  height,
  rounded,
  className = "",
  style,
}: Props) {
  const items = Array.from({ length: Math.max(1, count) }, (_, i) => i);

  return (
    <div
      role="status"
      aria-label="Chargement"
      aria-live="polite"
      aria-busy="true"
      className={
        variant === "row" || (variant === "text" && count > 1)
          ? `space-y-2 ${className}`
          : className
      }
    >
      {items.map((i) => (
        <SkeletonBlock
          key={i}
          variant={variant}
          width={width}
          height={height}
          rounded={rounded}
          style={style}
        />
      ))}
    </div>
  );
}

function SkeletonBlock({
  variant,
  width,
  height,
  rounded,
  style,
}: {
  variant: AdminSkeletonVariant;
  width?: string;
  height?: string;
  rounded?: string;
  style?: CSSProperties;
}) {
  const defaults = DEFAULTS[variant];
  const cls = `skel-hextech ${rounded ?? defaults.rounded}`;
  return (
    <div
      className={cls}
      style={{
        width: width ?? defaults.width,
        height: height ?? defaults.height,
        ...style,
      }}
    />
  );
}

const DEFAULTS: Record<
  AdminSkeletonVariant,
  { width: string; height: string; rounded: string }
> = {
  text: { width: "100%", height: "14px", rounded: "rounded-md" },
  card: { width: "100%", height: "8rem", rounded: "rounded-xl" },
  row: { width: "100%", height: "3rem", rounded: "rounded-md" },
  circle: { width: "2.5rem", height: "2.5rem", rounded: "rounded-full" },
  block: { width: "100%", height: "100%", rounded: "rounded-md" },
};
