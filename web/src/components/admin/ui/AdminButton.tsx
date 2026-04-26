"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type AdminButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type AdminButtonSize = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
  /** Show a spinner instead of children + disable the button. */
  loading?: boolean;
  /** Leading icon. Rendered before children. */
  iconLeft?: ReactNode;
  /** Trailing icon. Rendered after children. */
  iconRight?: ReactNode;
  /** Icon-only button — pass aria-label too! */
  iconOnly?: boolean;
  /** Stretch to parent width. */
  fullWidth?: boolean;
}

const VARIANT_CLS: Record<AdminButtonVariant, string> = {
  primary:
    "bg-[var(--gold)] text-[var(--bg-primary)] hover:bg-[var(--gold-bright)] disabled:bg-[var(--gold-dark)] disabled:text-[var(--text-muted)] focus-visible:outline-[var(--gold-bright)]",
  secondary:
    "bg-transparent border border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/10 hover:border-[var(--gold)]/70 disabled:opacity-50",
  ghost:
    "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--gold)] disabled:opacity-40",
  danger:
    "bg-[var(--red)] text-white hover:bg-[var(--red)]/85 disabled:opacity-50 focus-visible:outline-[var(--red)]",
};

const SIZE_CLS: Record<AdminButtonSize, string> = {
  sm: "px-2.5 py-1 text-[11px] gap-1",
  md: "px-3.5 py-1.5 text-xs gap-1.5",
  lg: "px-5 py-2.5 text-sm gap-2",
};

const ICON_ONLY_SIZE: Record<AdminButtonSize, string> = {
  sm: "h-7 w-7 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-11 w-11 text-base",
};

/**
 * AdminButton — unified button for admin pages.
 *
 *  - primary  → gold filled (CTA: Trigger, Save, Publish)
 *  - secondary→ gold outline (secondary actions: Refresh, Open detail)
 *  - ghost    → no border (subtle: cancel, clear filters, sort header)
 *  - danger   → red filled (destructive: Delete, Reject, Purge DLQ)
 *
 * Forward-refs to <button> so it composes with focus management libraries
 * (react-aria, headlessui dropdowns, ...).
 */
export const AdminButton = forwardRef<HTMLButtonElement, Props>(function AdminButton(
  {
    children,
    variant = "secondary",
    size = "md",
    loading = false,
    iconLeft,
    iconRight,
    iconOnly = false,
    fullWidth = false,
    className = "",
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const baseCls =
    "inline-flex items-center justify-center rounded-md font-semibold uppercase tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed";
  const sizeCls = iconOnly ? ICON_ONLY_SIZE[size] : SIZE_CLS[size];
  const widthCls = fullWidth ? "w-full" : "";

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`${baseCls} ${VARIANT_CLS[variant]} ${sizeCls} ${widthCls} ${className}`}
      {...rest}
    >
      {loading ? (
        <Spinner />
      ) : (
        <>
          {iconLeft ? <span aria-hidden="true">{iconLeft}</span> : null}
          {iconOnly ? null : <span>{children}</span>}
          {iconRight ? <span aria-hidden="true">{iconRight}</span> : null}
        </>
      )}
    </button>
  );
});

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-label="Chargement"
    />
  );
}
