"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { LOGO_CONCEPTS } from "@/components/logo/logo-marks";
import { LogoMark } from "@/components/logo/LogoMark";

const Logo3D = dynamic(() => import("@/components/logo/Logo3D"), { ssr: false });

export function LogoLab() {
  const [pick, setPick] = useState(LOGO_CONCEPTS[LOGO_CONCEPTS.length - 1]);
  const [tick, setTick] = useState(0);

  return (
    <section className="mt-16">
      <h2 className="font-display text-3xl font-black text-[var(--gold-bright)]">Logo</h2>
      <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
        Trois marques originales dans les codes KC × Pentakill (symétrie métal, lames, le chiffre cinq, losanges Hextech)
        — sans reprendre les logos officiels. Vectorielles : favicon, header, image de partage, 3D.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {LOGO_CONCEPTS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setPick(c)}
            aria-pressed={pick.id === c.id}
            className={`rounded-2xl border p-5 text-left transition-colors ${
              pick.id === c.id ? "border-[var(--gold)] bg-[var(--bg-elevated)]" : "border-[var(--border-gold)] bg-[var(--bg-surface)] hover:border-[var(--gold)]/50"
            }`}
          >
            <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]">
              {c.letter} · {c.name}
            </p>
            <div className="mt-4 flex justify-center rounded-xl bg-[#010A13] py-6">
              <LogoMark concept={c} size={176} title={`Piste ${c.letter} — ${c.name}`} />
            </div>
            <p className="mt-4 text-sm text-[var(--text-secondary)]">{c.idea}</p>

            {/* Tailles réelles : favicons, sur fond sombre et clair */}
            <div className="mt-4 flex items-end gap-4 rounded-lg bg-[#0A1428] p-3">
              <LogoMark concept={c} size={16} />
              <LogoMark concept={c} size={32} />
              <LogoMark concept={c} size={48} />
              <span className="ml-auto flex items-end gap-3 rounded-md bg-[#F0E6D2] p-2 text-[#0A1428]">
                <LogoMark concept={c} size={32} />
                <LogoMark concept={c} size={32} mono />
              </span>
            </div>

            {/* Dans le header */}
            <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-primary)]/80 px-3 py-2">
              <LogoMark concept={c} size={30} />
              <span className="font-display text-lg font-black tracking-wide text-[var(--gold-bright)]">KCKILLS</span>
            </div>
          </button>
        ))}
      </div>

      <div
        className="relative mt-8 overflow-hidden rounded-2xl border border-[var(--border-gold)]"
        style={{
          background:
            "radial-gradient(55% 60% at 50% 45%, rgba(0,87,255,0.2), transparent 70%), radial-gradient(35% 40% at 20% 85%, rgba(138,61,255,0.15), transparent 70%), #02050d",
        }}
      >
        <Logo3D concept={pick} sweepTick={tick} className="h-[480px] w-full" />
        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between gap-3">
          <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/80">
            3D · {pick.letter} · {pick.name}
          </p>
          <button
            type="button"
            onClick={() => setTick((n) => n + 1)}
            className="rounded-lg bg-[var(--gold)] px-4 py-2 font-display text-xs font-black uppercase tracking-widest text-[var(--bg-primary)] hover:bg-[var(--gold-bright)]"
          >
            Rayon
          </button>
        </div>
      </div>
    </section>
  );
}
