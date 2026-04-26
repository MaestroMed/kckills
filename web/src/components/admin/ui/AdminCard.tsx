import type { ReactNode, HTMLAttributes } from "react";

export type AdminCardVariant = "default" | "compact" | "dense";
export type AdminCardTone = "neutral" | "good" | "warn" | "bad" | "info";

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  children: ReactNode;
  variant?: AdminCardVariant;
  /** Optional tone — colors the border + a thin top accent. */
  tone?: AdminCardTone;
  /** Optional title slot (rendered inside a small header row). */
  title?: ReactNode;
  /** Optional title-row trailing slot (counts, action chips, ...). */
  titleAction?: ReactNode;
  /** Add a subtle hover lift — for cards that are clickable wrappers. */
  hoverable?: boolean;
}

const PADDING: Record<AdminCardVariant, string> = {
  default: "p-5",
  compact: "p-3",
  dense: "p-0",
};

const TONES: Record<AdminCardTone, string> = {
  neutral: "border-[var(--border-gold)]",
  good: "border-[var(--green)]/40",
  warn: "border-[var(--orange)]/40",
  bad: "border-[var(--red)]/40",
  info: "border-[var(--cyan)]/40",
};

/**
 * AdminCard — generic chrome wrapper for any admin block that isn't a KPI.
 *
 * Mirrors the `KpiTile` chrome (rounded-xl + border + bg-surface) so every
 * admin block looks like it belongs to the same family. Three padding
 * variants:
 *
 *   default → p-5 — most blocks (forms, lists, charts)
 *   compact → p-3 — sidebar widgets, small summary blocks
 *   dense   → p-0 — when the child is a table that already has its own
 *                   row padding (the card just provides the border)
 *
 * Optional title row puts the heading + an optional trailing slot
 * (counts, refresh button, "view all" link) on the same line, so callers
 * don't reinvent it.
 */
export function AdminCard({
  children,
  variant = "default",
  tone = "neutral",
  title,
  titleAction,
  hoverable = false,
  className = "",
  ...rest
}: Props) {
  const hoverCls = hoverable
    ? "transition-colors hover:border-[var(--gold)]/40 hover:bg-[var(--bg-elevated)]/40"
    : "";

  return (
    <div
      className={`rounded-xl border ${TONES[tone]} bg-[var(--bg-surface)] ${hoverCls} ${className}`}
      {...rest}
    >
      {title ? (
        <header
          className={`flex items-center justify-between gap-3 border-b border-[var(--border-gold)] ${
            variant === "dense" ? "px-4 py-3" : "pb-3 mb-3 -mx-1"
          }`}
          style={variant === "dense" ? undefined : { marginInline: 0 }}
        >
          <h3 className="font-display text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
            {title}
          </h3>
          {titleAction ? <div className="shrink-0">{titleAction}</div> : null}
        </header>
      ) : null}
      <div className={title ? PADDING_BODY[variant] : PADDING[variant]}>{children}</div>
    </div>
  );
}

/**
 * When a title is rendered, the body padding shifts so the title's own
 * padding doesn't double up.
 */
const PADDING_BODY: Record<AdminCardVariant, string> = {
  default: "px-5 pb-5",
  compact: "px-3 pb-3",
  dense: "p-0",
};
