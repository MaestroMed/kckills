"use client";

import { useEffect, useRef, useState } from "react";
import { CREST_SPEC, type CrestSpec } from "./logo-marks";
import type { LogoHandle } from "./logo-engine";

/**
 * « L'Écrin » en 3D (labo, fin de la vidéo). `sweepTick` / `assembleTick` :
 * incrémenter pour lancer un rayon ou rejouer l'assemblage.
 */
export default function Logo3D({
  spec = CREST_SPEC,
  sweepTick = 0,
  assembleTick = 0,
  className,
}: {
  spec?: CrestSpec;
  sweepTick?: number;
  assembleTick?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const handle = useRef<LogoHandle | null>(null);
  const first = useRef(spec);
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
    if (spec !== first.current) handle.current?.setSpec(spec);
  }, [spec]);

  useEffect(() => {
    if (assembleTick > 0) handle.current?.assemble();
  }, [assembleTick]);

  useEffect(() => {
    if (sweepTick > 0) handle.current?.sweep();
  }, [sweepTick]);

  if (failed) return <p className="p-6 text-sm text-[var(--text-muted)]">Rendu 3D indisponible sur ce navigateur.</p>;
  return <canvas ref={ref} aria-hidden className={className} />;
}
