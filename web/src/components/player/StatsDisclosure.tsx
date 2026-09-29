"use client";

/**
 * « Les chiffres » d'un joueur, repliés : KCKILLS est un site de clips, pas
 * de stats. Le contenu (graphiques chargés à la demande, historique) n'est
 * monté qu'à l'ouverture.
 */

import { useState, type ReactNode } from "react";

export function StatsDisclosure({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="relative mx-auto max-w-7xl px-6 py-10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex w-full items-center justify-between rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/60 px-6 py-5 text-left transition-colors hover:border-[var(--gold)]/50"
      >
        <span>
          <span className="block font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]">{title}</span>
          <span className="mt-1 block text-sm text-[var(--text-secondary)]">{hint}</span>
        </span>
        <span aria-hidden className={`text-[var(--gold)] transition-transform duration-300 ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && <div className="mt-8">{children}</div>}
    </section>
  );
}
