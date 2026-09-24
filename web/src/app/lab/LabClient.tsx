"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { BannerHandle } from "@/components/banner/banner-engine";

const KCBanner = dynamic(() => import("@/components/banner/KCBanner"), { ssr: false });

async function sweep() {
  const { emitSweep } = await import("@/components/banner/banner-engine");
  emitSweep(1.15);
}

export function LabClient() {
  const [wind, setWind] = useState(1.2);
  const [big, setBig] = useState<BannerHandle | null>(null);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
      <p className="font-data text-[10px] uppercase tracking-[0.35em] text-[var(--gold)]/70">Labo · hors index</p>
      <h1 className="mt-2 font-display text-4xl font-black text-[var(--gold-bright)] md:text-5xl">Étendards</h1>
      <p className="mt-3 max-w-2xl text-sm text-[var(--text-secondary)]">
        Tissu simulé (vent, rafales), drap bleu tissé, broderie or en relief qui s&apos;embrase au passage des rayons de
        lumière. Rendu WebGPU, repli WebGL2.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Grand format */}
        <div
          className="relative overflow-hidden rounded-2xl border border-[var(--border-gold)]"
          style={{
            background:
              "radial-gradient(60% 45% at 50% 30%, rgba(0,87,255,0.22), transparent 70%), radial-gradient(40% 40% at 15% 80%, rgba(138,61,255,0.18), transparent 70%), #02050d",
          }}
        >
          <KCBanner side="left" variant="lab" topMarginPx={36} windSpeed={wind} onHandle={setBig} className="mx-auto h-[82vh] max-h-[980px] min-h-[560px] w-full max-w-[560px]" />
        </div>

        {/* Réglages */}
        <div className="space-y-6">
          <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
            <label htmlFor="wind" className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]">
              Vent · {wind.toFixed(1)} m/s
            </label>
            <input
              id="wind"
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={wind}
              onChange={(e) => setWind(Number(e.target.value))}
              className="mt-3 w-full accent-[var(--gold)]"
            />
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => big?.gust(1)}
                className="rounded-lg border border-[var(--border-gold)] px-3 py-2.5 font-display text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:border-[var(--gold)]/60 hover:text-[var(--gold)]"
              >
                Rafale
              </button>
              <button
                type="button"
                onClick={() => void sweep()}
                className="rounded-lg bg-[var(--gold)] px-3 py-2.5 font-display text-xs font-black uppercase tracking-widest text-[var(--bg-primary)] hover:bg-[var(--gold-bright)]"
              >
                Rayon
              </button>
            </div>
          </div>

          {/* À la taille du header, sur la photo du hero */}
          <div>
            <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70">Taille réelle, sur le hero</p>
            <div
              className="relative mt-3 h-[300px] overflow-hidden rounded-xl border border-[var(--border-gold)] bg-cover bg-center"
              style={{ backgroundImage: "linear-gradient(rgba(1,10,19,0.35), rgba(1,10,19,0.55)), url(/images/hero-bg.jpg)" }}
            >
              <div className="absolute inset-x-3 top-3 h-11 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-primary)]/80 backdrop-blur" />
              <KCBanner side="left" variant="header" pxPerMeter={95} className="absolute left-0 top-[52px] h-[240px] w-[132px]" />
              <KCBanner side="right" variant="header" pxPerMeter={95} className="absolute right-0 top-[52px] h-[240px] w-[132px]" />
            </div>
          </div>
        </div>
      </div>

      <h2 className="mt-16 font-display text-3xl font-black text-[var(--gold-bright)]">Logo</h2>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">Pistes en préparation.</p>
    </div>
  );
}
