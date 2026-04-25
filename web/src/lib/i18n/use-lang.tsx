"use client";

/**
 * Client-side language hook + provider.
 *
 * The Provider is mounted in the root layout's Providers tree. It :
 *   1. Reads the initial lang from a cookie / localStorage / fallback
 *   2. Exposes (lang, setLang) via context to every child
 *   3. Persists changes to cookie + localStorage
 *   4. Updates document.documentElement.lang for screen readers
 *
 * The setLang call also triggers a router.refresh() so server components
 * re-render with the new language picked up by the cookie.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_LANG,
  LANG_COOKIE,
  LANG_COOKIE_MAX_AGE,
  LANG_META,
  type Lang,
  isLang,
} from "./lang";
import { locales } from "./locales";

interface LangContextShape {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangContextShape>({
  lang: DEFAULT_LANG,
  setLang: () => {},
});

/** Read the kc_lang cookie value client-side (browser only). */
function readCookieLang(): Lang | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=([^;]+)`));
  return match && isLang(match[1]) ? match[1] : null;
}

function readStorageLang(): Lang | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(LANG_COOKIE);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Provider for the language context.
 *
 * Pass `initialLang` from a server component if you have it (avoids
 * hydration mismatch). Otherwise the initial render is DEFAULT_LANG
 * and the effect upgrades to the stored / detected value on mount.
 */
export function LangProvider({
  children,
  initialLang,
}: {
  children: ReactNode;
  initialLang?: Lang;
}) {
  const router = useRouter();
  const [lang, setLangState] = useState<Lang>(initialLang ?? DEFAULT_LANG);

  // On mount, read the persisted choice (cookie / localStorage). This
  // catches the case where initialLang wasn't passed and the user has
  // a non-default preference saved.
  useEffect(() => {
    if (initialLang) return;
    const stored = readCookieLang() ?? readStorageLang();
    if (stored && stored !== lang) setLangState(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep <html lang> in sync — accessibility + SEO.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = LANG_META[lang].htmlLang;
    }
  }, [lang]);

  const setLang = useCallback(
    (next: Lang) => {
      if (next === lang) return;
      // 1. Update local state (instant UI flip for client components)
      setLangState(next);
      // 2. Persist to cookie + localStorage
      if (typeof document !== "undefined") {
        document.cookie =
          `${LANG_COOKIE}=${next}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax`;
      }
      try {
        if (typeof window !== "undefined") {
          localStorage.setItem(LANG_COOKIE, next);
        }
      } catch {
        /* localStorage unavailable (private mode etc) — cookie still works */
      }
      // 3. Refresh server components so they re-fetch with the new cookie
      router.refresh();
    },
    [lang, router],
  );

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/** Hook for reading + setting the current language. */
export function useLang(): LangContextShape {
  return useContext(LangContext);
}

/** Read-only hook (lighter — no setter). */
export function useCurrentLang(): Lang {
  return useContext(LangContext).lang;
}

// ════════════════════════════════════════════════════════════════════
// useT() — Translation hook
// ════════════════════════════════════════════════════════════════════

/**
 * Walk a dotted-path key into a nested dict. Returns `undefined` if
 * any segment misses (so we can fall back to FR / the key itself).
 *
 * Example : walk(fr, "feed.mode_live") → "KC EN LIVE"
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

/**
 * Substitute {placeholder} markers with vars values.
 * No fancy ICU — just `{name}` → vars.name.toString().
 *
 * Example : interp("Hello {name}", { name: "Mehdi" }) → "Hello Mehdi"
 */
function interp(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = vars[key];
    return v === undefined ? match : String(v);
  });
}

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Translation hook. Returns a `t()` function that walks the active
 * locale's dictionary and falls back to FR (then the key itself) if
 * a key is missing.
 *
 * Usage :
 *   const t = useT();
 *   <button>{t("common.rate")}</button>
 *   <p>{t("rating.n_ratings", { n: 42 })}</p>
 *
 * SSR-safe : during SSR / before client hydration, the active lang is
 * whatever LangProvider received as `initialLang` (server-resolved
 * via getServerLang) — the dict lookup is pure synchronous.
 *
 * If a key is missing in the active language but present in FR :
 *   → returns the FR value (graceful degradation during migration)
 * If missing in BOTH the active lang and FR :
 *   → returns the key string itself (debug-friendly — easy to spot)
 *
 * Performance : the returned `t` is stable per `lang` (memoised), so
 * passing it as a prop won't trigger unnecessary re-renders.
 */
export function useT(): TranslateFn {
  const lang = useCurrentLang();
  return useMemo<TranslateFn>(() => {
    const activeDict = locales[lang];
    const frDict = locales.fr;
    return (key: string, vars?: Record<string, string | number>) => {
      const fromActive = walk(activeDict, key);
      if (fromActive !== undefined) return interp(fromActive, vars);
      const fromFr = walk(frDict, key);
      if (fromFr !== undefined) return interp(fromFr, vars);
      // Missing everywhere — return the key so it shows up loudly in
      // the UI and is easy to grep for.
      return key;
    };
  }, [lang]);
}

/**
 * Lower-level helper for cases where you need both the active lang AND
 * the translator (e.g. building lang-aware URLs, choosing date locales).
 */
export function useLangT(): { lang: Lang; t: TranslateFn } {
  const lang = useCurrentLang();
  const t = useT();
  return useMemo(() => ({ lang, t }), [lang, t]);
}
