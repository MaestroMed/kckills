/**
 * /antre — L'Antre de la Bronze Consulting Company.
 *
 * The hidden fan-club cave gets a public address. Historically the Antre
 * was ONLY reachable by typing B-C-C on Bo's page (an easter egg nobody
 * found) ; the club deserves walk-in members. The keyboard ritual stays —
 * initiés et badauds entrent désormais par la même porte dérobée.
 *
 * Everything inside (six salles, punch, tomates, ahou, autel Kyeahoo) is
 * the existing AntreOfBCC component + its RPCs (fn_bcc_* — migration 059).
 */

import type { Metadata } from "next";
import { AntreRoute } from "@/components/AntreRoute";

export const metadata: Metadata = {
  title: "L'Antre de la BCC",
  description:
    "L'Antre de la Bronze Consulting Company. Frappez la machine à écrire, jetez des tomates, faites chanter la galerie. Réunion en cours — n'oubliez pas votre badge.",
  alternates: { canonical: "/antre" },
  openGraph: {
    title: "L'Antre de la BCC — KCKILLS",
    description:
      "Le club le plus fermé de la fanbase ouvre une porte. Ce qui se passe dans l'Antre reste dans l'Antre.",
    type: "website",
    url: "/antre",
    siteName: "KCKILLS",
    locale: "fr_FR",
  },
};

export default function AntrePage() {
  return <AntreRoute />;
}
