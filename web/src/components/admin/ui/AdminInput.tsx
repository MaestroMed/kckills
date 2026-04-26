"use client";

import { forwardRef } from "react";
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
} from "react";

// ─── Shared field wrapper ───────────────────────────────────────────────────

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Internal — wraps an input with label + hint + error message rows so
 * every input variant is laid out the same way.
 */
export function AdminField({
  label,
  hint,
  error,
  required,
  htmlFor,
  className = "",
  children,
}: FieldProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]"
        >
          {label}
          {required ? <span className="text-[var(--red)] ml-1">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[11px] text-[var(--red)] font-medium" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] text-[var(--text-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

// ─── Common input visual rules ──────────────────────────────────────────────

const BASE_INPUT_CLS =
  "w-full rounded-md border bg-[var(--bg-elevated)] text-[var(--text-primary)] text-sm px-3 py-2 placeholder:text-[var(--text-disabled)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

function inputBorderCls(error: boolean): string {
  return error
    ? "border-[var(--red)]/60 focus:border-[var(--red)]"
    : "border-[var(--border-gold)] focus:border-[var(--gold)]/50";
}

// ─── Text input ─────────────────────────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Visually wrap with field chrome. Defaults to true; set false to render the bare <input>. */
  withField?: boolean;
}

export const AdminInput = forwardRef<HTMLInputElement, InputProps>(function AdminInput(
  {
    label,
    hint,
    error,
    withField = true,
    required,
    className = "",
    id,
    ...rest
  },
  ref,
) {
  const input = (
    <input
      ref={ref}
      id={id}
      required={required}
      aria-invalid={error ? true : undefined}
      className={`${BASE_INPUT_CLS} ${inputBorderCls(Boolean(error))} ${className}`}
      {...rest}
    />
  );
  if (!withField) return input;
  return (
    <AdminField label={label} hint={hint} error={error} required={required} htmlFor={id}>
      {input}
    </AdminField>
  );
});

// ─── Textarea ───────────────────────────────────────────────────────────────

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  withField?: boolean;
}

export const AdminTextarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function AdminTextarea(
    { label, hint, error, withField = true, required, className = "", id, ...rest },
    ref,
  ) {
    const ta = (
      <textarea
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        className={`${BASE_INPUT_CLS} resize-y min-h-[80px] ${inputBorderCls(Boolean(error))} ${className}`}
        {...rest}
      />
    );
    if (!withField) return ta;
    return (
      <AdminField label={label} hint={hint} error={error} required={required} htmlFor={id}>
        {ta}
      </AdminField>
    );
  },
);

// ─── Select ─────────────────────────────────────────────────────────────────

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  withField?: boolean;
}

export const AdminSelect = forwardRef<HTMLSelectElement, SelectProps>(function AdminSelect(
  { label, hint, error, withField = true, required, className = "", id, children, ...rest },
  ref,
) {
  const sel = (
    <select
      ref={ref}
      id={id}
      required={required}
      aria-invalid={error ? true : undefined}
      className={`${BASE_INPUT_CLS} ${inputBorderCls(Boolean(error))} pr-8 ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
  if (!withField) return sel;
  return (
    <AdminField label={label} hint={hint} error={error} required={required} htmlFor={id}>
      {sel}
    </AdminField>
  );
});

// ─── Checkbox ───────────────────────────────────────────────────────────────

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export const AdminCheckbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function AdminCheckbox({ label, hint, error, className = "", id, ...rest }, ref) {
    return (
      <div className="flex items-start gap-2">
        <input
          ref={ref}
          type="checkbox"
          id={id}
          aria-invalid={error ? true : undefined}
          className={`mt-0.5 h-4 w-4 rounded border-[var(--border-gold)] bg-[var(--bg-elevated)] accent-[var(--gold)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)] ${className}`}
          {...rest}
        />
        <div className="flex-1">
          <label htmlFor={id} className="text-xs text-[var(--text-primary)] cursor-pointer">
            {label}
          </label>
          {error ? (
            <p className="text-[11px] text-[var(--red)] mt-0.5" role="alert">
              {error}
            </p>
          ) : hint ? (
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{hint}</p>
          ) : null}
        </div>
      </div>
    );
  },
);
