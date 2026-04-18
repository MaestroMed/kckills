import Image from "next/image";
import Link from "next/link";
import {
  computeFlags,
  computeRarity,
  RARITY_VISUAL,
  type RaritySignals,
} from "@/lib/tcg/rarity";

interface ClipCardProps {
  /** Kill / clip signals — anything missing is treated as null. */
  signals: RaritySignals & {
    id: string;
    killerChampion?: string | null;
    victimChampion?: string | null;
    thumbnailUrl?: string | null;
    aiDescription?: string | null;
  };
  /**
   * Visual variant.
   *  - `compact`  : square TCG card, fits inside a grid (default)
   *  - `feature`  : 21:9 hero card with the full treatment
   *  - `portrait` : 9:16 vertical card (carousel rail / sphere tile)
   */
  variant?: "compact" | "feature" | "portrait";
  /** Link target. Defaults to `/kill/{id}`. */
  href?: string;
  /** When true, suppress the rarity badge — useful when the parent
   *  surface already carries the rarity context (e.g. an album page). */
  hideBadge?: boolean;
  /** Optional small caption shown under the title. */
  caption?: string;
}

/**
 * The visual grammar that makes every clip feel like an artefact —
 * inspired by TCG cards (rarity tiers, foil, particle effects, crown
 * for legendary/mythic). Strict per ARCHITECTURE.md §4.6:
 *
 *   - Cards are how clips LOOK, not what they DO.
 *   - No packs, no currency, no trading, no monetization hook.
 *   - Rarity is COMPUTED from clip metadata — never assigned by hand.
 *   - The frame is always *additive* to the clip experience.
 *
 * V1 inputs are limited to existing `kills` columns (highlight_score,
 * multi_kill, is_first_blood, etc.). Phase 1 enrichment slots in
 * automatically when those columns get populated — no UI change needed.
 */
