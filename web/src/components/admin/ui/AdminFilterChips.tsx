"use client";

import type { ReactNode } from "react";

export interface FilterChip<T extends string = string> {
  /** Unique identifier returned via onChange. */
  id: T;
  /** Human-readable label. */
  label: ReactNode;
  /** Optional small count suffix (e.g. "12"). */
  count?: number;
  /** Optional leading icon / glyph. */
  icon?: ReactNode;
  /** Disable this chip. */
  disabled?: boolean;
}

interface SingleProps<T extends string> {
  chips: FilterChip<T>[];
  /** Currently active chip id (single-select). null = no chip active. */
  value: T | null;
  /** Called with the new active id, or null when toggling off. */
  onChange: (next: T | null) => void;
  multiple?: false;
  /** Allow toggling the active chip back to null. Default true. */
  allowDeselect?: boolean;
  /** ARIA label for the wrapping toolbar. */
  ariaLabel?: string;
  className?: string;
}

interface MultiProps<T extends string> {
  chips: FilterChip<T>[];
  /** Currently active set (multi-select). */
  value: T[];
  onChange: (next: T[]) => void;
  multiple: true;
  ariaLabel?: string;
  className?: string;
}

type Props<T extends string> = SingleProps<T> | MultiProps<T>;

/**
 * AdminFilterChips — horizontal chip strip for filtering admin lists.
 *
 * Single-select (default):
 *   <AdminFilterChips
 *     chips={[{id:'all', label:'Toutes'}, {id:'pending', label:'À traiter', count: 12}]}
 *     value={status}
 *     onChange={setStatus}
 *   />
 *
 * Multi-select:
 *   <AdminFilterChips multiple chips={...} value={[...]} onChange={setMany} />
 *
 * Accessible: wrapping element exposes role="toolbar" and chips are
 * proper buttons with aria-pressed for toggle state.
 */
export function AdminFilterChips<T extends string>(props: Props<T>) {
  const { chips, ariaLabel = "Filtres", className = "" } = props;

  const isActive = (id: T): boolean => {
    if (props.multiple) return props.value.includes(id);
    return props.value === id;
  };

  const toggle = (id: T) => {
    if (props.multiple) {
      const next = props.value.includes(id)
        ? props.value.filter((x) => x !== id)
        : [...props.value, id];
      props.onChange(next);
    } else {
      const allowDeselect = props.allowDeselect ?? true;
      if (props.value === id) {
        if (allowDeselect) props.onChange(null);
      } else {
        props.onChange(id);
      }
    }
  };

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
    >
      {chips.map((c) => {
        const active = isActive(c.id);
        return (
          <button
            key={c.id}
            type="button"
            disabled={c.disabled}
            aria-pressed={active}
            onClick={() => toggle(c.id)}
            className={[
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)] disabled:opacity-40 disabled:cursor-not-allowed",
              active
                ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]"
                : "border-[var(--border-gold)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--gold)]/50 hover:text-[var(--text-primary)]",
            ].join(" ")}
          >
            {c.icon ? (
              <span aria-hidden="true" className="opacity-80">
                {c.icon}
              </span>
            ) : null}
            <span>{c.label}</span>
            {typeof c.count === "number" ? (
              <span
                className={`rounded-full px-1.5 py-0 text-[9px] font-mono ${
                  active
                    ? "bg-[var(--gold)]/30 text-[var(--gold-bright)]"
                    : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"
                }`}
              >
                {c.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
