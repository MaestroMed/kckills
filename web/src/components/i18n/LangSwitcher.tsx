"use client";

/**
 * Language switcher — 4 chips at the top-right of the header.
 *
 * Click a chip → instantly changes the active language :
 *   - All client components reading useLang() update immediately
 *   - The cookie is set so the next server render picks it up
 *   - router.refresh() re-runs server components with the new cookie
 *
 * Visually compact (4 small flag chips) so it fits in the header
 * without dominating it.
 */

import { useState, useEffect } from "react";
import { LANGS, LANG_META, type Lang } from "@/lib/i18n/lang";
import { useLang } from "@/lib/i18n/use-lang";
import { track } from "@/lib/analytics/track";

export function LangSwitcher({
  variant = "compact",
}: {
  variant?: "compact" | "full";
}) {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch — only render the active state after mount.
  useEffect(() => setMounted(true), []);

  if (variant === "compact") {
    // Single chip showing current lang ; click opens the dropdown
    const current = LANG_META[mounted ? lang : "fr"];
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={`Language : ${current.nativeName}. Click to change.`}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-gold)] bg-[var(--bg-surface)]/70 px-2 py-1 text-[10px] font-data uppercase tracking-widest text-[var(--text-secondary)] hover:border-[var(--gold)]/60 hover:text-[var(--gold)] transition-colors"
        >
          <span aria-hidden className="text-base leading-none">{current.flag}</span>
          <span>{current.label}</span>
          <svg className="h-2.5 w-2.5 opacity-60" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {open && (
          <>
            {/* Backdrop captures outside-click */}
            <button
              type="button"
              aria-hidden
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40"
            />
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md border border-[var(--border-gold)] bg-[var(--bg-elevated)] py-1 shadow-lg">
              {LANGS.map((code) => {
                const m = LANG_META[code];
                const active = mounted && code === lang;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      if (code !== lang) {
                        track("language.changed", {
                          metadata: { from: lang, to: code },
                        });
                      }
                      setLang(code);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors ${
                      active
                        ? "bg-[var(--gold)]/10 text-[var(--gold)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-white"
                    }`}
                  >
                    <span aria-hidden className="text-base leading-none">{m.flag}</span>
                    <span className="font-data uppercase tracking-widest text-[10px]">{m.label}</span>
                    <span className="ml-auto text-[10px] opacity-70">{m.nativeName}</span>
                    {active && (
                      <svg className="h-3 w-3 ml-1" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // Full variant : 4 buttons inline, no dropdown (used in /settings)
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-[var(--border-gold)] bg-[var(--bg-surface)] p-1">
      {LANGS.map((code) => {
        const m = LANG_META[code];
        const active = mounted && code === lang;
        return (
          <button
            key={code}
            type="button"
            onClick={() => {
              if (code !== lang) {
                track("language.changed", {
                  metadata: { from: lang, to: code },
                });
              }
              setLang(code);
            }}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-data uppercase tracking-widest transition-colors ${
              active
                ? "bg-[var(--gold)]/15 text-[var(--gold)]"
                : "text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-elevated)]"
            }`}
            aria-label={`Switch to ${m.nativeName}`}
            aria-pressed={active}
          >
            <span aria-hidden className="text-sm">{m.flag}</span>
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
