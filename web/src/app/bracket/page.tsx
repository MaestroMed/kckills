/**
 * /bracket — Monthly Bracket Tournament (Wave 30h).
 *
 * Server shell :
 *   1. Reads the active bracket via fn_get_current_bracket() (falls back
 *      to the most-recent-closed if no open tournament exists).
 *   2. Pulls the past-winners gallery for the footer.
 *   3. Hands everything to the client <BracketView /> which renders the
 *      interactive tree + vote modal.
 *
 * Cache strategy : revalidate=120 (2 min). Vote tallies move every few
 * seconds during an active round, but the client component reconciles
 * via fn_record_bracket_vote on every vote — so the SSR snapshot only
 * needs to be fresh enough for the initial render. 2 min keeps the
 * Vercel cache hot without staling vote counts beyond user perception.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd, breadcrumbLD } from "@/lib/seo/jsonld";
import {
  getCurrentBracket,
  getPastWinners,
} from "@/lib/supabase/bracket";

import { BracketView } from "./BracketView";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "Tournoi du Mois — KCKILLS Bracket",
  description:
    "Le bracket mensuel KC : 64 kills, 6 rounds d'élimination, 1 GOAT du Mois. La communauté vote chaque jour pour couronner le meilleur kill Karmine Corp du mois.",
  alternates: { canonical: "/bracket" },
  openGraph: {
    title: "Tournoi du Mois — KCKILLS",
    description:
      "64 kills KC s'affrontent dans un bracket à élimination directe. Vote tous les jours, élis le GOAT du Mois.",
    type: "website",
    url: "/bracket",
    siteName: "KCKILLS",
    locale: "fr_FR",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tournoi du Mois — KCKILLS",
    description:
      "64 kills KC s'affrontent dans un bracket à élimination directe. La communauté vote, le GOAT est couronné.",
  },
};

export default async function BracketPage() {
  const [bundle, pastWinners] = await Promise.all([
    getCurrentBracket(),
    getPastWinners(12),
  ]);

  const breadcrumb = breadcrumbLD([
    { name: "Accueil", url: "/" },
    { name: "Tournoi du Mois", url: "/bracket" },
  ]);

  return (
    <div
      className="-mt-6"
      style={{
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      <JsonLd data={breadcrumb} />

      <nav
        aria-label="Fil d'Ariane"
        className="mx-auto max-w-6xl px-5 pt-6 flex items-center justify-start gap-2 text-xs text-white/55"
      >
        <Link href="/" className="hover:text-[var(--gold)] transition-colors">
          Accueil
        </Link>
        <span aria-hidden className="text-white/25">
          ◆
        </span>
        <span className="text-[var(--gold)]">Tournoi du Mois</span>
      </nav>

      <BracketView bundle={bundle} pastWinners={pastWinners} />

      <p
        aria-label="Riot Games disclaimer"
        className="px-4 pb-6 text-center text-[9px] uppercase tracking-widest text-white/30"
      >
        Not endorsed by Riot Games. League of Legends © Riot Games.
      </p>
    </div>
  );
}
