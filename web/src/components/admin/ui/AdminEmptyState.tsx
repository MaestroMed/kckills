import type { ReactNode } from "react";

interface Props {
  /** Big emoji / glyph / SVG illustration. */
  icon?: ReactNode;
  /** Headline. Keep it short. */
  title: string;
  /** Body copy — explain why it's empty + what to do. */
  body?: ReactNode;
  /** Optional CTA — typically an `<AdminButton>`. */
  action?: ReactNode;
  /** Compact = smaller padding for inline / table-cell empty states. */
  compact?: boolean;
  className?: string;
}

/**
 * AdminEmptyState — friendly empty state.
 *
 * Used everywhere a list could legitimately be empty (no jobs in queue,
 * no comments to moderate, no clips matching filters, no reports today,
 * ...). Keep the copy positive — empty often means "everything is fine".
 *
 * Pair with an `AdminTable` empty-slot or render directly inside an
 * `AdminCard` body when the whole block is empty.
 */
export function AdminEmptyState({
  icon = "✓",
  title,
  body,
  action,
  compact = false,
  className = "",
}: Props) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center text-center ${
        compact ? "py-8 px-4 gap-2" : "py-16 px-6 gap-3"
      } ${className}`}
    >
      <div
        aria-hidden="true"
        className={`flex items-center justify-center rounded-full border border-[var(--border-gold)] bg-[var(--bg-elevated)]/50 text-[var(--gold)] ${
          compact ? "h-10 w-10 text-base" : "h-16 w-16 text-2xl"
        }`}
      >
        {icon}
      </div>
      <h3
        className={`font-display font-bold uppercase tracking-wide text-[var(--text-primary)] ${
          compact ? "text-sm" : "text-base"
        }`}
      >
        {title}
      </h3>
      {body ? (
        <p
          className={`text-[var(--text-muted)] max-w-md ${
            compact ? "text-[11px]" : "text-xs"
          }`}
        >
          {body}
        </p>
      ) : null}
      {action ? <div className={compact ? "mt-1" : "mt-2"}>{action}</div> : null}
    </div>
  );
}
