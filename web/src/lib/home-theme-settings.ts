import "server-only";
import { readConfig } from "@/lib/admin/config-store";

/**
 * Thème d'accueil forcé depuis l'admin (/admin/themes), stocké sur R2
 * (config/home-theme.json). Prioritaire sur KCKILLS_HOME_THEME (variable
 * d'environnement, qui demandait un redéploiement) et sur le choix
 * automatique (prochain match, thèmes datés).
 */
export interface HomeThemeSetting {
  /** Id du thème forcé, null = automatique. */
  forceId: string | null;
  /** Fin du forçage (ISO), null = jusqu'à nouvel ordre. */
  until: string | null;
  setAt?: string;
}

export async function getHomeThemeSetting(): Promise<HomeThemeSetting> {
  const s = await readConfig<HomeThemeSetting>("home-theme");
  return { forceId: s?.forceId ?? null, until: s?.until ?? null, setAt: s?.setAt };
}

/** Id à forcer maintenant, ou null (forçage absent ou expiré). */
export async function getHomeThemeOverride(now = new Date()): Promise<string | null> {
  const s = await getHomeThemeSetting();
  if (!s.forceId) return null;
  if (s.until && Date.parse(s.until) <= now.getTime()) return null;
  return s.forceId;
}
