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

/** V19 (Wave 21.7) — speed multipliers exposed to the user. Kept
 *  intentionally small (0.5×, 1×, 1.5×, 2×) — wider ranges aren't
 *  useful for short kill clips and just confuse the UI. */
export const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const;
export type ScrollSpeed = (typeof SPEED_OPTIONS)[number];

export interface ScrollSettingsState {
  autoAdvance: boolean;
  /** V19 — clip playback rate. Default 1× = normal. */
  speed: ScrollSpeed;
}

const DEFAULTS: ScrollSettingsState = { autoAdvance: false, speed: 1 };

function readSettings(): ScrollSettingsState {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ScrollSettingsState>;
    // Defensive coercion of each known field. Future schema additions
    // should follow the same pattern so a stale localStorage entry
    // never corrupts the runtime.
    const speed = (SPEED_OPTIONS as readonly number[]).includes(parsed.speed as number)
      ? (parsed.speed as ScrollSpeed)
      : DEFAULTS.speed;
    return {
      ...DEFAULTS,
      ...parsed,
      autoAdvance: typeof parsed.autoAdvance === "boolean"
        ? parsed.autoAdvance
        : DEFAULTS.autoAdvance,
      speed,
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

      {/* V19 (Wave 21.7) — Speed control. Useful for slow-mo of pentas
          (0.5×) or fast-skim of long teamfights (1.5×). */}
      <fieldset className="space-y-2">
        <legend className="block text-[var(--text-primary)] font-semibold">
          Vitesse de lecture
        </legend>
        <p className="text-[10px] text-[var(--text-muted)] -mt-1">
          Slow-mo pour les pentas, fast-skim pour les teamfights.
        </p>
        <div className="flex items-center gap-1.5">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => updateSetting("speed", s)}
              aria-pressed={settings.speed === s}
              className={
                "flex-1 rounded-md px-2 py-1 text-xs font-data tabular-nums transition-colors " +
                (settings.speed === s
                  ? "bg-[var(--gold)] text-black font-bold"
                  : "border border-[var(--border-gold)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--gold)]")
              }
            >
              {s}×
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
