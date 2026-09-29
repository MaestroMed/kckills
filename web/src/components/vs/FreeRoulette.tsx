"use client";

/**
 * La roulette libre (filtres par joueur, champion, époque, multi-kill) :
 * l'ancienne entrée de /vs, gardée sous l'arène pour qui veut composer ses
 * duels à la main. Chargée seulement à l'ouverture.
 */

import { useState } from "react";
import dynamic from "next/dynamic";
import type { VSEraOption, VSPlayerOption } from "@/lib/vs-roulette";

const VSRoulette = dynamic(() => import("@/components/VSRoulette").then((mod) => mod.VSRoulette), {
  ssr: false,
  loading: () => (
    <p className="py-12 text-center font-data text-[11px] uppercase tracking-[0.3em] text-white/40">Chargement de la roulette…</p>
  ),
});

export function FreeRoulette(props: {
  players: VSPlayerOption[];
  champions: string[];
  eras: VSEraOption[];
  rouletteThumbnails: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Roulette libre" className="border-t border-[var(--border-gold)]">
      {!open ? (
        <div className="mx-auto max-w-3xl px-4 py-10 text-center">
          <p className="font-data text-[10px] uppercase tracking-[0.35em] text-white/40">Mode libre</p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-3 rounded-xl border border-[var(--gold)]/35 bg-black/30 px-6 py-3 font-display text-xs font-bold uppercase tracking-[0.25em] text-[var(--gold)] transition-colors hover:border-[var(--gold)]/70 hover:bg-[var(--gold)]/10"
          >
            Roulette libre : champion, époque, multi-kill
          </button>
        </div>
      ) : (
        <VSRoulette {...props} />
      )}
    </section>
  );
}
