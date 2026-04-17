import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

interface Crumb {
  label: string;
  href?: string;
}

interface PageHeroProps {
  badge?: string;
  title: string;
  subtitle?: string;
  crumbs?: Crumb[];
  /** Local image in /public (e.g. `/images/hero-bg.jpg`). Rendered with
   *  `next/image` + blur + overlay gradient so every hero matches the
   *  homepage language. */
  backgroundSrc?: string;
  children?: ReactNode;
  /** Tighten vertical padding for inner-page heroes. */
  compact?: boolean;
}

/**
 * The hero block the homepage sets as the "gold standard" for KCKILLS.
 * Secondary pages (records, hall-of-fame, era/[id], alumni/[slug]) use this
 * primitive so they inherit the gradient, breadcrumb, badge, and shimmer
 * without each page reinventing the markup.
 */
export function PageHero({
  badge,
  title,
  subtitle,
  crumbs,
  backgroundSrc,
  children,
  compact = false,
}: PageHeroProps) {
  return (
    <section
      className={`relative flex items-center justify-center overflow-hidden px-6 md:px-16 ${
        compact ? "min-h-[36vh] py-12" : "min-h-[50vh] py-20"
      }`}
      style={{
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      {backgroundSrc ? (
        <Image
          src={backgroundSrc}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-30 scale-110"
          style={{ filter: "blur(2px)" }}
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-primary)] via-[var(--bg-primary)]/60 to-[var(--bg-primary)]" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-black/60" />

      <div className="relative z-10 text-center max-w-4xl">
        {crumbs && crumbs.length > 0 ? (
          <nav
            aria-label="Fil d'Ariane"
            className="mb-6 flex items-center justify-center gap-2 text-xs text-white/50"
          >
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="flex items-center gap-2">
                {c.href ? (
                  <Link href={c.href} className="hover:text-[var(--gold)]">
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-[var(--gold)]">{c.label}</span>
                )}
                {i < crumbs.length - 1 ? (
                  <span aria-hidden className="text-[var(--gold)]/30">
                    {"\u25C6"}
                  </span>
                ) : null}
              </span>
            ))}
          </nav>
        ) : null}

        {badge ? (
          <div className="inline-flex items-center gap-3 mb-6">
            <span className="rounded-full border border-[var(--gold)]/30 bg-black/50 backdrop-blur-sm px-4 py-1.5 text-[11px] font-bold tracking-[0.2em] uppercase text-[var(--gold)]">
              {badge}
            </span>
          </div>
        ) : null}

        <h1 className="font-display font-black tracking-tight leading-[0.82] text-5xl md:text-7xl lg:text-8xl mb-5">
          <span className="hero-title-glow">
            <span className="text-shimmer">{title}</span>
          </span>
        </h1>

        {subtitle ? (
          <p className="max-w-2xl mx-auto text-base md:text-lg text-white/80 font-medium leading-relaxed">
            {subtitle}
          </p>
        ) : null}

        {children ? <div className="mt-8">{children}</div> : null}
      </div>
    </section>
  );
}
