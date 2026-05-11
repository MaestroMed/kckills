import Link from "next/link";
import type { Era } from "@/lib/eras";

/**
 * HonorsAndEras — vertical list of KC eras this player traversed, each
 * tagged with its accent color, icon, result badge, and a link to the
 * era page. Shared between /player/[slug] (active) and the alumni page
 * (where it visually harmonizes with the rest).
 *
 * The "result" field on Era already encodes 🏆 (champion), 💔 (drama),
 * etc. — we just surface it inline. When the eras array is empty, the
 * component renders nothing (gracefully).
 */
export function HonorsAndEras({
  eras,
  accent = "var(--gold)",
}: {
  eras: Era[];
  accent?: string;
}) {
  if (eras.length === 0) return null;

  // Sort chronologically.
  const sorted = [...eras].sort((a, b) => a.dateStart.localeCompare(b.dateStart));

  return (
    <ol className="relative space-y-3 md:space-y-4" aria-label="Epoques traversees">
      {/* Vertical spine, anchored to the left of the icons */}
      <span
        aria-hidden
        className="absolute left-6 md:left-7 top-2 bottom-2 w-px"
        style={{ background: `linear-gradient(180deg, transparent, ${accent}55, transparent)` }}
      />
      {sorted.map((era) => {
        const isTrophy = era.result.includes("🏆") || era.result.toLowerCase().includes("champion");
        const isDrama =
          era.result.includes("💔") ||
          era.result.toLowerCase().includes("dernier") ||
          era.result.toLowerCase().includes("elimin");
        return (
          <li key={era.id} className="relative">
            <Link
              href={`/era/${era.id}`}
              aria-label={`Epoque ${era.label} — ${era.period}, ${era.result}`}
              className="group relative flex items-stretch gap-4 md:gap-5 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 md:p-5 transition-all hover:border-[var(--gold)]/60 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2"
              style={{
                borderLeftWidth: 3,
                borderLeftColor: era.color,
              }}
            >
              {/* Icon + accent shadow */}
              <div
                className="relative h-12 w-12 md:h-14 md:w-14 shrink-0 rounded-lg flex items-center justify-center text-2xl md:text-3xl"
                style={{
                  background: `${era.color}1A`,
                  border: `1px solid ${era.color}55`,
                  boxShadow: `0 0 22px ${era.color}25`,
                }}
                aria-hidden
              >
                {era.icon}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3
                    className="font-display text-base md:text-lg font-black uppercase tracking-tight text-[var(--text-primary)] group-hover:text-[var(--gold)] transition-colors"
                    style={{ letterSpacing: "0.02em" }}
                  >
                    {era.label}
                  </h3>
                  <span
                    className="font-data text-[10px] uppercase tracking-[0.2em]"
                    style={{ color: era.color }}
                  >
                    {era.period} · {era.phase}
                  </span>
                </div>
                <p className="text-xs md:text-sm text-[var(--text-secondary)] mt-1 line-clamp-2">
                  {era.subtitle}
                </p>
                <div className="mt-2 inline-flex items-center gap-2">
                  <span
                    className={`rounded-md px-2.5 py-0.5 text-[10px] font-display font-black uppercase tracking-widest ${
                      isTrophy
                        ? "text-[var(--gold)]"
                        : isDrama
                          ? "text-[var(--red)]"
                          : "text-white/70"
                    }`}
                    style={{
                      background: isTrophy
                        ? "rgba(200,170,110,0.12)"
                        : isDrama
                          ? "rgba(232,64,87,0.12)"
                          : "rgba(255,255,255,0.06)",
                      border: isTrophy
                        ? "1px solid rgba(200,170,110,0.4)"
                        : isDrama
                          ? "1px solid rgba(232,64,87,0.35)"
                          : "1px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    {era.result}
                  </span>
                </div>
              </div>

              <svg
                className="h-3 w-3 self-center text-[var(--text-muted)] group-hover:text-[var(--gold)] transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>
          </li>
        );
      })}
      <span aria-hidden className="sr-only">
        {accent}
      </span>
    </ol>
  );
}
