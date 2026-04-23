import "server-only";
import { cookies, headers } from "next/headers";
import {
  DEFAULT_LANG,
  LANG_COOKIE,
  type Lang,
  isLang,
  parseAcceptLanguage,
} from "./lang";

/**
 * Resolve the active language for a server-rendered request.
 *
 * Priority chain :
 *   1. `kc_lang` cookie (explicit user choice — highest priority)
 *   2. Accept-Language header (browser preference)
 *   3. DEFAULT_LANG (French — KC home audience)
 *
 * Reads cookies()/headers() — works in RSC + route handlers + middleware.
 */
export async function getServerLang(): Promise<Lang> {
  // Cookie path
  try {
    const c = await cookies();
    const fromCookie = c.get(LANG_COOKIE)?.value;
    if (isLang(fromCookie)) return fromCookie;
  } catch {
    // cookies() can throw outside RSC (build-time prerender). Fall through.
  }

  // Accept-Language header path
  try {
    const h = await headers();
    return parseAcceptLanguage(h.get("accept-language"));
  } catch {
    return DEFAULT_LANG;
  }
}

/**
 * Pick the right description column for a kill row.
 *
 * Fallback order :
 *   1. ai_description_<lang>  (the requested language)
 *   2. ai_description_fr      (canonical French)
 *   3. ai_description         (legacy column for pre-PR14 clips)
 *   4. ""                     (empty)
 */
export interface KillI18nFields {
  ai_description?: string | null;
  ai_description_fr?: string | null;
  ai_description_en?: string | null;
  ai_description_ko?: string | null;
  ai_description_es?: string | null;
}

export function pickDescription(
  kill: KillI18nFields | null | undefined,
  lang: Lang,
): string {
  if (!kill) return "";
  const localized =
    lang === "fr" ? kill.ai_description_fr :
    lang === "en" ? kill.ai_description_en :
    lang === "ko" ? kill.ai_description_ko :
    lang === "es" ? kill.ai_description_es :
    null;
  return (
    (localized && localized.trim())
    || (kill.ai_description_fr && kill.ai_description_fr.trim())
    || (kill.ai_description && kill.ai_description.trim())
    || ""
  );
}