export function ClipCard({
  signals,
  variant = "compact",
  href,
  hideBadge,
  caption,
}: ClipCardProps) {
  const rarity = computeRarity(signals);
  const flags = computeFlags(signals);
  const visual = RARITY_VISUAL[rarity.rarity];

  const aspectRatio =
    variant === "feature"
      ? "21/9"
      : variant === "portrait"
      ? "9/16"
      : "16/10";

  const link = href ?? `/kill/${signals.id}`;

  return (
    <Link
      href={link}
      className="group relative block overflow-hidden rounded-2xl border-2 transition-all hover:-translate-y-0.5"
      style={{
        aspectRatio,
        borderColor: visual.border,
        boxShadow: visual.shadow,
        background: "black",
      }}
      aria-label={`${rarity.rarity} card: ${signals.killerChampion ?? "?"} kills ${signals.victimChampion ?? "?"}`}
    >
      {/* Thumbnail */}
      {signals.thumbnailUrl ? (
        <Image
          src={signals.thumbnailUrl}
          alt=""
          fill
          sizes={
            variant === "feature"
              ? "(max-width: 768px) 100vw, 1280px"
              : variant === "portrait"
              ? "(max-width: 768px) 50vw, 360px"
              : "(max-width: 768px) 100vw, 33vw"
          }
          className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]" />
      )}

      {/* Bottom darken gradient — keeps text legible */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-transparent" />

      {/* Rarity radial — colours the frame from inside */}
      <div
        className="absolute inset-0 mix-blend-overlay opacity-30 transition-opacity duration-500 group-hover:opacity-50"
        style={{
          background: `radial-gradient(circle at 50% 30%, ${visual.accent}55 0%, transparent 70%)`,
        }}
      />

      {/* Foil overlay — only for epic+ rarities */}
      {visual.foil && (
        <div
          aria-hidden
          className="absolute inset-0 opacity-20 mix-blend-overlay pointer-events-none"
          style={{
            background: `linear-gradient(115deg, transparent 30%, ${visual.accent}80 50%, transparent 70%)`,
            backgroundSize: "200% 100%",
            animation: "tcg-foil 6s linear infinite",
          }}
        />
      )}

      {/* Particle field — only for legendary/mythic */}
      {visual.particles && (
        <div
          aria-hidden
          className="absolute inset-0 mix-blend-screen opacity-50 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 20% 30%, ${visual.accent}66 0%, transparent 4%),
                              radial-gradient(circle at 80% 50%, ${visual.accent}44 0%, transparent 3%),
                              radial-gradient(circle at 40% 80%, ${visual.accent}55 0%, transparent 3.5%)`,
            animation: "tcg-particles 8s ease-in-out infinite alternate",
          }}
        />
      )}

      {/* Top-left: rarity badge */}
      {!hideBadge && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
          <span
            className="rounded-md px-2.5 py-1 font-display text-[10px] font-black uppercase tracking-[0.22em]"
            style={{
              backgroundColor: visual.accentSoft,
              border: `1px solid ${visual.border}`,
              color: visual.accent,
              textShadow: `0 0 12px ${visual.accent}80`,
            }}
          >
            {visual.label}
          </span>
        </div>
      )}

      {/* Top-right: crown for legendary/mythic + score */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        {visual.crown && (
          <span
            aria-hidden
            className="text-base"
            style={{ filter: `drop-shadow(0 0 8px ${visual.accent})` }}
          >
            {rarity.rarity === "mythic" ? "\u2728" : "\u{1F451}"}
          </span>
        )}
        {typeof signals.highlightScore === "number" && (
          <span
            className="rounded-md bg-black/60 backdrop-blur-sm px-2 py-0.5 font-data text-[10px] font-bold"
            style={{
              border: `1px solid ${visual.accent}50`,
              color: visual.accent,
            }}
          >
            {signals.highlightScore.toFixed(1)}
          </span>
        )}
      </div>

      {/* Centre: play affordance */}
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      >
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full backdrop-blur-md transition-transform duration-300 group-hover:scale-110"
          style={{
            backgroundColor: `${visual.accent}25`,
            border: `2px solid ${visual.accent}aa`,
            boxShadow: `0 0 36px ${visual.accent}66`,
          }}
        >
          <svg className="h-6 w-6 translate-x-0.5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>

      {/* Bottom: matchup, flags, caption */}
      <div className="absolute inset-x-3 bottom-3 z-10">
        {flags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mb-1.5">
            {flags.slice(0, 3).map((flag) => (
              <span
                key={flag}
                className="rounded bg-black/55 backdrop-blur-sm px-1.5 py-0.5 font-data text-[8px] font-bold uppercase tracking-[0.18em]"
                style={{
                  border: `1px solid ${visual.accent}55`,
                  color: visual.accent,
                }}
              >
                {flag}
              </span>
            ))}
          </div>
        )}
        <p
          className={`font-display font-black text-white leading-tight ${
            variant === "feature" ? "text-2xl md:text-4xl" : variant === "portrait" ? "text-sm" : "text-sm md:text-base"
          }`}
        >
          <span style={{ color: visual.accent }}>
            {signals.killerChampion ?? "?"}
          </span>
          <span className="text-white/55 mx-1.5">→</span>
          <span className="text-white/85">{signals.victimChampion ?? "?"}</span>
        </p>
        {variant === "feature" && signals.aiDescription && (
          <p className="mt-2 text-sm md:text-base text-white/85 italic max-w-3xl line-clamp-2">
            « {signals.aiDescription} »
          </p>
        )}
        {variant !== "feature" && signals.aiDescription && (
          <p className="mt-1 text-[11px] text-white/65 italic line-clamp-2">
            {signals.aiDescription}
          </p>
        )}
        {caption && (
          <p className="mt-1 text-[10px] font-data uppercase tracking-wider text-white/45">
            {caption}
          </p>
        )}
      </div>
    </Link>
  );
}
