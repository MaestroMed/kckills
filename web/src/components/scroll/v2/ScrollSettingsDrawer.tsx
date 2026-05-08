"use client";

/**
 * ScrollSettingsDrawer — V20 (Wave 21.6).
 *
 * Tiny settings popover surfaced from a ⚙ button in the /scroll top
 * bar. Initial scope :
 *
 *   * Auto-advance toggle (V20) — when ON, the pool stops looping
 *     each clip and instead fires a `kc:auto-advance` window event
 *     on `ended`, which `ScrollFeedV2` consumes to call `jumpTo`.
 *   * Future hooks for V19 (speed control) + V29 (negative
 *     feedback prefs) will land in the same surface.
 *
 * Storage : `localStorage.kc_scroll_settings_v1`. Versioned so future
 * schema additions don't trip on stale shapes.
 *
 * The drawer is anchored top-right ; clicking outside closes it ;
 * Escape closes it. ARIA-labelled, tab-accessible.
 */

import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "kc_scroll_settings_v1";

export interface ScrollSettingsState {
  autoAdvance: boolean;
}

const DEFAULTS: ScrollSettingsState = { autoAdvance: false };

function readSettings(): ScrollSettingsState {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ScrollSettingsState>;
    return {
      ...DEFAULTS,
      ...parsed,
      // Defensive : coerce any non-boolean into the default.
      autoAdvance: typeof parsed.autoAdvance === "boolean"
        ? parsed.autoAdvance
        : DEFAULTS.autoAdvance,
    };
  } catch {
    return DEFAULTS;
  }
}

function writeSettings(s: ScrollSettingsState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* quota / storage disabled — silent */
  }
}

/** Hook for any consumer that needs to react to a settings change.
 *  Listens for the `kc:scroll-settings-changed` CustomEvent so a
 *  sibling component (e.g. the pool) can pick up the change without
 *  polling localStorage on every render. */
export function useScrollSettings(): ScrollSettingsState {
  const [state, setState] = useState<ScrollSettingsState>(readSettings);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => setState(readSettings());
    window.addEventListener("kc:scroll-settings-changed", onChange);
    // storage event for cross-tab sync
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY) setState(readSettings());
    });
    return () => {
      window.removeEventListener("kc:scroll-settings-changed", onChange);
    };
  }, []);

  return state;
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
}

export function ScrollSettingsDrawer({ open, onClose }: DrawerProps) {
  const [settings, setSettings] = useState<ScrollSettingsState>(readSettings);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Re-sync from storage on open in case another tab changed it.
  useEffect(() => {
    if (open) setSettings(readSettings());
  }, [open]);

  // Close on Escape + click outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    // Defer the click handler so the open-trigger click doesn't
    // immediately close it.
    const t = window.setTimeout(
      () => window.addEventListener("mousedown", onClick),
      0,
    );
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  const updateSetting = <K extends keyof ScrollSettingsState>(
    key: K,
    value: ScrollSettingsState[K],
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    writeSettings(next);
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(new CustomEvent("kc:scroll-settings-changed"));
      } catch {
        /* CustomEvent unsupported — silent */
      }
    }
  };

  return (
    <div
      ref={drawerRef}
      role="dialog"
      aria-label="Réglages du scroll"
      className="fixed top-16 right-3 z-[210] w-72 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/95 backdrop-blur-md shadow-2xl shadow-black/50 p-4 space-y-3 text-sm"
    >
      <header className="flex items-center justify-between">
        <h2 className="font-display text-xs font-bold uppercase tracking-widest text-[var(--gold)]">
          Réglages
        </h2>
        <button
          type="button"
          aria-label="Fermer les réglages"
          onClick={onClose}
          className="h-6 w-6 inline-flex items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <label className="flex items-start justify-between gap-3 cursor-pointer">
        <span className="flex-1">
          <span className="block text-[var(--text-primary)] font-semibold">
            Avancer automatiquement
          </span>
          <span className="block text-[10px] text-[var(--text-muted)] mt-0.5">
            Passe au clip suivant à la fin de chaque vidéo (au lieu
            de la boucle).
          </span>
        </span>
        <input
          type="checkbox"
          checked={settings.autoAdvance}
          onChange={(e) => updateSetting("autoAdvance", e.target.checked)}
          className="mt-1 h-4 w-4 cursor-pointer accent-[var(--gold)]"
        />
      </label>
    </div>
  );
}
