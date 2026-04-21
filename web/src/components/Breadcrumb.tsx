import Link from "next/link";

/**
 * Breadcrumb — unified navigation trail.
 *
 * Used on pages that sit below the top nav (everything except the
 * homepage and /scroll immersive). Each segment is a {label, href} pair;
 * the last one renders as the current-page text without a link.
 *
 * The diamond separator ◆ is rendered via a JSX-safe {"\u25C6"} form to
 * avoid the bare-text bug where `>\u25C6<` shows literal "\u25C6" in
 * some configs.
 *
 * Server component — zero JS.
 */
export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Fil d'Ariane"
      className="flex items-center gap-2 text-sm text-[var(--text-muted)]"
    >
      {items.map((c, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={`${c.label}-${i}`} className="flex items-center gap-2">
            {c.href && !isLast ? (
              <Link href={c.href} className="hover:text-[var(--gold)] transition-colors">
                {c.label}
              </Link>
            ) : (
              <span className={isLast ? "text-[var(--gold)]" : ""}>{c.label}</span>
            )}
            {!isLast && <span className="text-[var(--gold)]/30">{"\u25C6"}</span>}
          </span>
        );
      })}
    </nav>
  );
}
