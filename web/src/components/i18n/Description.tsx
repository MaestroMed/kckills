"use client";

/**
 * <Description> — client component that picks the right ai_description_*
 * field based on the active language.
 *
 * Usage :
 *   <Description kill={kill} />                 // plain text node
 *   <Description kill={kill} as="blockquote" />  // wraps in element
 *
 * Falls back to ai_description_fr → ai_description (legacy) when the
 * requested lang is missing for this kill.
 *
 * For server-side rendering with a known lang, use pickDescription()
 * from @/lib/i18n/server instead.
 */

import { useMemo } from "react";
import { useCurrentLang } from "@/lib/i18n/use-lang";
import type { Lang } from "@/lib/i18n/lang";

interface KillI18n {
  ai_description?: string | null;
  ai_description_fr?: string | null;
  ai_description_en?: string | null;
  ai_description_ko?: string | null;
  ai_description_es?: string | null;
}

function pick(kill: KillI18n, lang: Lang): string {
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

interface Props {
  kill: KillI18n;
  /** Wrap in this element. Default = render as plain text (Fragment). */
  as?: "p" | "span" | "blockquote" | "div";
  className?: string;
  /** Show "« ... »" French quotes around the text. Default false. */
  quoted?: boolean;
  /** Fallback text if every lang field is empty. Default empty string. */
  fallback?: string;
}

export function Description({
  kill,
  as,
  className,
  quoted = false,
  fallback = "",
}: Props) {
  const lang = useCurrentLang();
  const text = useMemo(() => pick(kill, lang), [kill, lang]);
  const display = text || fallback;

  if (!display) return null;

  const content = quoted ? `\u00AB ${display} \u00BB` : display;

  if (!as) return <>{content}</>;
  const Tag = as;
  return <Tag className={className}>{content}</Tag>;
}
