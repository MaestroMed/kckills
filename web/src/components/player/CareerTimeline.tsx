import type { AlumniCareerStep } from "@/lib/alumni";

/**
 * CareerTimeline — vertical frieze of clubs the player traversed.
 * KC entries are highlighted with the era accent color ; non-KC clubs
 * use a calmer monochrome neutral.
 *
 * Reads top-to-bottom chronologically.
 */
export function CareerTimeline({
  career,
  accent = "var(--gold)",
}: {
  career: AlumniCareerStep[];
  /** Accent color used for KC entries. */
  accent?: string;
}) {
  if (career.length === 0) return null;

  return (
    <ol className="relative space-y-4 pl-6 md:pl-8" aria-label="Carriere professionnelle">
      {/* Vertical line */}
      <span
        aria-hidden
        className="absolute left-1.5 md:left-2.5 top-2 bottom-2 w-px"
        style={{
          background: `linear-gradient(180deg, transparent, ${accent}, transparent)`,
          opacity: 0.6,
        }}
      />
      {career.map((step, i) => {
        const isFirst = i === 0;
        const isLast = i === career.length - 1;
        return (
          <li key={`${step.club}-${i}`} className="relative">
            {/* Marker */}
            <span
              aria-hidden
              className="absolute -left-[22px] md:-left-[26px] top-2 flex h-3 w-3 md:h-4 md:w-4 items-center justify-center"
            >
              {step.isKC ? (
                <span
                  className="block h-3 w-3 md:h-4 md:w-4 rotate-45"
                  style={{
                    background: accent,
                    boxShadow: `0 0 16px ${accent}, 0 0 32px ${accent}66`,
                  }}
                />
              ) : (
                <span
                  className="block h-2 w-2 md:h-2.5 md:w-2.5 rotate-45"
                  style={{
                    background: "var(--text-disabled)",
                    border: "1px solid rgba(255,255,255,0.2)",
                  }}
                />
              )}
            </span>

            <div
              className={`rounded-xl p-4 md:p-5 transition-all ${
                step.isKC
                  ? "border-2 bg-[var(--bg-elevated)]"
                  : "border border-[var(--border-gold)] bg-[var(--bg-surface)]/50"
              }`}
              style={
                step.isKC
                  ? { borderColor: accent, boxShadow: `0 0 30px ${accent}20` }
                  : undefined
              }
            >
              <div className="flex items-baseline gap-3 flex-wrap">
                <h4
                  className={`font-display text-base md:text-lg font-black uppercase leading-tight tracking-tight ${
                    step.isKC ? "" : "text-[var(--text-primary)]"
                  }`}
                  style={step.isKC ? { color: accent } : undefined}
                >
                  {step.club}
                </h4>
                <span
                  className={`font-data text-[10px] uppercase tracking-[0.22em] ${
                    step.isKC ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                  }`}
                >
                  {step.role}
                </span>
              </div>
              <p className="font-data text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)] mt-1">
                {step.period}
              </p>
              {step.note && (
                <p className="mt-2 text-sm text-[var(--text-secondary)]">{step.note}</p>
              )}
              {step.isKC && (
                <p className="mt-2 inline-flex items-center gap-2 text-[10px] font-display font-black uppercase tracking-widest" style={{ color: accent }}>
                  <span>◆</span> Karmine Corp
                </p>
              )}
            </div>

            {/* Optional connectors — show first/last hints */}
            {isFirst && (
              <span className="sr-only" aria-hidden>
                Debut de carriere
              </span>
            )}
            {isLast && (
              <span className="sr-only" aria-hidden>
                Etape actuelle
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
