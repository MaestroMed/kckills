"use client";

import { useEffect, useState } from "react";
import { forcedWeather, isMood, type MoodWeather } from "./presets";

/**
 * Météo courante côté client : /api/mood une seule fois par session (promesse
 * partagée entre les composants), ou `?mood=<temps>` dans l'URL pour forcer
 * un temps (démonstration : `/?mood=tempete`).
 */
let shared: Promise<MoodWeather> | null = null;

export function fetchMoodWeather(): Promise<MoodWeather> {
  shared ??= fetch("/api/mood")
    .then((r) => (r.ok ? (r.json() as Promise<MoodWeather>) : forcedWeather("variable")))
    .catch(() => forcedWeather("variable"));
  return shared;
}

/** `enabled = false` : pas de requête (la météo ne sert pas sur cette page). */
export function useMoodWeather(enabled = true): MoodWeather | null {
  const [weather, setWeather] = useState<MoodWeather | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const forced = new URLSearchParams(window.location.search).get("mood");
    if (isMood(forced)) {
      setWeather(forcedWeather(forced));
      return;
    }
    let alive = true;
    void fetchMoodWeather().then((w) => {
      if (alive) setWeather(w);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return weather;
}
