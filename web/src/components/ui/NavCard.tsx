import Link from "next/link";
import type { ReactNode } from "react";

interface NavCardProps {
  href: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  badge?: string;
}

/**
 * Navigation card with icon + title + description + arrow. Used across
 * index pages (players, matches, homepage secondary nav) so every link tile
 * shares the same hover state and gold border treatment.
 */
export function NavCard({ href, title, description, icon, badge }: NavCardProps) {
  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-2xl border border-[var(--gold)]/15 bg-[var(--bg-surface)] p-5 transition-all hover:border-[var(--gold)]/50 hover:bg-[var(--bg-elevated)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {icon ? <div className="mb-3 text-2xl opacity-80">{icon}</div> : null}
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-bold text-white group-hover:text-[var(--gold)] transition-colors">
              {title}
            </h3>
            {badge ? (
              <span className="rounded-full border border-[var(--gold)]/30 bg-[var(--gold)]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[var(--gold)]">
                {badge}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-2 text-sm text-white/60 leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        <span
          aria-hidden
          className="mt-1 text-lg text-[var(--gold)]/50 group-hover:translate-x-1 group-hover:text-[var(--gold)] transition-all"
        >
          {"\u2192"}
        </span>
      </div>
    </Link>
  );
}
