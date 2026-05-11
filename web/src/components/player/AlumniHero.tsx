import Image from "next/image";
import Link from "next/link";
import { championLoadingUrl, championSplashUrl } from "@/lib/constants";
import { PortraitCubeMorph } from "@/components/PortraitCubeMorph";
import { LegendSeal } from "./LegendSeal";

const ROLE_LABEL: Record<string, string> = {
  top: "TOP LANE",
  jungle: "JUNGLE",
  mid: "MID LANE",
  adc: "BOT LANE",
  support: "SUPPORT",
};

/**
 * Convert a Gregorian year range to Roman numerals.
 * Used for the alumni "MMXXII-MMXXIII" top-right ornament.
 */
function toRoman(num: number): string {
  const map: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let n = num;
  let out = "";
  for (const [val, sym] of map) {
    while (n >= val) {
      out += sym;
      n -= val;
    }
  }
  return out;
}

function romanRange(period: string): string {
  // Pull out 4-digit years like "2022" or "2021-2024"
  const matches = period.match(/\d{4}/g);
  if (!matches || matches.length === 0) return "";
  if (matches.length === 1) return toRoman(parseInt(matches[0], 10));
  return `${toRoman(parseInt(matches[0], 10))}-${toRoman(parseInt(matches[1], 10))}`;
}

export interface AlumniHeroProps {
  name: string;
  realName?: string;
  /** Role : top / jungle / mid / adc / support */
  role: string;
  /** Country code or emoji shown next to the role. */
  nationality: string;
  /** Period string, e.g. "2022", "2021-2024". */
  period: string;
  /** Top tagline shown under the name in CAPS. */
  tag: string;
  /** Signature champion — drives the splash backdrop. */
  signatureChampion: string;
  /** Hex accent color from alumni.accentColor. */
  accent: string;
  /** Optional photo URL (KC official portrait). */
  photoUrl?: string;
}

/**
 * AlumniHero — the cinematic intro for /alumni/[slug] :
 *   - Champion loading + cube-portrait morph
 *   - "LÉGENDE · {period}" gold seal top-left (animated entry)
 *   - Roman-numeral period top-right
 *   - Massive Cinzel Black name (10rem+)
 *   - Role + nationality + tag
 *
 * 78vh on desktop, 640px floor on mobile.
 */
export function AlumniHero({
  name,
  realName,
  role,
  nationality,
  period,
  tag,
  signatureChampion,
  accent,
  photoUrl,
}: AlumniHeroProps) {
  const splash = championSplashUrl(signatureChampion);
  const loading = championLoadingUrl(signatureChampion);
  const romanPeriod = romanRange(period);

  return (
    <section className="relative h-[82vh] min-h-[640px] w-full overflow-hidden bg-[var(--bg-primary)]">
      {/* Splash backdrop */}
      <Image
        src={loading}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover scale-110"
        style={{ filter: "brightness(0.22) saturate(1.15)" }}
      />

      {/* Cube morph */}
      <PortraitCubeMorph
        images={[loading, splash]}
        accent={accent}
        cols={68}
        aspect={9 / 16}
        holdMs={6000}
        morphMs={2200}
        className="absolute inset-0 mix-blend-screen opacity-95"
      />

      {/* Gradients + accent radial */}
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)]/50 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-primary)] via-transparent to-[var(--bg-primary)]/70" />
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: `radial-gradient(ellipse at 20% 60%, ${accent}30, transparent 60%)`,
        }}
      />

      {/* Scanlines */}
      <div
        className="absolute inset-0 opacity-15 mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.1) 3px, transparent 4px)",
        }}
        aria-hidden
      />

      {/* Optional photo of the alumnus */}
      {photoUrl && (
        <div className="absolute bottom-0 right-0 h-[90%] w-[50%] md:w-[42%] lg:w-[36%] z-10 pointer-events-none">
          <Image
            src={photoUrl}
            alt={name}
            fill
            priority
            sizes="(max-width: 768px) 50vw, 36vw"
            className="object-contain object-bottom"
            style={{
              filter: `drop-shadow(0 20px 80px ${accent}40)`,
            }}
          />
        </div>
      )}

      {/* Top bar : breadcrumb + roman period */}
      <nav
        className="absolute top-6 left-6 right-6 z-30 flex items-center justify-between text-sm text-white/60"
        aria-label="Fil d'Ariane"
      >
        <Link href="/alumni" className="flex items-center gap-2 hover:text-[var(--gold)]">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Tous les alumni
        </Link>
        {romanPeriod && (
          <span
            className="font-data text-xs md:text-sm font-bold tracking-[0.3em] hidden md:inline-block"
            style={{ color: accent }}
            aria-label={`Periode ${period}`}
          >
            {romanPeriod}
          </span>
        )}
      </nav>

      {/* LegendSeal — top-left (under the breadcrumb) */}
      <div className="absolute top-16 md:top-20 left-6 z-30">
        <LegendSeal period={period} accent={accent} />
      </div>

      {/* Content — bottom-left */}
      <div className="relative z-20 h-full max-w-7xl mx-auto flex flex-col justify-end px-6 pb-16">
        <p
          className="font-display text-xs md:text-sm font-bold uppercase tracking-[0.3em] mb-3"
          style={{ color: accent }}
        >
          {ROLE_LABEL[role] ?? role.toUpperCase()} · {nationality}
        </p>

        <h1
          className="font-display text-6xl md:text-8xl lg:text-[10rem] font-black uppercase leading-none break-words"
          style={{
            color: "white",
            textShadow: `0 0 60px ${accent}40, 0 4px 20px rgba(0,0,0,0.8)`,
            letterSpacing: "-0.02em",
          }}
        >
          {name}
        </h1>

        {realName && (
          <p className="mt-4 text-lg md:text-xl text-white/60 font-medium">{realName}</p>
        )}

        <p
          className="mt-6 font-display text-sm md:text-base font-bold uppercase tracking-[0.25em]"
          style={{ color: accent }}
        >
          {tag}
        </p>
      </div>
    </section>
  );
}
