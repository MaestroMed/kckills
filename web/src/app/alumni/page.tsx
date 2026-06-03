/**
 * /alumni — Refonte avec hero gallery animée + cards riches.
 * Plus une simple grille de boxes — chaque alumni a son splash art en hover,
 * une accent line cinématique, et un layout chronologique par ère.
 *
 * Wave 37 — Hextech browse-page recipe : full-bleed cinematic hero with
 * text-shimmer title + Breadcrumb, unified max-w-7xl container, responsive
 * 4-up grid, .glass surfaces, .gold-line dividers, CornerLosange accents on
 * the splash cards, and the gold Losange replacing OS-emoji marks.
 */

import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ALUMNI } from "@/lib/alumni";
import { championSplashUrl } from "@/lib/constants";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getServerT } from "@/lib/i18n/server-lang";

export const metadata: Metadata = {
  title: "Alumni",
  description:
    "Les légendes qui ont porté le maillot Karmine Corp : Rekkles, xMatty, Cabochard, Targamas, Yike, Saken, Vetheo et les autres ancêtres.",
  alternates: { canonical: "/alumni" },
  openGraph: {
    title: "Alumni KC — Hall of Legends",
    description:
      "Les légendes qui ont porté le maillot Karmine Corp.",
    type: "website",
    siteName: "KCKILLS",
    locale: "fr_FR",
    images: [
      // Rekkles Jinx penta = the most iconic KC moment pre-LEC.
      {
        url: championSplashUrl("Jinx"),
        width: 1215,
        height: 717,
        alt: "Alumni KC",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Alumni KC — Hall of Legends",
    description: "Les légendes qui ont porté le maillot Karmine Corp.",
  },
};

/**
 * CornerLosange — server-safe rotated-square corner accent, copied from
 * the VSRoulette pattern. Pins a small gold diamond to a card corner.
 */
function CornerLosange({
  position,
}: {
  position: "tl" | "tr" | "bl" | "br";
}) {
  const map: Record<string, string> = {
    tl: "top-2 left-2",
    tr: "top-2 right-2",
    bl: "bottom-2 left-2",
    br: "bottom-2 right-2",
  };
  return (
    <span
      aria-hidden
      className={`absolute z-20 ${map[position]}`}
      style={{
        width: 8,
        height: 8,
        transform: "rotate(45deg)",
        background: "linear-gradient(135deg, var(--gold-bright), var(--gold))",
        boxShadow: "0 0 10px rgba(200,170,110,0.6)",
      }}
    />
  );
}

// Group alumni chronologically by year
function groupByYear(alumni: typeof ALUMNI) {
  const groups = new Map<string, typeof ALUMNI>();
  for (const a of alumni) {
    const year = a.period.split(/[\s-]/)[0]; // first year token
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year)!.push(a);
  }
  return Array.from(groups.entries()).sort((a, b) => Number(b[0]) - Number(a[0]));
}

export default async function AlumniPage() {
  const { t } = await getServerT();
  const grouped = groupByYear(ALUMNI);

  const ROLE_LABEL: Record<string, string> = {
    top: t("p_alumni.role_top"),
    jungle: t("p_alumni.role_jungle"),
    mid: t("p_alumni.role_mid"),
    adc: t("p_alumni.role_adc"),
    support: t("p_alumni.role_support"),
  };

  return (
    <div
      className="-mt-6"
      style={{
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      {/* ─── HERO — cinematic full-bleed band ─────────────────────── */}
      <section className="relative overflow-hidden bg-[var(--bg-primary)] py-16 px-6 md:py-24">
        {/* Splash mosaic background, heavily dimmed */}
        <div className="absolute inset-0 grid grid-cols-6 md:grid-cols-12 gap-px opacity-25">
          {ALUMNI.slice(0, 12).map((a, idx) => (
            <div key={a.slug} className="relative overflow-hidden">
              <Image
                src={championSplashUrl(a.signatureChampion)}
                alt=""
                fill
                sizes="(max-width: 768px) 16vw, 8vw"
                className="object-cover scale-110"
                style={{ filter: "brightness(0.5) saturate(1.05)" }}
                priority={idx < 4}
              />
            </div>
          ))}
        </div>

        {/* Heavy gradient + radial gold backdrop */}
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-primary)]/55 via-[var(--bg-primary)]/80 to-[var(--bg-primary)]" />
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 55% 45% at 50% 40%, rgba(200,170,110,0.18) 0%, transparent 65%)",
          }}
        />
        {/* Scanlines */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.14] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.09) 3px, transparent 4px)",
          }}
        />

        <div className="relative z-10 mx-auto max-w-7xl">
          <Breadcrumb items={[{ label: t("p_alumni.breadcrumb_home"), href: "/" }, { label: t("p_alumni.breadcrumb_current") }]} />

          <div className="mt-10 text-center">
            <p className="font-data text-[10px] uppercase tracking-[0.35em] text-[var(--gold)]/70 mb-4 flex items-center justify-center gap-3">
              <span
                aria-hidden
                className="inline-block"
                style={{
                  width: 8,
                  height: 8,
                  transform: "rotate(45deg)",
                  background: "linear-gradient(135deg, var(--gold-bright), var(--gold))",
                  boxShadow: "0 0 10px rgba(200,170,110,0.5)",
                }}
              />
              {t("p_alumni.hero_eyebrow")}
            </p>
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-black uppercase leading-none">
              <span className="text-shimmer">ALUMNI</span>
            </h1>
            <p className="mt-6 max-w-2xl mx-auto text-base md:text-lg text-[var(--text-secondary)] leading-relaxed">
              {t("p_alumni.hero_subtitle_pre")}{" "}
              <span className="text-[var(--gold)] font-bold">{t("p_alumni.hero_subtitle_genesis")}</span>{" "}
              {t("p_alumni.hero_subtitle_mid")}{" "}
              <span className="text-[var(--red)] font-bold">{t("p_alumni.hero_subtitle_dark")}</span>{" "}
              {t("p_alumni.hero_subtitle_post")}
            </p>
            <div className="mt-6 flex items-center justify-center gap-4 text-xs text-[var(--text-muted)]">
              <span>
                <span className="text-[var(--gold)] font-bold">{ALUMNI.length}</span> {t("p_alumni.stat_players")}
              </span>
              <span className="text-[var(--gold)]/30">◆</span>
              <span>
                <span className="text-[var(--gold)] font-bold">{grouped.length}</span> {t("p_alumni.stat_years")}
              </span>
              <span className="text-[var(--gold)]/30">◆</span>
              <span>2021 → 2024</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Year-grouped sections (unified wide container) ───────── */}
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-12 space-y-12">
        {grouped.map(([year, alumni]) => (
          <section key={year} className="space-y-4">
            <header className="flex items-center gap-3">
              <span className="font-display text-3xl md:text-4xl font-black text-[var(--gold)]">
                {year}
              </span>
              <div className="gold-line flex-1" />
              <span className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                {alumni.length > 1
                  ? t("p_alumni.n_players", { n: alumni.length })
                  : t("p_alumni.one_player", { n: alumni.length })}
              </span>
            </header>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {alumni.map((a) => (
                <Link
                  key={a.slug}
                  href={`/alumni/${a.slug}`}
                  className="group relative aspect-[4/5] overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all duration-300 hover:border-[var(--gold)]/60 hover:gold-glow hover:scale-[1.01]"
                >
                  {/* Splash art background */}
                  <Image
                    src={championSplashUrl(a.signatureChampion)}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
                    className="object-cover scale-110 group-hover:scale-105 transition-transform duration-700"
                  />

                  {/* Top accent bar */}
                  <div
                    className="absolute top-0 left-0 right-0 h-[2px] z-10"
                    style={{
                      background: `linear-gradient(90deg, ${a.accentColor}, transparent)`,
                      boxShadow: `0 0 12px ${a.accentColor}80`,
                    }}
                  />

                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent" />

                  {/* Top-right: role + period */}
                  <div className="absolute top-3 right-3 flex flex-col items-end gap-1 z-10">
                    <span
                      className="font-data text-[10px] font-bold uppercase tracking-[0.2em] rounded px-2 py-0.5 border backdrop-blur-sm bg-black/40"
                      style={{ color: a.accentColor, borderColor: `${a.accentColor}60` }}
                    >
                      {ROLE_LABEL[a.role]}
                    </span>
                    <span className="font-data text-[9px] uppercase tracking-widest text-white/80 backdrop-blur-sm bg-black/40 rounded px-1.5 py-0.5">
                      {a.period}
                    </span>
                  </div>

                  {/* Bottom: name + tag + champion */}
                  <div className="absolute bottom-0 left-0 right-0 p-5 z-10">
                    <h2 className="font-display text-3xl md:text-4xl font-black uppercase leading-none text-white group-hover:text-[var(--gold)] transition-colors">
                      {a.name}
                    </h2>
                    {a.realName && (
                      <p className="mt-1 font-data text-[10px] uppercase tracking-wider text-white/60">
                        {a.realName} · {a.nationality}
                      </p>
                    )}

                    <p
                      className="mt-3 font-display text-[10px] font-bold uppercase tracking-[0.25em]"
                      style={{ color: a.accentColor }}
                    >
                      {a.tag}
                    </p>

                    <p className="mt-2 text-xs text-white/70 line-clamp-2 leading-snug">
                      {a.subtitle}
                    </p>

                    <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-data text-[9px] uppercase tracking-widest text-white/50">
                        <span
                          aria-hidden
                          className="inline-block"
                          style={{
                            width: 6,
                            height: 6,
                            transform: "rotate(45deg)",
                            background: a.accentColor,
                            boxShadow: `0 0 6px ${a.accentColor}80`,
                          }}
                        />
                        {a.signatureChampion}
                      </span>
                      {a.stats[0] && (
                        <span className="text-[10px] text-white/80">
                          {a.stats[0].label}:{" "}
                          <span className="font-bold" style={{ color: a.accentColor }}>
                            {a.stats[0].value}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Hextech corner accents */}
                  <CornerLosange position="tl" />
                  <CornerLosange position="br" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
