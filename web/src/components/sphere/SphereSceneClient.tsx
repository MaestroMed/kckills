"use client";

import dynamic from "next/dynamic";
import type { SphereTile } from "./SphereScene";

/**
 * Thin client-component wrapper around the heavy three.js scene.
 * Lives in a "use client" file so Next 15 lets us use `ssr: false` on
 * the dynamic import — three.js touches `window` and WebGL contexts at
 * module-eval time and would crash during SSR otherwise.
 */
const SphereScene = dynamic(
  () => import("./SphereScene").then((m) => m.SphereScene),
  { ssr: false, loading: () => <SphereLoading /> },
);

interface Props {
  tiles: SphereTile[];
  cameraZ?: number;
  debug?: boolean;
}

export function SphereSceneClient(props: Props) {
  return <SphereScene {...props} />;
}

function SphereLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="kc-spinner" aria-label="Chargement de la sphere 3D" />
        <p className="font-data text-[11px] uppercase tracking-[0.3em] text-[var(--gold)]/70">
          Initialisation WebGL
        </p>
      </div>
    </div>
  );
}
