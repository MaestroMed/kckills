/**
 * /antre — L'Antre de la Bronze Consulting Company.
 *
 * Cachée (29/09/2026, Mehdi) : plus aucun lien public, hors index, et
 * l'adresse répond 404 à qui n'a pas fait le rituel — taper B-C-C sur la
 * page de Bo, qui pose le cookie des initiés (lib/bcc-state). Les initiés
 * reviennent ensuite directement ici.
 *
 * Tout l'intérieur (six salles, punch, tomates, ahou, autel Kyeahoo) est
 * le composant AntreOfBCC + ses RPC (fn_bcc_* — migration 059).
 */

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AntreRoute } from "@/components/AntreRoute";
import { BCC_MEMBER_COOKIE } from "@/lib/bcc-state";

// Pas de titre ni de description : une 404 ne doit rien trahir.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AntrePage() {
  if ((await cookies()).get(BCC_MEMBER_COOKIE)?.value !== "1") notFound();
  return <AntreRoute />;
}
