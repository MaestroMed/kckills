"use client";

import { useEffect, useRef, useState } from "react";
import type { LogoConcept } from "./logo-marks";
import type { LogoHandle } from "./logo-engine";

/** Vue 3D d'une piste de logo (labo). `sweepTick` : incrémenter pour lancer un rayon. */
export default function Logo3D({ concept, sweepTick, className }: { concept: LogoConcept; sweepTick: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const handle = useRef<LogoHandle | null>(null);
  const first = useRef(concept);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let disposed = false;
    import("./logo-engine")
      .then(({ mountLogo3D }) => mountLogo3D(canvas, first.current))
      .then((h) => {
        if (disposed) h.dispose();
        else handle.current = h;
      })
      .catch((e: unknown) => {
        console.warn("[Logo3D] rendu 3D indisponible :", e);
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      handle.current?.dispose();
      handle.current = null;
    };
  }, []);

  useEffect(() => {
    handle.current?.setConcept(concept);
  }, [concept]);

  useEffect(() => {
    if (sweepTick > 0) handle.current?.sweep();
  }, [sweepTick]);

  if (failed) return <p className="p-6 text-sm text-[var(--text-muted)]">Rendu 3D indisponible sur ce navigateur.</p>;
  return <canvas ref={ref} aria-hidden className={className} />;
}
