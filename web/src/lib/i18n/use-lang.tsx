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
