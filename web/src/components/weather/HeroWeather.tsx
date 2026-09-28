"use client";

import { useEffect, useRef, useState } from "react";
import type { MoodWeather } from "@/lib/mood/presets";
import { emitStrike, emitSweep, setSky, subscribeStrike, subscribeSweep } from "@/lib/mood/sky";
import { useMoodWeather } from "@/lib/mood/use-mood-weather";
import type { HeroSkyHandle, HeroSkyState } from "./hero-sky-gl";
import { WeatherFlash } from "./WeatherFlash";

/**
 * Météo du hero de l'accueil (lib/mood) : pluie, rayons de soleil,
 * poussières d'or, ombres de nuages, étincelles, éclairs — par-dessus la
 * photo, sous le texte. Montée après l'idle (zéro impact sur le LCP), en
 * fondu ; en pause hors écran et onglet caché ; rien en reduced-motion ni
 * sans WebGL2. Rendu à 0,75 px par px CSS ; 30 images/s sur mobile.
 */
function stateOf(w: MoodWeather): HeroSkyState {
  // la pluie penche avec le vent, un peu plus fort en tempête
  return { ...w.hero, wind: Math.min(1, 0.25 + (w.wind - 1.5) * 0.35) };
}

export function HeroWeather() {
  const weather = useMoodWeather();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<HeroSkyHandle | null>(null);
  const [armed, setArmed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const arm = () => setArmed(true);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(arm, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(arm, 1500);
    return () => clearTimeout(t);
  }, []);

  const hasWeather = weather !== null;
  const weatherRef = useRef(weather);
  useEffect(() => {
    weatherRef.current = weather;
    if (!weather) return;
    setSky(weather);
    handleRef.current?.set(stateOf(weather));
  }, [weather]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const w0 = weatherRef.current;
    if (!armed || !hasWeather || !canvas || !w0) return;
    let disposed = false;
    let offSweep = () => {};
    let offStrike = () => {};
    let io: IntersectionObserver | null = null;
    let onVis = () => {};
    import("./hero-sky-gl")
      .then(({ mountHeroSky }) => {
        if (disposed) return;
        const mobile = window.innerWidth < 768;
        const h = mountHeroSky(canvas, stateOf(w0), { scale: 0.75, fps: mobile ? 30 : 60 });
        if (!h) return;
        handleRef.current = h;
        setVisible(true);
        offSweep = subscribeSweep((e) => h.sweep(e.strength));
        offStrike = subscribeStrike((e) => h.strike(e.x, e.strength));
        // dev : déclencher à la main depuis la console / les captures
        if (process.env.NODE_ENV !== "production") {
          (window as Window & { __kcSky?: unknown }).__kcSky = { emitStrike, emitSweep };
        }
        let onScreen = true;
        const sync = () => h.setPaused(!onScreen || document.hidden);
        io = new IntersectionObserver(([entry]) => {
          onScreen = entry.isIntersecting;
          sync();
        });
        io.observe(canvas);
        onVis = sync;
        document.addEventListener("visibilitychange", onVis);
      })
      .catch((err: unknown) => console.warn("[HeroWeather] ciel indisponible :", err));
    return () => {
      disposed = true;
      offSweep();
      offStrike();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [armed, hasWeather]);

  // Étalonnage de la photo (désaturée en tempête, dorée dans la gloire) :
  // du CSS pur, appliqué dès que la météo est connue, même sans WebGL.
  const grade = weather?.hero.grade ?? "none";
  const grading = (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 motion-safe:transition-[backdrop-filter] motion-safe:duration-[1500ms]"
      style={{ backdropFilter: grade, WebkitBackdropFilter: grade }}
    />
  );
  if (!armed) return grade === "none" ? null : grading;
  return (
    <>
      {grade !== "none" && grading}
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-1000"
        style={{ opacity: visible ? 1 : 0 }}
      />
      <WeatherFlash />
    </>
  );
}
