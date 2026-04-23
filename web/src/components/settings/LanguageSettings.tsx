"use client";

/**
 * LanguageSettings — explicit language picker on /settings.
 *
 * The navbar already exposes a quick switcher (LangSwitcher), but
 * /settings is where users go to "make it stick" — so we render the
 * full list with native names + flags and a clear current-state pill.
 *
 * Persistence is delegated to useLang() : cookie + localStorage. A
 * router.refresh() is triggered automatically so RSC components re-pick
 * descriptions in the new language without a full reload.
 */

import { useLang } from "@/lib/i18n/use-lang";
import { LANGS, LANG_META } from "@/lib/i18n/lang";

export function LanguageSettings() {
  const { lang, setLang } = useLang();
  const current = LANG_META[lang];

  return (
    <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold">Langue</h2>
        <span className="text-xs text-[var(--text-muted)]">
          Actuelle : <span className="text-[var(--gold)]">{current.flag} {current.nativeName}</span>
        </span>
      </div>
      <p className="text-sm text-[var(--text-muted)]">
        Choisis la langue des descriptions de clips. Le reste du site reste en français pour l&apos;instant.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {LANGS.map((l) => {
          const meta = LANG_META[l];
          const active = l === lang;
          return (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-3 transition-all ${
                active
                  ? "border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[var(--gold)]"
                  : "border-[var(--border-gold)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--gold)]/40"
              }`}
            >
              <span className="text-2xl leading-none">{meta.flag}</span>
              <span className="text-xs font-medium">{meta.nativeName}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
