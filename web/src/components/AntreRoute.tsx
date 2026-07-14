"use client";

/**
 * AntreRoute — mounts the (formerly easter-egg-only) Antre de la BCC as a
 * full public page. The AntreOfBCC component was built as a modal opened by
 * typing B-C-C on Bo's page ; this wrapper gives it a permanent address.
 * Its `onClose` (Escape / porte de sortie) walks back to the previous page
 * — or home when the Antre was the landing page (direct link, share).
 *
 * `ssr:false` + dynamic import for the same reason AntreTrigger lazy-loads
 * it : the Antre ships its own vintage design system (antre.css + 3 serif
 * fonts) that must not weigh on the rest of the site.
 */

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

const AntreOfBCC = dynamic(
  () => import("@/components/AntreOfBCC").then((m) => m.AntreOfBCC),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-[70] grid place-items-center bg-[#120a06]">
        <p className="font-data text-[11px] uppercase tracking-[0.35em] text-[#c9a86a]/70">
          Le portier vérifie votre badge…
        </p>
      </div>
    ),
  },
);

export function AntreRoute() {
  const router = useRouter();
  const leave = useCallback(() => {
    // history.length > 1 → arrived from inside the site ; walk back.
    // Direct visit (shared link) → the exit leads to the surface.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }, [router]);

  return <AntreOfBCC onClose={leave} />;
}
