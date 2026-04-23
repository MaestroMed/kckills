/**
 * Language switcher core — types, parsers, display metadata.
 *
 * 4 languages :
 *   - fr : French (default, canonical for KC's home audience)
 *   - en : English (international viewers)
 *   - ko : Korean (LCK fans following KC's Korean players Canna, Kyeahoo)
 *   - es : Spanish (LATAM fanbase)
 *
 * Detection chain (descending priority) :
 *   1. Explicit user choice — kc_lang cookie / localStorage
 *   2. Accept-Language header (browser-default locale)
 *   3. Fallback to "fr" (KC is French)
 */

export const LANGS = ["fr", "en", "ko", "es"] as const;
export type Lang = (typeof LANGS)[number];

export const DEFAULT_LANG: Lang = "fr";

export interface LangMeta {
  code: Lang;
  label: string;          // shown in the switcher UI
  flag: string;           // emoji flag
  nativeName: string;     // "Français" / "English" / "한국어" / "Español"
  htmlLang: string;       // value for the <html lang="..."> attribute
}

export const LANG_META: Record<Lang, LangMeta> = {
  fr: { code: "fr", label: "FR", flag: "🇫🇷", nativeName: "Français", htmlLang: "fr-FR" },
  en: { code: "en", label: "EN", flag: "🇬🇧", nativeName: "English",  htmlLang: "en-US" },
  ko: { code: "ko", label: "KR", flag: "🇰🇷", nativeName: "한국어",   htmlLang: "ko-KR" },
  es: { code: "es", label: "ES", flag: "🇪🇸", nativeName: "Español",  htmlLang: "es-ES" },
};

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

/** Parse the browser's Accept-Language header → pick the best supported lang.
 *
 * Examples :
 *   "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"  → "fr"
 *   "en-US,en;q=0.9"                        → "en"
 *   "ko-KR,ko;q=0.9,en;q=0.8"               → "ko"
 *   "ja-JP,ja;q=0.9"                        → DEFAULT_LANG (no match)
 */
export function parseAcceptLanguage(header: string | null | undefined): Lang {
  if (!header) return DEFAULT_LANG;
  // Header format : "lang-region;q=weight, lang;q=weight, ..."
  // We split, sort by q desc, and pick the first one that matches a supported lang.
  const tokens = header
    .split(",")
    .map((t) => {
      const [tag, ...params] = t.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? parseFloat(qParam.split("=")[1]) : 1.0;
      return { tag: tag.toLowerCase(), q: isNaN(q) ? 0 : q };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of tokens) {
    // Try exact 2-letter prefix match
    const prefix = tag.split("-")[0];
    if (isLang(prefix)) return prefix;
  }
  return DEFAULT_LANG;
}

/** Cookie + localStorage key used everywhere. */
export const LANG_COOKIE = "kc_lang";

/** 1 year in seconds — Lang choice persists across sessions. */
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
