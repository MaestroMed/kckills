import Link from "next/link";

export interface PrevNextEntity {
  slug: string;
  name: string;
  /** Short period label or subtitle — "2022", "ADC · 2026". */
  subtitle: string;
  /** Hex accent color used for the chevron + border highlight. */
  accentColor: string;
  /** Base href — defaults to `/player/[slug]`. Set to `/alumni/${slug}` for alumni. */
  href?: string;
}

/**
 * PrevNextNavCard — paired prev/next navigation card used at the bottom
 * of both /player/[slug] and /alumni/[slug]. Honors `direction` to flip
 * the chevron and align the label.
 */
export function PrevNextNavCard({
  direction,
  entity,
  basePath = "/player/",
  variant = "alumni",
}: {
  direction: "prev" | "next";
  entity: PrevNextEntity;
  basePath?: string;
  /** "alumni" or "active". Controls the eyebrow copy. */
  variant?: "alumni" | "active";
}) {
  const href = entity.href ?? `${basePath}${encodeURIComponent(entity.slug)}`;
  const accent = entity.accentColor;
  const eyebrow =
    variant === "alumni"
      ? direction === "prev"
        ? "Alumni precedent"
        : "Alumni suivant"
      : direction === "prev"
        ? "Joueur precedent"
        : "Joueur suivant";

  return (
    <Link
      href={href}
      aria-label={`${eyebrow} : ${entity.name}`}
      className={`group flex items-center gap-5 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 transition-all hover:border-[var(--gold)]/50 hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-[var(--gold)]/15 focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2 ${
        direction === "next" ? "md:text-right md:flex-row-reverse" : ""
      }`}
    >
      <div
        className="h-12 w-12 shrink-0 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110"
        style={{
          backgroundColor: `${accent}1A`,
          border: `1px solid ${accent}55`,
        }}
        aria-hidden
      >
        <svg
          className="h-5 w-5"
          style={{ color: accent }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
            d={direction === "prev" ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"}
          />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          {eyebrow}
        </p>
        <p className="font-display text-2xl md:text-3xl font-black text-[var(--text-primary)] group-hover:text-[var(--gold)] transition-colors truncate">
          {entity.name}
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-1 truncate">{entity.subtitle}</p>
      </div>
    </Link>
  );
}
