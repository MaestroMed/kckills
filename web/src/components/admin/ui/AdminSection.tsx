import type { ReactNode } from "react";

interface Props {
  /** Section heading. */
  title: ReactNode;
  /** Sub-heading on a second line under the title. */
  subtitle?: ReactNode;
  /** Right-aligned slot for actions (filter chips, refresh, view-all link). */
  action?: ReactNode;
  /** Section content. */
  children: ReactNode;
  /** Tighter vertical spacing for stacked-section pages. */
  dense?: boolean;
  className?: string;
  id?: string;
}

/**
 * AdminSection — logical block within an AdminPage.
 *
 * Standardises spacing between the title row and the section body. Use one
 * AdminSection per logical block on a page (e.g. "Recent failures",
 * "Throughput by module", "Audit log"). Pages with many sections stack
 * naturally with `<div className="space-y-8">`.
 */
export function AdminSection({
  title,
  subtitle,
  action,
  children,
  dense = false,
  className = "",
  id,
}: Props) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={`${dense ? "space-y-3" : "space-y-4"} ${className}`}
    >
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2
            id={id ? `${id}-title` : undefined}
            className="font-display text-lg font-bold uppercase tracking-wide text-[var(--text-primary)]"
          >
            {title}
          </h2>
          {subtitle ? (
            <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div>{children}</div>
    </section>
  );
}
