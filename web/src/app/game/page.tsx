import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blue Wall Builder \u2014 KCKILLS",
  description:
    "Construis le Blue Wall avec la KC Army ! Ragdoll physics, briques bleues, chaos garanti.",
};

export default function GameLobbyPage() {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center space-y-8">
      {/* Hero */}
      <div className="space-y-4">
        <div className="text-6xl">{"\uD83E\uDDF1"}</div>
        <h1 className="font-display text-4xl md:text-5xl font-black">
          BLUE WALL{" "}
          <span className="text-gold-gradient">BUILDER</span>
        </h1>
        <p className="text-lg text-[var(--text-muted)] max-w-md mx-auto">
          Construis le Blue Wall avec la KC Army. Empile les briques,
          lance-les sur les autres, et survis au chaos ragdoll.
        </p>
      </div>

      {/* Play button */}
      <Link
        href="/game/solo"
        className="inline-flex items-center gap-3 rounded-2xl bg-[var(--blue-kc)] px-8 py-4 font-display text-lg font-bold text-white uppercase tracking-widest hover:bg-[#0046cc] transition-all hover:scale-105 active:scale-95 shadow-xl shadow-[var(--blue-kc)]/30"
      >
        <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        Jouer
      </Link>

      {/* How to play */}
      <div className="grid gap-4 md:grid-cols-3 text-left">
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-2">
          <div className="text-2xl">{"\u2B05\uFE0F\u27A1\uFE0F"}</div>
          <h3 className="font-display font-bold text-sm">Bouger</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Fl&egrave;ches ou A/D pour marcher. Espace pour sauter.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-2">
          <div className="text-2xl">{"\uD83E\uDDF1"}</div>
          <h3 className="font-display font-bold text-sm">Construire</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Appuie sur E pour attraper une brique. Pose-la sur le mur.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-2">
          <div className="text-2xl">{"\uD83D\uDCA5"}</div>
          <h3 className="font-display font-bold text-sm">Chaos</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Clique pour lancer la brique. Touche un joueur = RAGDOLL !
          </p>
        </div>
      </div>

      {/* Goal */}
      <div className="rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/5 p-6">
        <p className="font-display text-sm font-bold text-[var(--gold)] uppercase tracking-widest mb-2">
          Objectif
        </p>
        <p className="text-sm text-[var(--text-secondary)]">
          Construire un Blue Wall de <span className="font-bold text-[var(--gold)]">257 briques</span> de haut &mdash;
          en r&eacute;f&eacute;rence aux 257 fans KC qui ont voyag&eacute; &agrave; Barcelone en d&eacute;cembre 2021.
        </p>
      </div>
    </div>
  );
}
