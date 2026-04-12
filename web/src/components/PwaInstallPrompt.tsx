"use client";

import { useEffect, useState, useRef } from "react";

/**
 * PWA install prompt — shows a non-intrusive bottom banner when the browser
 * fires `beforeinstallprompt`. Dismisses after install or manual close.
 * Respects a 24h cooldown via localStorage so it doesn't nag.
 */
export function PwaInstallPrompt() {
  const [show, setShow] = useState(false);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Don't show if already installed or recently dismissed
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    const dismissed = localStorage.getItem("pwa-dismiss");
    if (dismissed && Date.now() - Number(dismissed) < 24 * 60 * 60 * 1000) return;

    function handler(e: Event) {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      setShow(true);
    }

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredRef.current) return;
    deferredRef.current.prompt();
    const result = await deferredRef.current.userChoice;
    if (result.outcome === "accepted") {
      setShow(false);
    }
    deferredRef.current = null;
  };

  const handleDismiss = () => {
    setShow(false);
    localStorage.setItem("pwa-dismiss", String(Date.now()));
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[80] mx-auto max-w-md animate-[slideUp_0.3s_ease-out]">
      <div className="flex items-center gap-3 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--gold)]/30 backdrop-blur-xl px-4 py-3 shadow-2xl shadow-black/40">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--gold)]/20">
          <span className="font-display text-sm font-black text-[var(--gold)]">KC</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Installer KCKILLS</p>
          <p className="text-[10px] text-[var(--text-muted)]">
            Acc&egrave;s rapide + plein &eacute;cran
          </p>
        </div>
        <button
          onClick={handleInstall}
          className="rounded-lg bg-[var(--gold)] px-3 py-1.5 text-[11px] font-bold text-black hover:bg-[var(--gold-bright)] transition-colors flex-shrink-0"
        >
          Installer
        </button>
        <button
          onClick={handleDismiss}
          className="text-[var(--text-muted)] hover:text-white p-1 flex-shrink-0"
          aria-label="Fermer"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// TypeScript type for the BeforeInstallPromptEvent (not in lib.dom.d.ts)
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
