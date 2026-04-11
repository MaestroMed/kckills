/**
 * /alumni — Grid of legendary ex-KC players whose data isn't captured by
 * the 2024-2026 kc_matches.json file. Complements /players (active roster)
 * with the narrative ancestors.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ALUMNI } from "@/lib/alumni";

export const metadata: Metadata = {
  title: "Alumni \u2014 KCKILLS",
  description: "Les legendes qui ont porte le maillot KC avant l'ere LEC actuelle : Rekkles, xMatty, Cabochard, Targamas et les autres.",
  alternates: { canonical: "/alumni" },
};

const ROLE_LABEL: Record<string, string> = {
  top: "TOP",
  jungle: "JGL",
  mid: "MID",
  adc: "ADC",
  support: "SUP",
};

export default function AlumniPage() {
  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>Alumni</span>
      </nav>

      {/* Header */}
      <header className="space-y-4">
        <h1 className="font-display text-4xl md:text-5xl font-black uppercase">
          Les <span className="text-gold-gradient">alumni</span>
        </h1>
        <p className="max-w-2xl text-[var(--text-secondary)] leading-relaxed">
          Les joueurs qui ont porte les couleurs Karmine Corp avant l&rsquo;ere LEC actuelle.
          De la Genese 2021 jusqu&rsquo;au Dark Era 2024, chaque nom a ecrit un chapitre du club.
        </p>
      </header>

      {/* Grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {ALUMNI.map((alumni) => (
          <Link
            key={alumni.slug}
            href={`/alumni/${alumni.slug}`}
            className="group relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all hover:border-[var(--gold)]/60 hover:-translate-y-1"
          >
            {/* Accent bar */}
            <div
              className="absolute left-0 right-0 top-0 h-[3px]"
              style={{
                backgroundColor: alumni.accentColor,
                boxShadow: `0 0 16px ${alumni.accentColor}80`,
              }}
            />

            <div className="p-6">
              {/* Role + period */}
              <div className="flex items-center justify-between mb-4">
                <span
                  className="font-data text-[10px] font-bold uppercase tracking-[0.2em] rounded px-2 py-0.5 border"
                  style={{
                    color: alumni.accentColor,
                    borderColor: `${alumni.accentColor}40`,
                    backgroundColor: `${alumni.accentColor}15`,
                  }}
                >
                  {ROLE_LABEL[alumni.role]}
                </span>
                <span className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  {alumni.period}
                </span>
              </div>

              {/* Name + tag */}
              <h2 className="font-display text-3xl md:text-4xl font-black uppercase leading-none text-[var(--text-primary)] group-hover:text-[var(--gold)] transition-colors">
                {alumni.name}
              </h2>
              {alumni.realName && (
                <p className="mt-1 font-data text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  {alumni.realName} &middot; {alumni.nationality}
                </p>
              )}

              <p
                className="mt-5 font-display text-[11px] font-bold uppercase tracking-[0.25em]"
                style={{ color: alumni.accentColor }}
              >
                {alumni.tag}
              </p>

              <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed line-clamp-3">
                {alumni.subtitle}
              </p>

              {/* Footer: trophies hint */}
              <div className="mt-5 flex items-center justify-between border-t border-[var(--border-gold)] pt-4">
                <span className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  {alumni.stats[0]?.label}: <span className="text-[var(--gold)]">{alumni.stats[0]?.value}</span>
                </span>
                <svg className="h-3 w-3 text-[var(--text-muted)] group-hover:text-[var(--gold)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Footer note */}
      <p className="text-center text-xs text-[var(--text-muted)] pt-6">
        Ces bios sont curees. Les stats des matchs 2024+ sont disponibles sur{" "}
        <Link href="/players" className="text-[var(--gold)] hover:underline">
          la page roster actuelle
        </Link>.
      </p>
    </div>
  );
}
