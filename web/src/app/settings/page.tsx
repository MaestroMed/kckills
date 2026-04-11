"use client";

import Link from "next/link";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-lg space-y-8 py-8">
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>Parametres</span>
      </nav>

      <h1 className="font-display text-2xl font-bold">Parametres</h1>

      {/* Profile */}
      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-3">
        <h2 className="font-display font-semibold">Profil</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Connecte-toi avec Discord pour voir ton profil.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-lg bg-[#5865F2] px-4 py-2 text-sm font-semibold text-white"
        >
          Se connecter avec Discord
        </Link>
      </section>

      {/* Riot Link (optional) */}
      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-3">
        <h2 className="font-display font-semibold">Lier ton compte Riot</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Optionnel. Affiche ton rank et tes top champions sur ton profil.
        </p>
        <button
          className="rounded-lg border border-[var(--border-gold)] px-4 py-2 text-sm text-[var(--text-muted)] opacity-50 cursor-not-allowed"
          disabled
        >
          Bientot disponible
        </button>
      </section>

      {/* Data export */}
      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-3">
        <h2 className="font-display font-semibold">Mes donnees</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Exporte toutes tes donnees (votes, commentaires, profil) en JSON.
        </p>
        <button
          className="rounded-lg border border-[var(--border-gold)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:border-[var(--gold)]/40"
          onClick={() => alert("Export sera disponible quand Supabase est connecte")}
        >
          Exporter mes donnees
        </button>
      </section>

      {/* Delete account */}
      <section className="rounded-xl border border-[var(--red)]/30 bg-[var(--bg-surface)] p-5 space-y-3">
        <h2 className="font-display font-semibold text-[var(--red)]">Zone dangereuse</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Supprimer ton compte efface ton profil, anonymise tes votes et supprime tes commentaires.
          Cette action est irreversible.
        </p>
        <button
          className="rounded-lg bg-[var(--red)]/10 border border-[var(--red)]/30 px-4 py-2 text-sm text-[var(--red)] hover:bg-[var(--red)]/20"
          onClick={() => {
            if (confirm("Es-tu sur de vouloir supprimer ton compte ? Cette action est irreversible.")) {
              alert("Suppression sera disponible quand Supabase est connecte");
            }
          }}
        >
          Supprimer mon compte
        </button>
      </section>
    </div>
  );
}
