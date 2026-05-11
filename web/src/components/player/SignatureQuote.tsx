/**
 * SignatureQuote — full-width Cinzel italic quote framed by gold rhombus
 * glyphs. Used on the active-player page (always KC gold) and on the
 * alumni page (era-accent color via the `accent` prop).
 *
 * Server component (no client state). Honors the design system :
 *   - font-display = display serif (Oswald/Cinzel-style on this site)
 *   - rhombus glyphs ◆ as ornaments
 *   - 2 px gold border-top on the panel ("border-gold-top" pattern)
 */
export function SignatureQuote({
  text,
  author,
  role,
  source,
  accent = "var(--gold)",
}: {
  text: string;
  author: string;
  /** Optional role / title shown next to the author. */
  role?: string;
  /** Optional source line shown small under the attribution. */
  source?: string;
  /** Hex / CSS color for the accent. Defaults to KC gold. */
  accent?: string;
}) {
  return (
    <figure
      className="relative mx-auto max-w-4xl px-4 py-12 md:py-16"
      aria-label={`Citation de ${author}`}
    >
      {/* Top gold rhombus ornament */}
      <div className="flex items-center justify-center gap-3 mb-8" aria-hidden>
        <span className="h-px w-12 md:w-20" style={{ background: accent, opacity: 0.4 }} />
        <span className="text-2xl md:text-3xl leading-none" style={{ color: accent }}>
          ◆
        </span>
        <span className="h-px w-12 md:w-20" style={{ background: accent, opacity: 0.4 }} />
      </div>

      {/* The quote itself — Cinzel-like display + italic + huge */}
      <blockquote
        className="font-display italic font-bold text-center text-2xl md:text-4xl lg:text-5xl leading-tight text-[var(--text-primary)]"
        style={{
          textShadow: `0 0 40px ${accent}30`,
          letterSpacing: "-0.005em",
        }}
      >
        <span
          className="block text-5xl md:text-6xl leading-none mb-2 opacity-40"
          aria-hidden
          style={{ color: accent }}
        >
          &laquo;
        </span>
        {text}
        <span
          className="block text-5xl md:text-6xl leading-none mt-2 opacity-40"
          aria-hidden
          style={{ color: accent }}
        >
          &raquo;
        </span>
      </blockquote>

      {/* Attribution */}
      <figcaption className="mt-8 text-center">
        <div className="inline-flex items-center gap-3 flex-wrap justify-center">
          <span className="h-px w-6" style={{ background: accent, opacity: 0.5 }} aria-hidden />
          <cite
            className="font-display not-italic font-black uppercase tracking-[0.18em] text-sm md:text-base"
            style={{ color: accent }}
          >
            {author}
          </cite>
          {role && (
            <span className="font-data text-[10px] md:text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">
              · {role}
            </span>
          )}
          <span className="h-px w-6" style={{ background: accent, opacity: 0.5 }} aria-hidden />
        </div>
        {source && (
          <p className="mt-3 font-data text-[10px] uppercase tracking-[0.2em] text-[var(--text-disabled)]">
            {source}
          </p>
        )}
      </figcaption>

      {/* Bottom rhombus ornament */}
      <div className="flex items-center justify-center gap-2 mt-8" aria-hidden>
        <span className="text-xs leading-none" style={{ color: accent, opacity: 0.4 }}>
          ◆
        </span>
        <span className="text-base leading-none" style={{ color: accent, opacity: 0.7 }}>
          ◆
        </span>
        <span className="text-xs leading-none" style={{ color: accent, opacity: 0.4 }}>
          ◆
        </span>
      </div>
    </figure>
  );
}
