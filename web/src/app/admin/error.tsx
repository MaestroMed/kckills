"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Erreur dans une page admin : le message réel (pas un écran blanc), un
 * bouton pour réessayer, et la barre latérale reste utilisable.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[admin]", error);
  }, [error]);

  return (
    <div className="max-w-2xl rounded-xl border border-[var(--red)]/40 bg-[var(--red)]/5 p-6 space-y-3">
      <h1 className="font-display text-lg font-bold text-[var(--red)]">Cette page n&apos;a pas pu se charger</h1>
      <p className="text-sm text-[var(--text-secondary)] break-words">{error.message || "Erreur inconnue"}</p>
      {error.digest && (
        <p className="font-mono text-[11px] text-[var(--text-muted)]">Référence des logs Vercel : {error.digest}</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-3 py-1.5 text-xs font-bold text-[var(--gold)] hover:bg-[var(--gold)]/20"
        >
          Réessayer
        </button>
        <Link
          href="/admin"
          className="rounded-md border border-[var(--border-gold)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--gold)]"
        >
          Tableau de bord
        </Link>
      </div>
    </div>
  );
}
