/**
 * Locale registry — single source of truth that maps Lang code → dict.
 *
 * Add a new language here AFTER you've :
 *   1. Created the dict file in this folder
 *   2. Added the Lang code to ../lang.ts
 *   3. Added LANG_META entry in ../lang.ts
 *
 * The `useT()` hook in ../use-lang.tsx reads `locales` and walks the
 * dotted key path against the active language, falling back to FR.
 */

import { fr, type FrDict } from "./fr";
import { en } from "./en";
import { ko } from "./ko";
import { es } from "./es";
import type { Lang } from "../lang";

export const locales: Record<Lang, FrDict> = {
  fr,
  en,
  ko,
  es,
};

export type LocaleKey = keyof typeof locales;
export type { FrDict } from "./fr";
