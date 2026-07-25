/**
 * Server-side language resolver — alias of `./server`.
 *
 * Wave 5 spec asks for `getServerLang.ts` as the canonical path. The
 * actual implementation already lives in `./server.ts` (built earlier in
 * the i18n scaffold) — we re-export here so consumers can import either :
 *
 *   import { getServerLang } from "@/lib/i18n/getServerLang";
 *   import { getServerLang } from "@/lib/i18n/server"; // legacy ok
 *
 * Adds a small server-side helper `serverT()` that returns a translator
 * for use in RSC / route handlers without needing the React hook.
 */

import "server-only";
import { getServerLang } from "./server";
import { locales } from "./locales";
import { DEFAULT_LANG, type Lang } from "./lang";

export { getServerLang } from "./server";

/**
 * Server translator — same fallback logic as `useT()` but synchronous
 * and not tied to React. Pass the resolved `lang` from `getServerLang()`.
 *
 * Usage in an RSC :
 *   const lang = await getServerLang();
 *   const t = serverT(lang);
 *   return <h1>{t("nav.home")}</h1>;
 */
function walk(dict: unknown, path: string): string | undefined {
  if (!dict || typeof dict !== "object") return undefined;
  let cur: unknown = dict;
  for (const seg of path.split(".")) {
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

function interp(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    const v = vars[key];
    return v === undefined ? m : String(v);
  });
}

export type ServerTranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export function serverT(lang: Lang): ServerTranslateFn {
  const active = locales[lang];
  const fr = locales.fr;
  return (key, vars) => {
    const fromActive = walk(active, key);
    if (fromActive !== undefined) return interp(fromActive, vars);
    const fromFr = walk(fr, key);
    if (fromFr !== undefined) return interp(fromFr, vars);
    return key;
  };
}

/**
 * Convenience : resolve lang AND build translator in one call.
 * Most RSC pages will want both.
 *
 * Usage :
 *   const { lang, t } = await getServerT();
 */
export async function getServerT(): Promise<{ lang: Lang; t: ServerTranslateFn }> {
  const lang = await getServerLang();
  return { lang, t: serverT(lang) };
}

/**
 * getStaticT — traducteur SSR qui ne touche AUCUNE API dynamique.
 *
 * Audit 2.0 : `getServerT()` appelle `cookies()` + `headers()` via
 * `getServerLang()`. En Next 15+, toute page qui touche une API dynamique
 * sort du pré-rendu — résultat mesuré : 0 page sur 87 en cache CDN, tous
 * les `revalidate` écrits dans le code étaient morts, et chaque visiteur
 * déclenchait un SSR complet (X-Vercel-Cache: MISS partout).
 *
 * Ce traducteur rend la langue par défaut, exactement comme le layout
 * racine le fait déjà depuis le correctif de cache d'avril
 * (`const initialLang = "fr"`). Le LangProvider client détecte ensuite
 * le cookie / localStorage au montage et rebascule dans la langue du
 * visiteur — même compromis, déjà accepté et documenté, mais étendu aux
 * pages : un bref premier rendu FR contre un site réellement cacheable.
 *
 * À utiliser sur toute page SANS dépendance à la requête. Les pages qui
 * lisent `searchParams` ou des cookies restent sur `getServerT()` : elles
 * sont dynamiques par nature, rien à gagner.
 */
export function getStaticT(): { lang: Lang; t: ServerTranslateFn } {
  return { lang: DEFAULT_LANG, t: serverT(DEFAULT_LANG) };
}
