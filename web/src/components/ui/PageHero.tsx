import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

interface Crumb {
  label: string;
  href?: string;
}

interface Tag {
  /** Short uppercase pill text (e.g. "TOP LANE", "Spring 2026"). */
  label: string;
  /** Optional accent colour override. Falls back to `accent` then gold. */
  color?: string;
}

type HeroVariant = "standard" | "cinematic" | "compact";

interface PageHeroProps {
  /** Required title — rendered as the H1 with shimmer treatment. */
  title: string;
  subtitle?: string;
  crumbs?: Crumb[];
  badge?: string;
  /** Tag pill placed above the title (era phase, alumni role, etc.). */
  tag?: Tag;
  /** Background image (local /public path or whitelisted remote URL). */
  backgroundSrc?: string;
  /** Layered second background — used by the alumni hero (splash + portrait). */
  backgroundOverlaySrc?: string;
  /** Accent colour applied to glows, tag fallback, and the radial overlay. */
  accent?: string;
  /** Slot below the subtitle (CTAs, stat strips, etc.). */
  children?: ReactNode;
  /** Slot pinned to the top-right (era prev/next chips). */
  topRight?: ReactNode;
  /** Renders the bouncing arrow at the bottom in cinematic mode. */
  scrollHint?: boolean | string;
  /**
   * standard: centered marketing hero (~50vh)
   * cinematic: full-screen story hero (~85vh, content bottom-aligned)
   * compact:   slim secondary-page hero (~36vh)
   */
  variant?: HeroVariant;
}

const VARIANT_CLASSES: Record<HeroVariant, string> = {
  standard: "min-h-[50vh] py-20 items-center",
  compact: "min-h-[36vh] py-12 items-center",
  cinematic: "min-h-[640px] h-[85vh] items-end pb-16 pt-24",
};

/**
 * The single hero primitive used across KCKILLS pages.
 *
 * - `standard` is the homepage / records / hall-of-fame language: centered
 *   shimmer title with optional badge + subtitle.
 * - `cinematic` is the long-form story language used on `/era/[id]` and
 *   `/alumni/[slug]`: full-screen background, accent glow, bottom-aligned
 *   typography, optional scroll hint and top-right slot for nav chips.
 * - `compact` keeps the primitive available for inner pages that just need
 *   a styled banner (settings, internal tools).
 */
