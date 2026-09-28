/**
 * Météo du site — les six temps et leurs réglages (partagés serveur/client).
 *
 * Le temps est calculé côté serveur à partir des résultats et du calendrier
 * de la KC (lib/mood/mood-weather.ts) ; il pilote les étendards (vent,
 * rafales, lumière, rayons, usure, éclairs) et la musique par défaut du
 * lecteur. `?mood=<temps>` dans l'URL force un temps (labo, démonstration).
 *
 * « variable » reproduit exactement le réglage validé le 28/09 (vent 2,3,
 * rafales 7-16 s, rayons 5,5-13 s) : c'est le temps neutre.
 */

export type Mood = "gloire" | "beau" | "variable" | "gris" | "tempete" | "electrique";
export const MOODS: Mood[] = ["gloire", "beau", "variable", "gris", "tempete", "electrique"];

/** Ambiance musicale : le lecteur choisit ses premiers titres en conséquence. */
export type MoodMusic = "hymnes" | "hype" | "epique" | "sombre";

export interface WeatherSettings {
  label: string;
  /** Vent moyen (m/s) et turbulence (fraction de la vitesse). */
  wind: number;
  turbulence: number;
  /** Rafales : amplitude (fraction du vent) et intervalle (s). */
  gustAmp: number;
  gustEvery: [number, number];
  /** Rayons de lumière : intervalle (s) et intensité. */
  raysEvery: [number, number];
  raysStrength: number;
  /** Lumière principale (couleur hex, intensité), exposition, part de l'environnement. */
  keyColor: number;
  keyIntensity: number;
  exposure: number;
  envIntensity: number;
  /** Usure des étendards : 0 = impeccable, 1 = en lambeaux. */
  wear: number;
  /** Éclairs par minute (0 = aucun). */
  lightning: number;
  music: MoodMusic;
  /** Ciel du hero (lib/mood → components/weather/HeroWeather). */
  hero: HeroSky;
}

/** Ciel du hero, chaque effet de 0 à 1. */
export interface HeroSky {
  /** Rayons de soleil (et leur couleur, hex). */
  rays: number;
  rayColor: number;
  /** Poussières d'or en suspension. */
  motes: number;
  /** Ombres de nuages qui passent sur la photo. */
  clouds: number;
  rain: number;
  /** Assombrissement froid, plus marqué en haut. */
  gloom: number;
  /** Étincelles bleues qui montent (match en direct). */
  sparks: number;
  /** Étalonnage de la photo du hero (filtre CSS, appliqué en backdrop-filter). */
  grade: string;
}

export const WEATHER: Record<Mood, WeatherSettings> = {
  gloire: {
    label: "Gloire",
    wind: 1.7,
    turbulence: 0.6,
    gustAmp: 0.55,
    gustEvery: [10, 18],
    raysEvery: [3.5, 6],
    raysStrength: 1.3,
    keyColor: 0xffd9a0,
    keyIntensity: 2.8,
    exposure: 0.96,
    envIntensity: 0.62,
    wear: 0,
    lightning: 0,
    music: "hymnes",
    hero: { rays: 1, rayColor: 0xffcf85, motes: 1, clouds: 0, rain: 0, gloom: 0, sparks: 0, grade: "saturate(1.12) sepia(0.12) brightness(1.03)" },
  },
  beau: {
    label: "Beau temps",
    wind: 2.0,
    turbulence: 0.7,
    gustAmp: 0.75,
    gustEvery: [8, 15],
    raysEvery: [4.5, 9],
    raysStrength: 1.15,
    keyColor: 0xffdfb4,
    keyIntensity: 2.5,
    exposure: 0.92,
    envIntensity: 0.58,
    wear: 0.06,
    lightning: 0,
    music: "hype",
    hero: { rays: 0.7, rayColor: 0xffdca0, motes: 0.55, clouds: 0.1, rain: 0, gloom: 0, sparks: 0, grade: "saturate(1.06) sepia(0.05)" },
  },
  variable: {
    label: "Variable",
    wind: 2.3,
    turbulence: 0.8,
    gustAmp: 0.93,
    gustEvery: [7, 16],
    raysEvery: [5.5, 13],
    raysStrength: 1,
    keyColor: 0xffe4c0,
    keyIntensity: 2.3,
    exposure: 0.88,
    envIntensity: 0.55,
    wear: 0.2,
    lightning: 0,
    music: "epique",
    hero: { rays: 0.35, rayColor: 0xfff0d6, motes: 0.25, clouds: 0.55, rain: 0, gloom: 0.08, sparks: 0, grade: "none" },
  },
  gris: {
    label: "Ciel couvert",
    wind: 2.5,
    turbulence: 1.1,
    gustAmp: 1.0,
    gustEvery: [5, 10],
    raysEvery: [14, 26],
    raysStrength: 0.6,
    keyColor: 0xd9e2f2,
    keyIntensity: 1.75,
    exposure: 0.8,
    envIntensity: 0.46,
    wear: 0.45,
    lightning: 0,
    music: "sombre",
    hero: { rays: 0.08, rayColor: 0xdfe8f5, motes: 0, clouds: 0.85, rain: 0.35, gloom: 0.3, sparks: 0, grade: "saturate(0.7) brightness(0.9)" },
  },
  tempete: {
    label: "Tempête",
    wind: 2.7,
    turbulence: 1.5,
    gustAmp: 0.95,
    gustEvery: [2.5, 6],
    raysEvery: [45, 80],
    raysStrength: 0.35,
    keyColor: 0xb4c4e6,
    keyIntensity: 1.6,
    exposure: 0.8,
    envIntensity: 0.45,
    wear: 0.8,
    lightning: 3,
    music: "sombre",
    hero: { rays: 0, rayColor: 0xcfdcf0, motes: 0, clouds: 1, rain: 1, gloom: 0.55, sparks: 0, grade: "saturate(0.5) brightness(0.78) contrast(1.06)" },
  },
  electrique: {
    label: "Match en direct",
    wind: 2.5,
    turbulence: 1.05,
    gustAmp: 1.0,
    gustEvery: [4, 8],
    raysEvery: [2.8, 5],
    raysStrength: 1.2,
    keyColor: 0xdce9ff,
    keyIntensity: 2.4,
    exposure: 0.92,
    envIntensity: 0.58,
    wear: 0.12,
    lightning: 1.5,
    music: "hype",
    hero: { rays: 0.3, rayColor: 0xbcd6ff, motes: 0, clouds: 0.2, rain: 0, gloom: 0.12, sparks: 1, grade: "saturate(1.1) hue-rotate(-6deg) contrast(1.04)" },
  },
};

export interface MoodWeather extends WeatherSettings {
  mood: Mood;
  /** Moral -1..1 (résultats récents, pondérés par l'âge et l'enjeu). */
  morale: number;
  /** Tension 0..1 (approche du prochain match). */
  tension: number;
  /** Explication lisible : « Défaite 0-3 contre MKOI il y a 10 j · Worlds dans 16 j ». */
  reason: string;
}

export function isMood(x: unknown): x is Mood {
  return typeof x === "string" && (MOODS as string[]).includes(x);
}

/** Temps forcé (labo, démonstration) : réglages du preset, sans calcul. */
export function forcedWeather(mood: Mood): MoodWeather {
  return { ...WEATHER[mood], mood, morale: 0, tension: 0, reason: "Temps forcé" };
}
