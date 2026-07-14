/**
 * /vs/stream — VS Roulette, Mode Stream.
 *
 * The EtoStark layout : the duel fills a 16:9 frame designed to be captured
 * by OBS (or projected fullscreen), the host arbitrates with the keyboard
 * while chat screams, and the roulette relances itself. Zero chrome — the
 * component overlays the site shell like /chambre does (fixed inset-0).
 *
 * Same engine as /vs : fn_pick_vs_pair + fn_record_vs_vote (ELO K=32,
 * dedup by session hash — the host's votes count once like everyone
 * else's). No new table, no new RPC.
 *
 * URL knobs (all optional) :
 *   ?left=<ign>&right=<ign>   pin a player per side (roster duel)
 *   ?t=25                     seconds per duel before auto-reveal (10-90)
 *   ?auto=1                   full autopilot : reveal on timer, next in 6 s
 */

import type { Metadata } from "next";
import { Suspense } from "react";
import { VSStreamMode } from "@/components/vs-stream/VSStreamMode";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "VS Roulette — Mode Stream",
  description:
    "Le duel de clips KC en plein écran, taillé pour le stream. La roulette tire, le chat hurle, l'hôte tranche.",
  alternates: { canonical: "/vs/stream" },
  robots: { index: false },
};

export default function VSStreamPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-[60] grid place-items-center bg-[#03060c]">
          <p className="font-data text-[11px] uppercase tracking-[0.35em] text-[var(--gold)]/70">
            La roulette se met en place…
          </p>
        </div>
      }
    >
      <VSStreamMode />
    </Suspense>
  );
}
