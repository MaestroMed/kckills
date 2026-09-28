"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { CREST_SMALL_SPEC, CREST_SPEC } from "@/components/logo/logo-marks";
import { LogoMark } from "@/components/logo/LogoMark";

const Logo3D = dynamic(() => import("@/components/logo/Logo3D"), { ssr: false });

function Tile({ label, bg, children, className = "" }: { label: string; bg: string; children: ReactNode; className?: string }) {
  return (
    <figure className={`overflow-hidden rounded-2xl border border-[var(--border-gold)] ${className}`}>
      <div className="flex h-full min-h-[220px] items-center justify-center p-6" style={{ background: bg }}>
        {children}
      </div>
      <figcaption className="border-t border-[var(--border-gold)] bg-[var(--bg-surface)] px-4 py-2 font-data text-[10px] uppercase tracking-[0.25em] text-[var(--gold)]/80">
        {label}
      </figcaption>
    </figure>
  );
}

const Wordmark = ({ size = 28 }: { size?: number }) => (
  <span
    className="font-display font-black leading-none tracking-[0.06em]"
    style={{
      fontSize: size,
      background: "linear-gradient(180deg, #F6E3AE 0%, #D6B574 55%, #9C7432 100%)",
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
    }}
  >
    KCKILLS
  </span>
);

export function LogoLab() {
  const [sweep, setSweep] = useState(0);
  const [assemble, setAssemble] = useState(0);

  return (
    <section className="mt-16">
      <p className="font-data text-[10px] uppercase tracking-[0.35em] text-[var(--gold)]/70">Logo · piste D retenue</p>
      <h2 className="mt-2 font-display text-4xl font-black text-[var(--gold-bright)]">L&apos;Écrin</h2>
      <p className="mt-3 max-w-2xl text-sm text-[var(--text-secondary)]">
        Deux K se font face, taillés en éclats d&apos;or ; leurs bras forment le losange Hextech qui enserre la gemme bleue
        KC. Huit éclats, une gemme, un axe de symétrie : les codes du metal et de Pentakill, dans une marque à nous.
      </p>

      {/* Héros 3D : assemblage + rayons */}
      <div
        className="relative mt-8 overflow-hidden rounded-2xl border border-[var(--border-gold)]"
        style={{
          background:
            "radial-gradient(55% 60% at 50% 45%, rgba(0,87,255,0.22), transparent 70%), radial-gradient(35% 40% at 20% 85%, rgba(138,61,255,0.15), transparent 70%), #02050d",
        }}
      >
        <Logo3D spec={CREST_SPEC} sweepTick={sweep} assembleTick={assemble} className="h-[560px] w-full" />
        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setAssemble((n) => n + 1)}
            className="rounded-lg border border-[var(--border-gold)] bg-black/40 px-4 py-2 font-display text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] backdrop-blur hover:border-[var(--gold)]/60 hover:text-[var(--gold)]"
          >
            Assembler
          </button>
          <button
            type="button"
            onClick={() => setSweep((n) => n + 1)}
            className="rounded-lg bg-[var(--gold)] px-4 py-2 font-display text-xs font-black uppercase tracking-widest text-[var(--bg-primary)] hover:bg-[var(--gold-bright)]"
          >
            Rayon
          </button>
        </div>
      </div>

      {/* Déclinaisons */}
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Couleur · nuit" bg="radial-gradient(70% 70% at 50% 45%, #0b1e4a, #010A13)">
          <LogoMark spec={CREST_SPEC} size={170} title="L'Écrin, couleur" />
        </Tile>
        <Tile label="Or · monochrome" bg="#010A13">
          <span className="text-[var(--gold)]">
            <LogoMark spec={CREST_SPEC} size={170} mono />
          </span>
        </Tile>
        <Tile label="Blanc · bleu KC" bg="linear-gradient(160deg, #0a63ff, #0036a8)">
          <span className="text-white">
            <LogoMark spec={CREST_SPEC} size={170} mono />
          </span>
        </Tile>
        <Tile label="Nuit · fond clair" bg="#F0E6D2">
          <span className="text-[#0A1428]">
            <LogoMark spec={CREST_SPEC} size={170} mono />
          </span>
        </Tile>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* Petites tailles : la version dessinée pour 16-48 px */}
        <Tile label="Petites tailles · favicon 16 / 24 / 32 / 48" bg="#0A1428">
          <div className="flex flex-col items-center gap-5">
            <div className="flex items-end gap-5">
              <LogoMark spec={CREST_SMALL_SPEC} size={16} />
              <LogoMark spec={CREST_SMALL_SPEC} size={24} />
              <LogoMark spec={CREST_SMALL_SPEC} size={32} />
              <LogoMark spec={CREST_SMALL_SPEC} size={48} />
            </div>
            <div className="flex items-center gap-2 rounded-t-lg border border-b-0 border-white/10 bg-[#1b2433] px-3 py-1.5 text-xs text-white/80">
              <LogoMark spec={CREST_SMALL_SPEC} size={16} />
              KCKILLS — Le site des clips de la KC
            </div>
          </div>
        </Tile>

        {/* Icône d'app (PWA / écran d'accueil) */}
        <Tile label="Icône d'app · 180 px" bg="#050b16">
          <div
            className="flex h-[140px] w-[140px] items-center justify-center rounded-[32px] shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]"
            style={{ background: "radial-gradient(80% 80% at 50% 35%, #123a9e, #030b24)" }}
          >
            <LogoMark spec={CREST_SPEC} size={104} />
          </div>
        </Tile>

        {/* Lockups */}
        <Tile label="Lockups · en ligne et empilé" bg="#010A13">
          <div className="flex flex-col items-center gap-7">
            <div className="flex items-center gap-3">
              <LogoMark spec={CREST_SPEC} size={48} />
              <Wordmark size={30} />
            </div>
            <div className="flex flex-col items-center gap-2">
              <LogoMark spec={CREST_SPEC} size={84} />
              <Wordmark size={24} />
            </div>
          </div>
        </Tile>
      </div>

      {/* Image de partage (OG 1200×630) */}
      <div className="mt-5">
        <Tile label="Image de partage · 1200×630" bg="#02050d" className="max-w-3xl">
          <div
            className="relative flex aspect-[1200/630] w-full items-center gap-8 overflow-hidden rounded-xl px-10"
            style={{
              background:
                "radial-gradient(50% 80% at 22% 50%, rgba(0,87,255,0.3), transparent 70%), linear-gradient(135deg, #061233, #010A13 70%)",
            }}
          >
            <LogoMark spec={CREST_SPEC} size={210} />
            <div>
              <Wordmark size={54} />
              <p className="mt-3 font-display text-lg font-bold uppercase tracking-[0.2em] text-[var(--gold-bright)]/90">
                Le site des clips de la KC
              </p>
              <p className="mt-2 font-data text-xs uppercase tracking-[0.3em] text-[var(--text-muted)]">kckills.com</p>
            </div>
          </div>
        </Tile>
      </div>
    </section>
  );
}
