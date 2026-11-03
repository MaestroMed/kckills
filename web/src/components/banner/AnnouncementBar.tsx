"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { T1_MATCH } from "@/lib/t1-match";
import { CONTACT_EMAIL } from "@/lib/contact";

/**
 * Bandeau d'annonce sous le live : le match du moment (KC × T1 aux Worlds,
 * s'éteint seul après T1_MATCH.endsAt) et la mention « site en bêta »
 * avec l'adresse de contact. Pas de fermeture : deux lignes courtes,
 * et le match disparaît de lui-même.
 */
export function AnnouncementBar() {
  // Rendu serveur sans le match (date inconnue côté build ISR), puis
  // affiché au montage s'il n'est pas encore passé.
  const [showMatch, setShowMatch] = useState(false);
  useEffect(() => {
    setShowMatch(Date.now() < Date.parse(T1_MATCH.endsAt));
  }, []);

  return (
    <div className="border-b border-[var(--border-gold)] text-center">
      {showMatch && (
        <Link
          href="/t1"
          className="block bg-gradient-to-r from-[#5c0012] via-[#2a0a1a] to-[#002a7a] px-4 py-2 text-xs font-semibold text-[var(--gold-bright)] hover:brightness-125 md:text-sm"
        >
          <span className="font-display uppercase tracking-widest">KC × T1</span>
          <span className="mx-2 text-[var(--gold)]">◆</span>
          {T1_MATCH.label}
          <span className="ml-2 underline underline-offset-2">Revoir tous les kills KC–T1 →</span>
        </Link>
      )}
      <p className="bg-[var(--bg-surface)] px-4 py-1 text-[11px] text-[var(--text-secondary)]">
        <span className="mr-1.5 rounded bg-[var(--gold)]/15 px-1.5 py-px font-data font-bold uppercase tracking-widest text-[var(--gold)]">
          Bêta
        </span>
        Le site est en bêta : un bug, une idée ?{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-[var(--gold)] underline underline-offset-2 hover:text-[var(--gold-bright)]">
          {CONTACT_EMAIL}
        </a>
      </p>
    </div>
  );
}
