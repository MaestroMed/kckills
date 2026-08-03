"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, m } from "motion/react";

/**
 * Fond du hero — carrousel d'images plein écran.
 *
 * Remplace l'ancien fond vidéo. Un seul clip du hero pesait 19,4 Mo et partait
 * en autoPlay : 85 % des 14,29 Mo de la page d'accueil, téléchargés avant même
 * que le visiteur ne scrolle. Des photos servies par next/image coûtent deux
 * ordres de grandeur de moins, pour un rendu plus net qu'une vidéo compressée
 * étirée en plein écran.
 *
 * Parti pris visuel : fondu long, jamais de coupe. Chaque image reste posée
 * huit secondes, la transition en dure trois — on doit avoir le temps de
 * regarder, et deux images se superposent toujours pendant le fondu pour qu'il
 * n'y ait aucun trou noir. Un très lent zoom avant accompagne le plan et donne
 * la respiration d'un mouvement de caméra ; il est volontairement faible
 * (4 % sur toute la durée) pour rester ressenti sans être vu.
 *
 * La première image est prioritaire et sert d'élément LCP : elle est rendue
 * sans animation d'entrée, sinon on retomberait sur le problème d'opacité
 * initiale qui retarde la peinture.
 */

export interface HeroImage {
  /** Chemin public de l'image, ex. /images/hero/ewc-celebration.jpg */
  src: string;
  /** Description pour les lecteurs d'écran — décrire la scène, pas « photo ». */
  alt: string;
  /**
   * Point d'intérêt à préserver au recadrage, en syntaxe object-position.
   * Sur un hero plein écran en mobile, le centre par défaut coupe souvent les
   * visages ; « 50% 35% » remonte le cadrage vers le haut du sujet.
   */
  focus?: string;
}

interface HeroImageCarouselProps {
  images: HeroImage[];
  /** Durée d'affichage de chaque image, fondu compris (ms). */
  holdMs?: number;
}

const FADE_SECONDS = 3;

export function HeroImageCarousel({ images, holdMs = 8000 }: HeroImageCarouselProps) {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Un visiteur qui demande moins d'animation reste sur la première image :
  // un fond qui change tout seul est précisément ce qu'il cherche à éviter.
  useEffect(() => {
    if (reducedMotion || images.length < 2) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % images.length);
    }, holdMs);
    return () => clearInterval(id);
  }, [reducedMotion, images.length, holdMs]);

  if (images.length === 0) return null;

  const current = images[index];

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden={images.length > 1}>
      <AnimatePresence initial={false}>
        <m.div
          key={current.src}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: FADE_SECONDS, ease: "easeInOut" }}
        >
          <m.div
            className="absolute inset-0"
            initial={{ scale: 1 }}
            animate={{ scale: reducedMotion ? 1 : 1.04 }}
            transition={{ duration: holdMs / 1000 + FADE_SECONDS, ease: "linear" }}
          >
            <Image
              src={current.src}
              alt={current.alt}
              fill
              // La première image du carrousel est l'élément LCP de la page.
              priority={index === 0}
              sizes="100vw"
              className="object-cover"
              style={{ objectPosition: current.focus ?? "50% 40%" }}
            />
          </m.div>
        </m.div>
      </AnimatePresence>
    </div>
  );
}
