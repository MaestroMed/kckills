"use client";

/**
 * Pilote de l'ouverture (HomeOpening) : clic ou touche = passer, fin à 2,6 s,
 * et première arrivée sur l'accueil par navigation interne (le script de
 * <head> n'a alors pas tourné) : on marque la session et on lance la cascade.
 */
import { useEffect } from "react";

export function OpeningControl() {
  useEffect(() => {
    const d = document.documentElement;
    if (!d.dataset.intro) {
      try {
        if (sessionStorage.getItem("kc-intro") || matchMedia("(prefers-reduced-motion: reduce)").matches) {
          d.dataset.intro = "seen";
          return;
        }
        sessionStorage.setItem("kc-intro", "1");
      } catch {
        /* stockage indisponible : on joue quand même */
      }
      d.dataset.intro = "play";
    }
    if (d.dataset.intro !== "play") return;
    const end = () => {
      if (d.dataset.intro === "play") d.dataset.intro = "done";
    };
    const el = document.getElementById("kc-opening");
    el?.addEventListener("click", end);
    window.addEventListener("keydown", end, { once: true });
    const id = window.setTimeout(end, 2600);
    return () => {
      el?.removeEventListener("click", end);
      window.removeEventListener("keydown", end);
      window.clearTimeout(id);
    };
  }, []);
  return null;
}
