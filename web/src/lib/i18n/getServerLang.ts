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
import type { Lang } from "./lang";

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
