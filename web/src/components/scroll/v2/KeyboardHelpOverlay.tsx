"use client";

/**
 * KeyboardHelpOverlay — modal showing the full keyboard cheatsheet.
 * Toggled via ? on desktop. Click backdrop or press Esc to dismiss.
 *
 * Designed mobile-aware: on small viewports (< 640px) the overlay
 * adapts to bottom sheet style instead of modal-center, but on mobile
 * we don't show keyboard shortcuts anyway — the trigger only works
 * with a physical keyboard.
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["↓", "J", "Espace"], label: "Clip suivant" },
  { keys: ["↑", "K"], label: "Clip précédent" },
  { keys: ["M"], label: "Couper / activer le son" },
  { keys: ["L"], label: "Liker (note 5/5)" },
  { keys: ["C"], label: "Ouvrir les commentaires" },
  { keys: ["S"], label: "Partager" },
  { keys: ["Esc"], label: "Fermer un panneau" },
  { keys: ["?"], label: "Afficher cette aide" },
];

export function KeyboardHelpOverlay({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Raccourcis clavier"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-3xl border border-[var(--gold)]/30 bg-[var(--bg-surface)] p-6 shadow-[0_40px_120px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Fermer"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <p className="font-data text-[10px] uppercase tracking-[0.4em] text-[var(--gold)]/65 mb-2">
          Raccourcis clavier
        </p>
        <h2 className="font-display text-2xl font-black text-white mb-5">
          Pro mode
        </h2>

        <ul className="space-y-2.5">
          {SHORTCUTS.map((s) => (
            <li
              key={s.label}
              className="flex items-center justify-between gap-4 rounded-xl bg-[var(--bg-elevated)]/50 px-3 py-2"
            >
              <span className="text-sm text-white/80">{s.label}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k, i) => (
                  <kbd
                    key={i}
                    className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-white/15 bg-black/40 px-1.5 font-data text-[10px] font-bold text-white/85"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-5 text-[11px] text-white/45 text-center">
          Astuce : ces raccourcis ne fonctionnent pas quand un champ texte est
          actif. Utilise <kbd className="px-1 rounded bg-white/10 text-[10px]">Tab</kbd>{" "}
          pour quitter le focus d&apos;abord.
        </p>
      </div>
    </div>
  );
}
