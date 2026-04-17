"use client";

import type { ReactNode } from "react";

interface ChipOption<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

interface FilterChipsProps<T extends string> {
  options: ChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label?: string;
  /** ARIA role preference. Defaults to a radiogroup; pass "tablist" if this
   *  component is used as a tab selector. */
  role?: "radiogroup" | "tablist";
}

/**
 * Horizontal scrollable chips for axis / filter selection. The grid engine
 * uses this for its AxisPivot controls; secondary pages use it for era/
 * player/split filters. One component, consistent look, built-in keyboard
 * nav via ← → arrows through the options.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
  role = "radiogroup",
}: FilterChipsProps<T>) {
  const itemRole = role === "tablist" ? "tab" : "radio";

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const idx = options.findIndex((o) => o.value === value);
    if (idx < 0) return;
    const next =
      e.key === "ArrowRight"
        ? options[(idx + 1) % options.length]
        : options[(idx - 1 + options.length) % options.length];
    onChange(next.value);
  }

  return (
    <div
      role={role}
      aria-label={label}
      className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 py-1"
      style={{ scrollbarWidth: "none" }}
      onKeyDown={handleKeyDown}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={itemRole}
            aria-checked={role === "radiogroup" ? selected : undefined}
            aria-selected={role === "tablist" ? selected : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={
              "flex-shrink-0 rounded-full border px-4 py-1.5 text-xs font-semibold tracking-wide transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)] " +
              (selected
                ? "border-[var(--gold)] bg-[var(--gold)] text-black shadow-lg shadow-[var(--gold)]/20"
                : "border-white/15 bg-white/5 text-white/70 hover:border-[var(--gold)]/40 hover:text-white")
            }
          >
            {o.label}
            {typeof o.count === "number" ? (
              <span className={`ml-1.5 text-[10px] ${selected ? "text-black/60" : "text-white/40"}`}>
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
