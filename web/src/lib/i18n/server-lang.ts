import "server-only";

/**
 * Server-readable language accessor — canonical entry point for RSC.
 *
 * Server components cannot call the client `useLang()` hook, so this
 * module is the SERVER mirror of `use-lang.tsx`. It reads the SAME
 * persistence source the client writes to — the `kc_lang` cookie
 * (see `LANG_COOKIE` in ./lang) — falling back to the Accept-Language
 * header, then DEFAULT_LANG ("fr").
 *
 * The real implementations live in ./server (resolver +
 * pickDescription) and ./getServerLang (serverT translator). This file
 * is the single re-export barrel surface agents should import from :
 *
 *   import { getServerLang, pickDescription } from "@/lib/i18n/server-lang";
 *
 *   const lang = await getServerLang();          // "fr" | "en" | "ko" | "es"
 *   const text = pickDescription(kill, lang);    // lang-aware ai_description
 *
 * Use this instead of rendering `kill.ai_description` / `description_fr`
 * directly — those raw FR fields show French to non-FR visitors.
 *
 * For client components keep using <Description kill={kill} /> /
 * useCurrentLang() from ./use-lang — both read the same cookie.
 */

// Language resolver + description picker (server-only, no React hooks).
export { getServerLang, pickDescription } from "./server";
export type { KillI18nFields } from "./server";

// Server translator helpers (serverT / getServerT) for UI string keys.
export { serverT, getServerT } from "./getServerLang";
export type { ServerTranslateFn } from "./getServerLang";

// Re-export the shared Lang type + default so callers don't need a
// second import from ./lang just to type their `lang` variable.
export { DEFAULT_LANG } from "./lang";
export type { Lang } from "./lang";
