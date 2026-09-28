/**
 * Ciel partagé de la page : passages de lumière et éclairs, déclenchés au
 * hasard à la cadence de la météo (lib/mood/presets). Un seul ciel pour
 * tout ce qui s'abonne (étendards 3D, météo du hero) : le même rayon balaie
 * les étendards l'un après l'autre, le même éclair frappe partout en même
 * temps. Chaque éclair est aussi publié sur `window` (`kckills:lightning`).
 *
 * Aucun déclenchement automatique tant que personne n'écoute, ni avec
 * `?nosweep` dans l'URL (capture de l'image de repli des étendards).
 */
import { WEATHER, type WeatherSettings } from "./presets";

export interface SweepEvent {
  at: number;
  angle: number;
  strength: number;
}
export interface StrikeEvent {
  at: number;
  /** Côté de l'éclair, -1 (gauche) … 1 (droite). */
  x: number;
  strength: number;
}

const sky = {
  raysEvery: WEATHER.variable.raysEvery,
  raysStrength: 1,
  lightning: 0,
};
const sweepSubs = new Set<(e: SweepEvent) => void>();
const strikeSubs = new Set<(e: StrikeEvent) => void>();
let sweepTimer = 0;
let strikeTimer = 0;
const autoSky = () => typeof location !== "undefined" && !new URLSearchParams(location.search).has("nosweep");

function scheduleSweep(first = false) {
  window.clearTimeout(sweepTimer);
  if (sweepSubs.size === 0 || !autoSky()) return;
  const [a, b] = sky.raysEvery;
  const delay = first ? 2200 + Math.random() * 1200 : (a + Math.random() * (b - a)) * 1000;
  sweepTimer = window.setTimeout(() => {
    emitSweep(sky.raysStrength);
    scheduleSweep();
  }, delay);
}

/** Déclenche un passage de lumière (aussi exposé au labo). */
export function emitSweep(strength = 1): void {
  const e: SweepEvent = { at: performance.now(), angle: -0.62 + (Math.random() - 0.5) * 0.45, strength };
  sweepSubs.forEach((f) => f(e));
}

export function subscribeSweep(f: (e: SweepEvent) => void): () => void {
  sweepSubs.add(f);
  if (sweepSubs.size === 1) scheduleSweep(true);
  return () => {
    sweepSubs.delete(f);
    if (sweepSubs.size === 0) window.clearTimeout(sweepTimer);
  };
}

// Éclairs : intervalle exponentiel (moyenne 60 / éclairs par minute), jamais
// moins de 4 s. Un éclair = deux flashs à 260 ms (l'éclair « se reprend ») :
// au plus deux flashs par seconde, sous le seuil WCAG 2.3.1 de trois.
function scheduleStrike() {
  window.clearTimeout(strikeTimer);
  if (sky.lightning <= 0 || strikeSubs.size === 0 || !autoSky()) return;
  const delay = Math.max(4, -Math.log(1 - Math.random()) * (60 / sky.lightning)) * 1000;
  strikeTimer = window.setTimeout(() => {
    emitStrike();
    scheduleStrike();
  }, delay);
}

/** Déclenche un éclair (aussi exposé au labo). */
export function emitStrike(strength = 1): void {
  const e: StrikeEvent = { at: performance.now(), x: Math.random() * 2 - 1, strength };
  strikeSubs.forEach((f) => f(e));
  window.dispatchEvent(new CustomEvent<StrikeEvent>("kckills:lightning", { detail: e }));
}

export function subscribeStrike(f: (e: StrikeEvent) => void): () => void {
  strikeSubs.add(f);
  if (strikeSubs.size === 1) scheduleStrike();
  return () => {
    strikeSubs.delete(f);
    if (strikeSubs.size === 0) window.clearTimeout(strikeTimer);
  };
}

/** Intensité d'un éclair `t` secondes après la frappe (0..~1). */
export function strikeEnvelope(t: number): number {
  const pulse = (t0: number, amp: number, decay: number) => {
    const u = t - t0;
    if (u < 0) return 0;
    return amp * (u < 0.03 ? u / 0.03 : Math.exp(-(u - 0.03) / decay));
  };
  return pulse(0, 1, 0.09) + pulse(0.26, 0.55, 0.14);
}

/** Durée d'un passage de lumière (ms). */
export const SWEEP_MS = 1500;

/** Règle la cadence du ciel sur la météo (idempotent). */
export function setSky(w: WeatherSettings): void {
  const raysChanged = w.raysEvery[0] !== sky.raysEvery[0] || w.raysEvery[1] !== sky.raysEvery[1];
  const lightningChanged = w.lightning !== sky.lightning;
  sky.raysEvery = w.raysEvery;
  sky.raysStrength = w.raysStrength;
  sky.lightning = w.lightning;
  if (raysChanged) scheduleSweep();
  if (lightningChanged) scheduleStrike();
}
