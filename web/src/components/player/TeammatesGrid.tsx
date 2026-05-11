import Link from "next/link";
import Image from "next/image";
import { championLoadingUrl } from "@/lib/constants";

export interface TeammateEntry {
  name: string;
  role: string;
  /** Display role label — "TOP", "JGL", "MID", "ADC", "SUP". */
  roleLabel: string;
  /** Photo URL — falls back to a signature champion splash when missing. */
  photoUrl?: string;
  /** Signature champion fallback (for splash background). */
  signatureChampion?: string;
}

/**
 * TeammatesGrid — 4-up grid of the player's current KC teammates, each
 * a portrait card with name, role and a hover photo glow.
 *
 * Renders nothing when there are zero teammates (e.g. on an alumni
 * page where this section isn't used).
 */
export function TeammatesGrid({
  teammates,
  accent = "var(--gold)",
}: {
  teammates: TeammateEntry[];
  accent?: string;
}) {
  if (teammates.length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
      {teammates.map((t) => (
        <Link
          key={t.name}
          href={`/player/${encodeURIComponent(t.name)}`}
          aria-label={`Voir le profil de ${t.name}`}
          className="group relative aspect-[3/4] overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all hover:-translate-y-1 hover:border-[var(--gold)]/60 hover:shadow-2xl hover:shadow-[var(--gold)]/20 focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2"
        >
          {/* Splash background */}
          {t.signatureChampion && (
            <Image
              src={championLoadingUrl(t.signatureChampion)}
              alt=""
              fill
              sizes="(max-width: 768px) 50vw, 25vw"
              className="object-cover opacity-60 group-hover:opacity-80 transition-opacity duration-500"
            />
          )}
          {/* Photo overlay */}
          {t.photoUrl && (
            <Image
              src={t.photoUrl}
              alt={t.name}
              fill
              sizes="(max-width: 768px) 50vw, 25vw"
              className="object-contain object-bottom group-hover:scale-105 transition-transform duration-500"
              style={{
                filter: "drop-shadow(0 10px 30px rgba(0,0,0,0.5))",
              }}
            />
          )}
          {/* Dark gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

          {/* Role pill top-right */}
          <span
            className="absolute top-3 right-3 z-10 rounded-md px-2 py-0.5 text-[10px] font-data font-bold uppercase tracking-[0.18em] backdrop-blur-sm"
            style={{
              color: accent,
              background: `${accent}1A`,
              border: `1px solid ${accent}40`,
            }}
          >
            {t.roleLabel}
          </span>

          {/* Name bottom */}
          <div className="absolute inset-x-0 bottom-0 p-3 md:p-4 z-10">
            <p className="font-display text-lg md:text-2xl font-black text-white leading-none truncate">
              {t.name}
            </p>
            <p className="font-data text-[10px] uppercase tracking-widest text-white/60 mt-1">
              KC · {t.roleLabel}
            </p>
          </div>

          {/* Rhombus ornament */}
          <span
            className="absolute top-3 left-3 text-sm leading-none z-10 select-none"
            style={{ color: accent, opacity: 0.7 }}
            aria-hidden
          >
            ◆
          </span>
        </Link>
      ))}
    </div>
  );
}
