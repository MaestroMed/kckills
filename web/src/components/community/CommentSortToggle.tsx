"use client";

/**
 * CommentSortToggle — Latest / Top toggle for the comment list.
 *
 * Two segments, single source of truth (parent owns the state). Latest
 * is the default. Top sorts by Wilson lower-bound (see
 * web/src/lib/comments.ts → commentWilsonScore()) which rewards
 * high-confidence positive ratios over flat averages on small samples.
 *
 * Mobile : segment buttons are 32px tall, label-only — no icon to keep
 * the strip compact next to the comment count header.
 */

import type { CommentSortMode } from "@/lib/comments";
import { useT } from "@/lib/i18n/use-lang";

interface Props {
  mode: CommentSortMode;
  onChange: (mode: CommentSortMode) => void;
  className?: string;
}

const SEGMENTS: { value: CommentSortMode; labelKey: string; descKey: string }[] = [
  { value: "latest", labelKey: "p6_comm2.sort_latest", descKey: "p6_comm2.sort_latest_desc" },
  { value: "top", labelKey: "p6_comm2.sort_top", descKey: "p6_comm2.sort_top_desc" },
];

export function CommentSortToggle({ mode, onChange, className }: Props) {
  const t = useT();
  return (
    <div
      className={`inline-flex items-center rounded-full bg-white/5 p-0.5 ${className ?? ""}`}
      role="tablist"
      aria-label={t("p6_comm2.sort_aria")}
    >
      {SEGMENTS.map((seg) => {
        const active = seg.value === mode;
        return (
          <button
            key={seg.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={t(seg.descKey)}
            onClick={() => onChange(seg.value)}
            className={`
              h-7 rounded-full px-3 text-[11px] font-semibold uppercase tracking-wider
              transition-colors
              ${active
                ? "bg-[var(--gold)]/20 text-[var(--gold)]"
                : "text-white/55 hover:text-white/85"}
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60
            `.replace(/\s+/g, " ").trim()}
          >
            {t(seg.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