export function PageHero({
  title,
  subtitle,
  crumbs,
  badge,
  tag,
  backgroundSrc,
  backgroundOverlaySrc,
  accent,
  children,
  topRight,
  scrollHint,
  variant = "standard",
}: PageHeroProps) {
  const cinematic = variant === "cinematic";
  const tagColor = tag?.color ?? accent ?? "var(--gold)";

  return (
    <section
      className={`relative flex justify-center overflow-hidden px-6 md:px-16 ${VARIANT_CLASSES[variant]}`}
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
          className={
            cinematic
              ? "object-cover scale-110"
              : "object-cover opacity-30 scale-110"
          }
          style={cinematic ? { filter: "brightness(0.45) saturate(1.05)" } : { filter: "blur(2px)" }}
        />
      ) : null}
      {backgroundOverlaySrc ? (
        <Image
          src={backgroundOverlaySrc}
          alt=""
          fill
          sizes="100vw"
          className="object-cover scale-105 opacity-30 blur-2xl"
        />
      ) : null}

      <div
        className={
          cinematic
            ? "absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)]/55 to-transparent"
            : "absolute inset-0 bg-gradient-to-b from-[var(--bg-primary)] via-[var(--bg-primary)]/60 to-[var(--bg-primary)]"
        }
      />
      <div
        className={
          cinematic
            ? "absolute inset-0 bg-gradient-to-r from-[var(--bg-primary)]/85 via-transparent to-[var(--bg-primary)]/55"
            : "absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-black/60"
        }
      />
      {accent ? (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 60% 45% at ${
              cinematic ? "25% 65%" : "50% 45%"
            }, ${accent}28 0%, transparent 60%)`,
          }}
          aria-hidden
        />
      ) : null}
      {/* Subtle scanline texture — mirrors the homepage hero. */}
      <div
        className="absolute inset-0 opacity-[0.18] mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.08) 3px, transparent 4px)",
        }}
        aria-hidden
      />

      {topRight ? (
        <div className="absolute top-6 right-6 z-20 flex items-center gap-2">
          {topRight}
        </div>
      ) : null}

      <div
        className={`relative z-10 ${
          cinematic
            ? "w-full max-w-7xl mx-auto text-left"
            : "max-w-4xl mx-auto text-center"
        }`}
      >
        {crumbs && crumbs.length > 0 ? (
          <nav
            aria-label="Fil d'Ariane"
            className={`mb-6 flex items-center gap-2 text-xs text-white/55 ${
              cinematic ? "" : "justify-center"
            }`}
          >
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="flex items-center gap-2">
                {c.href ? (
                  <Link href={c.href} className="hover:text-[var(--gold)] transition-colors">
                    {c.label}
                  </Link>
                ) : (
                  <span style={{ color: accent ?? "var(--gold)" }}>{c.label}</span>
                )}
                {i < crumbs.length - 1 ? (
                  <span aria-hidden className="text-white/25">
                    {"\u25C6"}
                  </span>
                ) : null}
              </span>
            ))}
          </nav>
        ) : null}

        {tag ? (
          <div className={`mb-4 ${cinematic ? "" : "flex justify-center"}`}>
            <span
              className="rounded-md px-3 py-1 font-data text-[11px] font-bold tracking-[0.25em] uppercase border backdrop-blur-sm"
              style={{
                color: tagColor,
                backgroundColor: `${tagColor}15`,
                borderColor: `${tagColor}45`,
              }}
            >
              {tag.label}
            </span>
          </div>
        ) : null}

        {badge ? (
          <div className={`mb-6 ${cinematic ? "" : "flex justify-center"}`}>
            <span
              className="inline-flex items-center rounded-full border bg-black/55 backdrop-blur-sm px-4 py-1.5 text-[11px] font-bold tracking-[0.2em] uppercase"
              style={{
                color: accent ?? "var(--gold)",
                borderColor: `${accent ?? "var(--gold)"}55`,
              }}
            >
              {badge}
            </span>
          </div>
        ) : null}

        <h1
          className={`font-display font-black tracking-tight leading-[0.85] mb-5 ${
            cinematic
              ? "text-6xl md:text-8xl lg:text-[9rem]"
              : "text-5xl md:text-7xl lg:text-8xl"
          }`}
          style={
            cinematic && accent
              ? {
                  color: "white",
                  textShadow: `0 0 60px ${accent}55, 0 6px 30px rgba(0,0,0,0.7)`,
                  letterSpacing: "-0.015em",
                }
              : undefined
          }
        >
          {cinematic ? (
            title
          ) : (
            <span className="hero-title-glow">
              <span className="text-shimmer">{title}</span>
            </span>
          )}
        </h1>

        {subtitle ? (
          <p
            className={`text-base md:text-lg font-medium leading-relaxed ${
              cinematic
                ? "max-w-2xl text-white/80"
                : "max-w-2xl mx-auto text-white/80"
            }`}
          >
            {subtitle}
          </p>
        ) : null}

        {children ? (
          <div className={cinematic ? "mt-8" : "mt-8"}>{children}</div>
        ) : null}
      </div>

      {scrollHint && cinematic ? (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 text-white/35"
          aria-hidden
        >
          <span className="text-[10px] uppercase tracking-[0.3em]">
            {typeof scrollHint === "string" ? scrollHint : "Dérouler"}
          </span>
          <svg
            className="h-4 w-4 animate-bounce motion-reduce:animate-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </div>
      ) : null}
    </section>
  );
}
