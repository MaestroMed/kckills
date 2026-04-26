"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "./AdminSidebar";

/**
 * AdminMobileNav — slide-in drawer that mirrors the desktop sidebar on
 * narrow screens. Renders nothing visible until the user taps the
 * hamburger button in the topbar.
 *
 * Behaviour :
 *   - Animation : 200ms ease-out from left
 *   - Backdrop : tap to close
 *   - Body scroll lock while open (toggle <body>.overflow-hidden)
 *   - Auto-close on route change (usePathname)
 *   - ESC key to close
 *   - aria-modal + focus trap NOT implemented in V0 ; the drawer is
 *     simple enough that screen-readers can still navigate it (the
 *     focus naturally moves into the drawer when the hamburger tab-
 *     orders into the visible buttons)
 *
 * The drawer subscribes to a custom window event so the hamburger
 * button (in AdminTopbar) can open it without prop-drilling.
 */
export function AdminMobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const close = useCallback(() => setOpen(false), []);

  // Listen for opener event from topbar
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("kckills:open-admin-drawer", onOpen);
    return () => window.removeEventListener("kckills:open-admin-drawer", onOpen);
  }, []);

  // Auto-close on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Body scroll lock + ESC key
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Menu admin mobile"
      className="md:hidden fixed inset-0 z-[420] flex"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Fermer le menu"
        onClick={close}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
      />

      {/* Drawer panel */}
      <div
        className="relative h-full w-[280px] max-w-[85vw] shadow-2xl animate-[slideInLeft_200ms_ease-out]"
        style={{
          animation: "slideInLeft 200ms ease-out",
        }}
      >
        <AdminSidebar mobileVariant onNavigate={close} />
        <button
          type="button"
          onClick={close}
          aria-label="Fermer"
          className="absolute top-3 right-3 h-8 w-8 rounded-full border border-[var(--border-gold)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--gold)] flex items-center justify-center text-sm"
        >
          ✕
        </button>
      </div>

      {/* Inline keyframes — Tailwind 4 config doesn't define these by default.
          Plain <style> tag works in client components and is hoisted into <head>
          by React. */}
      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/** Hamburger button — fires the open event. Mounted in AdminTopbar. */
export function AdminMobileNavTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("kckills:open-admin-drawer"))}
      aria-label="Ouvrir le menu de navigation"
      className="md:hidden flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-gold)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--gold)]"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}
