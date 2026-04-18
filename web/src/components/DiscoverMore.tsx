import Link from "next/link";

/**
 * DiscoverMore — small, reusable cross-link strip rendered at the bottom
 * of the clip-centric landing pages (/multikills, /first-bloods,
 * /matchups, /champions, /recent, /best). Each tile points to one of the
 * sibling browseable surfaces so users orbit between them naturally
 * instead of bouncing back to the homepage.
 *
 * Pass `excludeHrefs` so the page hosting it doesn't link to itself.
 */

interface Tile {
  href: string;
  label: string;
  blurb: string;
  accent: string;
  /** Single-character glyph used as the visual mark — keeps the strip
   *  weightless without requiring icon imports. */
  glyph: string;
}

const ALL_TILES: Tile[] = [
  { href: "/scroll",       label: "Scroll feed",   blurb: "Mode TikTok plein \u00e9cran", accent: "var(--gold)",   glyph: "\u25BC" },
  { href: "/best",         label: "Meilleurs",     blurb: "Curation IA + comm.",      accent: "var(--gold)",   glyph: "\u2605" },
  { href: "/multikills",   label: "Multi-kills",   blurb: "Pentas, quadras, triples", accent: "var(--orange)", glyph: "\u272E" },
  { href: "/first-bloods", label: "First Bloods",  blurb: "Le tempo des games",       accent: "var(--red)",    glyph: "\u2620" },
  { href: "/matchups",     label: "Match-ups",     blurb: "Confrontations champ vs champ", accent: "var(--cyan)", glyph: "\u2693" },
  { href: "/champions",    label: "Champions",     blurb: "Browse par champion",      accent: "var(--blue-kc)", glyph: "\u2756" },
  { href: "/recent",       label: "Derniers",      blurb: "Chronologique",            accent: "var(--green)",  glyph: "\u29BF" },
  { href: "/sphere",       label: "Sphere 3D",     blurb: "Mode immersif",            accent: "var(--gold)",   glyph: "\u29BB" },
];

export function DiscoverMore({
  excludeHrefs = [],
  title = "Continuer l'exploration",
  limit = 4,
}: {
  excludeHrefs?: string[];
  title?: string;
  limit?: number;
}) {
  const tiles = ALL_TILES.filter((t) => !excludeHrefs.includes(t.href)).slice(0, limit);
  if (tiles.length === 0) return null;

  return (
    <section className="space-y-4">
      <header className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--border-gold)]" />
        <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
          {title}
        </span>
        <span className="h-px flex-1 bg-[var(--border-gold)]" />
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group flex items-center gap-4 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 transition-all hover:border-[var(--gold)]/55 hover:-translate-y-0.5"
          >
            <span
              className="flex h-12 w-12 items-center justify-center rounded-xl border text-2xl font-display flex-shrink-0"
              style={{
                color: t.accent,
                borderColor: `${t.accent}55`,
                backgroundColor: `${t.accent}15`,
              }}
            >
              {t.glyph}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-display text-sm font-bold text-white truncate group-hover:text-[var(--gold)] transition-colors">
                {t.label}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] truncate">{t.blurb}</p>
            </div>
            <svg
              className="h-4 w-4 text-white/30 group-hover:text-[var(--gold)] transition-colors flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ))}
      </div>
    </section>
  );
}
