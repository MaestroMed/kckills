"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

interface Props {
  /** Initial value (uncontrolled). Use `value` for controlled mode. */
  defaultValue?: string;
  /** Controlled value. Pair with onChange to manage state externally. */
  value?: string;
  /** Called whenever the controlled value changes (keystroke level). */
  onChange?: (next: string) => void;
  /** Called debounced (default 300ms) — use this for the actual search. */
  onSearch: (query: string) => void;
  /** Debounce delay in ms. Default 300. Pass 0 to disable. */
  debounceMs?: number;
  /** Placeholder text. Default: "Rechercher…". */
  placeholder?: string;
  /** Disable the Cmd/Ctrl+K global focus shortcut. Default false. */
  disableShortcut?: boolean;
  /** Width override — defaults to full width. */
  className?: string;
  /** ARIA label override. Default "Recherche". */
  ariaLabel?: string;
  /** Auto-focus on mount. */
  autoFocus?: boolean;
}

/**
 * AdminSearchBar — debounced search input with Cmd-K + Esc shortcuts.
 *
 *   <AdminSearchBar onSearch={(q) => setQuery(q)} />
 *
 *   Cmd/Ctrl+K → focus the input from anywhere
 *   Esc        → clear (when input has focus)
 *   Enter      → fire onSearch immediately (skip debounce)
 *
 * Used at the top of /admin/clips, /admin/audit, /admin/pipeline/jobs
 * etc. — anywhere a list page benefits from quick filtering.
 */
export function AdminSearchBar({
  defaultValue = "",
  value: controlledValue,
  onChange,
  onSearch,
  debounceMs = 300,
  placeholder = "Rechercher…",
  disableShortcut = false,
  className = "",
  ariaLabel = "Recherche",
  autoFocus = false,
}: Props) {
  const isControlled = controlledValue !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const value = isControlled ? controlledValue : internal;
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fireDebounced = useCallback(
    (q: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (debounceMs === 0) {
        onSearch(q);
        return;
      }
      timerRef.current = setTimeout(() => onSearch(q), debounceMs);
    },
    [debounceMs, onSearch],
  );

  const handleChange = (next: string) => {
    if (!isControlled) setInternal(next);
    onChange?.(next);
    fireDebounced(next);
  };

  // Cleanup pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Cmd/Ctrl+K global shortcut.
  useEffect(() => {
    if (disableShortcut) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disableShortcut]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleChange("");
      // Fire immediately on clear so callers reset their list.
      if (timerRef.current) clearTimeout(timerRef.current);
      onSearch("");
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (timerRef.current) clearTimeout(timerRef.current);
      onSearch(value);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <span
        aria-hidden="true"
        className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]"
      >
        ⌕
      </span>
      <input
        ref={inputRef}
        type="search"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full rounded-md border border-[var(--border-gold)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] pl-9 pr-16 py-2 placeholder:text-[var(--text-disabled)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)] focus:border-[var(--gold)]/50 transition-colors"
      />
      {!disableShortcut ? (
        <kbd
          aria-hidden="true"
          className="hidden md:inline-flex absolute right-3 top-1/2 -translate-y-1/2 items-center gap-0.5 rounded border border-[var(--border-gold)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest"
        >
          ⌘K
        </kbd>
      ) : null}
    </div>
  );
}
