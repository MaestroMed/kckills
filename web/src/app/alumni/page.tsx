/**
 * /alumni — Refonte avec hero gallery animée + cards riches.
 * Plus une simple grille de boxes — chaque alumni a son splash art en hover,
 * une accent line cinématique, et un layout chronologique par ère.
 */

import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ALUMNI } from "@/lib/alumni";
import { championSplashUrl } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Alumni — KCKILLS",
  description: "Les legendes qui ont porte le maillot KC : Rekkles, xMatty, Cabochard, Targamas, et les autres ancetres.",
  alternates: { canonical: "/alumni" },
};

const ROLE_LABEL: Record<string, string> = {
  top: "TOP",
  jungle: "JGL",
  mid: "MID",
  adc: "ADC",
  support: "SUP",
};

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

export default function AlumniPage() {
  const grouped = groupByYear(ALUMNI);

  return (
    <div className="space-y-12">
      {/* HERO — splash gallery cinématique */}
      <section className="relative h-[60vh] min-h-[400px] -mx-4 overflow-hidden bg-black">
        {/* Splash mosaic background */}
        <div className="absolute inset-0 grid grid-cols-6 md:grid-cols-12 gap-px opacity-30">
          {ALUMNI.slice(0, 12).map((a, idx) => (
            <div key={a.slug} className="relative overflow-hidden" style={{ animationDelay: `${idx * 0.1}s` }}>
              <Image
                src={championSplashUrl(a.signatureChampion)}
                alt=""
                fill
                sizes="(max-width: 768px) 16vw, 8vw"
                className="object-cover scale-110"
                priority={idx < 4}
              />
            </div>
          ))}
        </div>

        {/* Heavy gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-primary)]/40 via-[var(--bg-primary)]/70 to-[var(--bg-primary)]" />

        {/* Hero content */}
        <div className="relative h-full flex flex-col items-center justify-center text-center px-4 z-10">
          <p className="font-data text-[10px] uppercase tracking-[0.4em] text-[var(--gold)] mb-3">
            ◆ MEMORIAL ◆
          </p>
          <h1 className="font-display text-5xl md:text-7xl font-black uppercase mb-4">
            <span className="text-gold-gradient">Alumni</span>
          </h1>
          <p className="max-w-xl text-sm md:text-base text-[var(--text-secondary)] leading-relaxed">
            De la <span className="text-[var(--gold)] font-bold">Genese 2021</span> au
            <span className="text-[var(--red)] font-bold"> Dark Era 2024</span>,
            <br />les visages qui ont écrit les chapitres avant l&apos;ère LEC actuelle.
          </p>
          <div className="mt-6 flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <span><span className="text-[var(--gold)] font-bold">{ALUMNI.length}</span> joueurs</span>
            <span className="text-[var(--gold)]/30">◆</span>
            <span><span className="text-[var(--gold)] font-bold">{grouped.length}</span> années</span>
            <span className="text-[var(--gold)]/30">◆</span>
            <span>2021 → 2024</span>
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[var(--bg-primary)] to-transparent" />
      </section>

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">◆</span>
        <span>Alumni</span>
      </nav>

      {/* Year-grouped sections */}
      {grouped.map(([year, alumni]) => (
        <section key={year} className="space-y-4">
          <header className="flex items-center gap-3">
            <span className="font-display text-3xl md:text-4xl font-black text-[var(--gold)]">{year}</span>
            <div className="h-px flex-1 bg-gradient-to-r from-[var(--gold)] to-transparent" />
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              {alumni.length} joueur{alumni.length > 1 ? "s" : ""}
            </span>
          </header>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {alumni.map((a) => (
              <Link
                key={a.slug}
                href={`/alumni/${a.slug}`}
                className="group relative aspect-[4/5] overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] hover:border-[var(--gold)] transition-all duration-300"
              >
                {/* Splash art background */}
                <Image
                  src={championSplashUrl(a.signatureChampion)}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
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
                    <span className="text-[9px] uppercase tracking-widest text-white/50">
                      ◆ {a.signatureChampion}
                    </span>
                    {a.stats[0] && (
                      <span className="text-[10px] text-white/80">
                        {a.stats[0].label}: <span className="font-bold" style={{ color: a.accentColor }}>{a.stats[0].value}</span>
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
