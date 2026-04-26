import type { ReactNode } from "react";

export type AdminBadgeVariant =
  | "success"
  | "warn"
  | "danger"
  | "neutral"
  | "info"
  | "pending";

export type AdminBadgeSize = "sm" | "md";

interface Props {
  children: ReactNode;
  variant?: AdminBadgeVariant;
  size?: AdminBadgeSize;
  /** Optional leading icon / glyph. Pass a single character or small node. */
  icon?: ReactNode;
  /** Subtle pulse animation — useful for "running" / "live" states. */
  pulse?: boolean;
  className?: string;
  title?: string;
}

const VARIANTS: Record<
  AdminBadgeVariant,
  { color: string; border: string; bg: string }
> = {
  success: { color: "var(--green)", border: "var(--green)", bg: "var(--green)" },
  warn: { color: "var(--orange)", border: "var(--orange)", bg: "var(--orange)" },
  danger: { color: "var(--red)", border: "var(--red)", bg: "var(--red)" },
  neutral: {
    color: "var(--text-muted)",
    border: "var(--text-muted)",
    bg: "var(--text-muted)",
  },
  info: { color: "var(--cyan)", border: "var(--cyan)", bg: "var(--cyan)" },
  pending: { color: "var(--gold)", border: "var(--gold)", bg: "var(--gold)" },
};

/**
 * AdminBadge — semantic status pill for admin tables, cards, headers.
 *
 * Replaces the patchwork of one-off `<span class="rounded-full bg-...">`
 * pills scattered across pipeline / moderation / clips. Variants map to
 * the design-system semantic colors (green / orange / red / cyan / gold).
 *
 * For pipeline-specific statuses ("clipping", "vod_found", ...), keep
 * using the existing `<StatusPill>` — it knows the full status taxonomy.
 * AdminBadge is for ad-hoc semantic flags ("active", "draft", "archived").
 */
export function AdminBadge({
  children,
  variant = "neutral",
  size = "sm",
  icon,
  pulse = false,
  className = "",
  title,
}: Props) {
  const v = VARIANTS[variant];
  const sizeCls =
    size === "sm"
      ? "px-2 py-0.5 text-[9px]"
      : "px-2.5 py-1 text-[11px]";
  const animate = pulse ? "animate-pulse" : "";

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border font-bold uppercase tracking-widest ${sizeCls} ${animate} ${className}`}
      style={{
        color: v.color,
        borderColor: `${v.border}60`,
        backgroundColor: `${v.bg}20`,
      }}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span>{children}</span>
    </span>
  );
}
