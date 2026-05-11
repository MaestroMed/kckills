import Link from "next/link";
import Image from "next/image";
import { championIconUrl, championLoadingUrl } from "@/lib/constants";
import type { AlumniSignatureMoment } from "@/lib/alumni";

/**
 * SignatureMoments — 3-5 editorial cards highlighting a player's most
 * iconic KC moments. Each card carries :
 *   - Title (Cinzel display)
 *   - Date (small monospace, era-accent color)
 *   - 2-line description (prose)
 *   - Champion icon visual (when supplied)
 *   - Optional clip link
 *
 * Renders nothing if the moments array is empty — pages can drop the
 * section entirely.
 */
export function SignatureMoments({
  moments,
  accent = "var(--gold)",
}: {
  moments: AlumniSignatureMoment[];
  accent?: string;
}) {
  if (moments.length === 0) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {moments.map((m, i) => {
        const inner = (
          <>
            {/* Splash backdrop — only when a champion is set */}
            {m.champion && (
              <Image
                src={championLoadingUrl(m.champion)}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover opacity-15 group-hover:opacity-30 transition-opacity duration-500"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-surface)]/70 to-transparent" />

            <div className="relative z-10 flex flex-col h-full p-5 md:p-6">
              {/* Top : champion icon + date */}
              <div className="flex items-start justify-between gap-3">
                {m.champion ? (
                  <div
                    className="relative h-12 w-12 rounded-full overflow-hidden border-2 shrink-0"
                    style={{ borderColor: `${accent}99` }}
                  >
                    <Image
                      src={championIconUrl(m.champion)}
                      alt={m.champion}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <span
                    className="font-display text-3xl font-black leading-none"
                    style={{ color: accent, opacity: 0.4 }}
                    aria-hidden
                  >
                    ◆
                  </span>
                )}
                <div className="text-right">
                  <p
                    className="font-data text-[10px] uppercase tracking-[0.22em] font-bold"
                    style={{ color: accent }}
                  >
                    Moment {String(i + 1).padStart(2, "0")}
                  </p>
                  <p className="font-data text-[11px] text-[var(--text-muted)] mt-0.5">
                    {m.date}
                  </p>
                </div>
              </div>

              {/* Title */}
              <h3
                className="mt-5 font-display text-xl md:text-2xl font-black uppercase leading-tight text-[var(--text-primary)]"
                style={{ letterSpacing: "-0.005em" }}
              >
                {m.title}
              </h3>

              {/* Description */}
              <p className="mt-3 text-sm md:text-[15px] leading-relaxed text-[var(--text-secondary)] flex-1">
                {m.description}
              </p>

              {/* Clip CTA */}
              {m.clipId && (
                <p className="mt-4 inline-flex items-center gap-2 font-display text-[10px] uppercase tracking-widest font-bold text-[var(--gold)]">
                  Voir le clip
                  <svg
                    className="h-3 w-3"
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
                </p>
              )}
            </div>

            {/* Top-left gold corner (Hextech) */}
            <span
              aria-hidden
              className="absolute top-0 left-0 h-8 w-8 border-t-2 border-l-2"
              style={{ borderColor: accent }}
            />
            {/* Bottom-right gold corner */}
            <span
              aria-hidden
              className="absolute bottom-0 right-0 h-8 w-8 border-b-2 border-r-2"
              style={{ borderColor: accent }}
            />
          </>
        );

        const baseClass =
          "group relative overflow-hidden rounded-2xl border bg-[var(--bg-surface)] transition-all hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2";

        const cardStyle = {
          minHeight: "300px",
          borderColor: `${accent}30`,
        } as React.CSSProperties;

        return m.clipId ? (
          <Link
            key={i}
            href={`/kill/${m.clipId}`}
            aria-label={`Moment : ${m.title}`}
            className={`${baseClass} hover:border-[var(--gold)]/60`}
            style={cardStyle}
          >
            {inner}
          </Link>
        ) : (
          <article key={i} className={baseClass} style={cardStyle}>
            {inner}
          </article>
        );
      })}
    </div>
  );
}
