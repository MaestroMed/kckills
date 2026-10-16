import type { Metadata } from "next";
import { ReviewDesk } from "./review-desk";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Revue — Admin", robots: { index: false, follow: false } };

/** /admin/review — revue des clips un par un, au clavier (lib : review-desk). */
export default function ReviewPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">Revue des clips</h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Un clip à la fois. Chaque action passe au suivant.</p>
      </header>
      <ReviewDesk />
    </div>
  );
}
