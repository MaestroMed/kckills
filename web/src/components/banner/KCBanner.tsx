"use client";

/**
 * KCBanner — étendard KC en tissu simulé (voir banner-engine.ts).
 *
 * Monte le moteur WebGPU/TSL (repli WebGL2 automatique) sur un canvas,
 * charge le code 3D à la demande, met le rendu en pause hors écran, et garde
 * `fallback` (le SVG statique) visible tant que la première image n'est pas
 * prête — ou pour toujours si le GPU refuse.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BannerHandle, BannerVariant } from "./banner-engine";

export interface KCBannerProps {
  side: "left" | "right";
  variant?: BannerVariant;
  /** Échelle fixe en px CSS par mètre (header) ; sinon l'étendard remplit la hauteur. */
  pxPerMeter?: number;
  topMarginPx?: number;
  /** Rendu suspendu (étendards repliés au scroll, onglet de labo masqué…). */
  paused?: boolean;
  /** Vitesse moyenne du vent (m/s), pilotable depuis le labo. */
  windSpeed?: number;
  className?: string;
  fallback?: ReactNode;
  /** Accès impératif (labo : rafale). */
  onHandle?: (h: BannerHandle | null) => void;
}

export function KCBanner({
  side,
  variant = "header",
  pxPerMeter,
  topMarginPx,
  paused = false,
  windSpeed,
  className,
  fallback,
  onHandle,
}: KCBannerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<BannerHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const onHandleRef = useRef(onHandle);
  useEffect(() => {
    onHandleRef.current = onHandle;
  }, [onHandle]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    import("./banner-engine")
      .then(({ mountBanner }) =>
        mountBanner(canvas, {
          side,
          variant,
          pxPerMeter,
          topMarginPx,
          onReady: () => {
            if (!disposed) setReady(true);
          },
        }),
      )
      .then((h) => {
        if (disposed) {
          h.dispose();
          return;
        }
        handleRef.current = h;
        onHandleRef.current?.(h);
      })
      .catch((err: unknown) => {
        console.warn("[KCBanner] rendu 3D indisponible, étendard statique :", err);
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      handleRef.current?.dispose();
      handleRef.current = null;
      onHandleRef.current?.(null);
    };
  }, [side, variant, pxPerMeter, topMarginPx]);

  // Pas de rendu hors écran.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { rootMargin: "64px" });
    io.observe(canvas);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    handleRef.current?.setPaused(paused || !onScreen);
  }, [paused, onScreen, ready]);

  useEffect(() => {
    if (windSpeed !== undefined) handleRef.current?.setWind(windSpeed);
  }, [windSpeed, ready]);

  // Le positionnement vient de className (absolute, fixed…) ; la boîte
  // interne est le repère relatif du canvas et du repli.
  return (
    <div className={className}>
      <div className="relative h-full w-full">
        {!failed && (
          <canvas
            ref={canvasRef}
            aria-hidden
            className="absolute inset-0 h-full w-full transition-opacity duration-700"
            style={{ opacity: ready ? 1 : 0 }}
          />
        )}
        {fallback && (!ready || failed) ? (
          <div className="absolute inset-0 flex items-start justify-center">{fallback}</div>
        ) : null}
      </div>
    </div>
  );
}

export default KCBanner;
