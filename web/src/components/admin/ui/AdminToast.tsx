"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type ToastKind = "success" | "error" | "info";

interface AdminToast {
  id: number;
  text: string;
  kind: ToastKind;
}

interface AdminToastApi {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
  /** Dismiss a toast by id (rarely needed — they auto-dismiss). */
  dismiss: (id: number) => void;
}

const NOOP_API: AdminToastApi = {
  success: () => {},
  error: () => {},
  info: () => {},
  dismiss: () => {},
};

const AdminToastCtx = createContext<AdminToastApi>(NOOP_API);

/**
 * useAdminToast — call from any client component inside <AdminToastProvider>.
 *
 *   const toast = useAdminToast();
 *   toast.success("Job retried");
 *   toast.error("Failed to publish");
 *   toast.info("3 new comments to moderate");
 *
 * Outside the provider, calls are no-ops (won't crash).
 */
export function useAdminToast(): AdminToastApi {
  return useContext(AdminToastCtx);
}

/**
 * AdminToastProvider — admin-styled toast container.
 *
 * Independent from the public <ToastProvider> on purpose: admin pages
 * can be wrapped without touching the public-side context, and the
 * styling is tuned to the dense admin top-right placement (vs centered
 * pill on public).
 *
 * Default duration: 3.5s for success/info, 6s for errors (so the user
 * has time to read the failure reason).
 */
export function AdminToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<AdminToast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (text: string, kind: ToastKind) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, text, kind }]);
      const duration = kind === "error" ? 6000 : 3500;
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const api: AdminToastApi = {
    success: (t) => push(t, "success"),
    error: (t) => push(t, "error"),
    info: (t) => push(t, "info"),
    dismiss,
  };

  return (
    <AdminToastCtx.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </AdminToastCtx.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: AdminToast[];
  onDismiss: (id: number) => void;
}) {
  // Avoid SSR portal issues: render only after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed top-16 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none max-w-[calc(100vw-2rem)]"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: AdminToast; onDismiss: () => void }) {
  const styles: Record<ToastKind, { bg: string; border: string; icon: string }> = {
    success: {
      bg: "bg-[var(--green)]/10",
      border: "border-[var(--green)]/50",
      icon: "✓",
    },
    error: {
      bg: "bg-[var(--red)]/10",
      border: "border-[var(--red)]/50",
      icon: "✕",
    },
    info: {
      bg: "bg-[var(--cyan)]/10",
      border: "border-[var(--cyan)]/50",
      icon: "ℹ",
    },
  };
  const s = styles[toast.kind];
  const iconColor =
    toast.kind === "success"
      ? "text-[var(--green)]"
      : toast.kind === "error"
        ? "text-[var(--red)]"
        : "text-[var(--cyan)]";

  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={`pointer-events-auto rounded-lg border ${s.border} ${s.bg} backdrop-blur-md shadow-2xl px-3.5 py-2.5 min-w-[240px] max-w-[420px] flex items-start gap-2.5 animate-[slideUp_0.25s_cubic-bezier(0.16,1,0.3,1)]`}
    >
      <span aria-hidden="true" className={`text-sm font-bold ${iconColor}`}>
        {s.icon}
      </span>
      <p className="text-xs text-[var(--text-primary)] flex-1 leading-relaxed">{toast.text}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fermer la notification"
        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs leading-none -mt-0.5"
      >
        ✕
      </button>
    </div>
  );
}
