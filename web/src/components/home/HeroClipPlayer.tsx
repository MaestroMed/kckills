"use client";

import Image from "next/image";
import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Lecteur du clip de l'accueil : l'affiche d'abord (LCP léger), puis la
 * vidéo basse définition en boucle, muette, UNIQUEMENT sur grand écran,
 * sans « réduire les animations » ni « économiseur de données », et
 * seulement quand elle est visible. Sur mobile, l'affiche suffit : le tap
 * ouvre le clip dans le scroll (préserve le forfait data).
 */

const WIDE = "(min-width: 768px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

function canAutoplay(): boolean {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  return window.matchMedia(WIDE).matches && !window.matchMedia(REDUCED).matches && !saveData;
}

function subscribe(onChange: () => void): () => void {
  const lists = [window.matchMedia(WIDE), window.matchMedia(REDUCED)];
  lists.forEach((l) => l.addEventListener("change", onChange));
  return () => lists.forEach((l) => l.removeEventListener("change", onChange));
}

export function HeroClipPlayer({ src, poster, alt }: { src: string | null; poster: string; alt: string }) {
  const autoplay = useSyncExternalStore(subscribe, canAutoplay, () => false);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!autoplay || !video) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.4 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [autoplay]);

  return (
    <>
      <Image src={poster} alt={alt} fill priority sizes="(min-width: 768px) 384px, 112px" className="object-cover" />
      {autoplay && src ? (
        <video
          ref={ref}
          src={src}
          poster={poster}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </>
  );
}
