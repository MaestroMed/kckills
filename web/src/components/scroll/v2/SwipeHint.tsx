"use client";

/**
 * SwipeHint — Vague 4 (2026-08-12).
 *
 * Hint de geste « glisse vers le haut » affiché sur le premier clip de
 * la toute première session (localStorage `kc_swipe_hinted_v1` absent).
 * L'OnboardingModal ne mentionne jamais le swipe — un primo-visiteur
 * peut rester bloqué sur le premier clip sans savoir que le feed se
 * navigue verticalement.
 *
 * Comportement :
 *   - Chevron animé (2 cycles CSS — keyframes kc-swipe-hint dans
 *     globals.css) puis disparition via onAnimationEnd.
 *   - Disparaît immédiatement au premier swipe (activeIndex > 0).
 *   - prefers-reduced-motion → pastille texte statique ~2.8 s à la
 *     place (aucune animation).
 *   - Le flag localStorage est posé dès l'affichage : le hint ne se
 *     montre qu'une seule fois, jamais deux sessions de suite.
 *
 * Zéro re-render du feed : le composant vit à côté du feedStage et ne
 * touche à rien d'autre — il s'affiche, s'anime en pur CSS, se démonte.
 */

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/use-lang";

const FLAG_KEY = "kc_swipe_hinted_v1";

interface Props {
  /** Index actif du feed — le hint se retire au premier changement. */
  activeIndex: number;
}

export function SwipeHint({ activeIndex }: Props) {
  const t = useT();
  const [show, setShow] = useState(false);
  const [reduced, setReduced] = useState(false);

  // Première visite uniquement — le flag est posé dès l'affichage pour
  // que le hint ne revienne jamais (même si l'utilisateur quitte avant
  // la fin de l'animation).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(FLAG_KEY)) return;
      window.localStorage.setItem(FLAG_KEY, "1");
    } catch {
      // storage désactivé — on n'affiche rien plutôt que de spammer
      // le hint à chaque session.
      return;
    }
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setShow(true);
  }, []);

  const dismiss = useCallback(() => setShow(false), []);

  // Premier swipe → le hint a rempli son rôle.
  useEffect(() => {
    if (activeIndex > 0) dismiss();
  }, [activeIndex, dismiss]);

  // Variante reduced-motion : texte statique bref, retiré sur timer.
  useEffect(() => {
    if (!show || !reduced) return;
    const id = window.setTimeout(dismiss, 2800);
    return () => window.clearTimeout(id);
  }, [show, reduced, dismiss]);

  if (!show) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[58%] z-[65] flex flex-col items-center gap-1.5"
      aria-hidden
    >
      {reduced ? (
        <span className="rounded-full bg-black/70 backdrop-blur-sm border border-white/15 px-4 py-2 font-data text-xs text-white/85">
          {t("p_scroll.hint_swipe")}
        </span>
      ) : (
        <>
          <svg
            className="kc-swipe-hint-chevron h-9 w-9 text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            onAnimationEnd={dismiss}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M5 15l7-7 7 7"
            />
          </svg>
          <span className="font-data text-[11px] uppercase tracking-[0.25em] text-white/80 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">
            {t("p_scroll.hint_swipe")}
          </span>
        </>
      )}
    </div>
  );
}
