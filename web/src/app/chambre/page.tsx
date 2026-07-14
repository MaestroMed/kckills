/**
 * /chambre — La Chambre des Souffrances.
 *
 * A full-screen immersive descent through Karmine Corp's worst deaths,
 * bucketed into 10 circles of increasing severity. Server-fetches the data
 * (getChamberCircles) and hands it to the client experience, which overlays
 * the whole viewport (fixed inset-0), covering the site chrome like /scroll.
 */

import type { Metadata } from "next";
import { getChamberCircles } from "@/lib/supabase/chamber";
import { ChamberExperience } from "@/components/chambre/ChamberExperience";

export const revalidate = 600;

export const metadata: Metadata = {
  // Wave 36 — the root layout template already appends "— KCKILLS" ;
  // the hardcoded suffix produced "… — KCKILLS — KCKILLS" in the tab.
  title: "La Chambre des Souffrances",
  description:
    "Dix cercles. Les pires morts de la Karmine Corp, du simple faux-pas au pentakill encaissé. Descends si tu l'oses.",
  alternates: { canonical: "/chambre" },
  openGraph: {
    title: "La Chambre des Souffrances — KCKILLS",
    description:
      "Dix cercles des pires morts de la Karmine Corp. La pression monte à chaque descente.",
  },
};

export default async function ChambrePage() {
  const circles = await getChamberCircles();
  return <ChamberExperience circles={circles} />;
}
