import type { Metadata } from "next";
import { TextsEditor } from "./texts-editor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Textes — Admin", robots: { index: false, follow: false } };

export default function TextsPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">Textes des clips</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
          Les descriptions s&apos;affichent dans le feed, la fiche du clip et l&apos;image de partage. Corrige à la main (Ctrl+Entrée
          enregistre) ou redemande l&apos;analyse ; les citations se modèrent dans Communauté › Citations.
        </p>
      </header>
      <TextsEditor />
    </div>
  );
}
