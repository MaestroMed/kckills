"use client";

/**
 * InlineAuthPrompt — TikTok-grade Discord login modal that doesn't
 * destroy the user's scroll context.
 *
 * v1 just redirected to /login — the user lost their place in /scroll
 * and was unlikely to come back to like/comment. That's why the
 * ratings + comments tables are sitting at 0 rows.
 *
 * v2 (this) opens an inline modal with the Discord button. Clicking
 * the button POPS the OAuth flow in a child window (window.open), so:
 *   - The parent /scroll page keeps its scroll position + active clip
 *   - When OAuth completes, the popup posts a message to the opener
 *     and self-closes
 *   - The opener listens for "kc:auth:success" and triggers an
 *     `onAuthenticated` callback so the parent can re-attempt the
 *     action that was blocked (re-fire the like POST, etc).
 *
 * Fallback: if window.open is blocked (popup blockers), we fall back
 * to a same-tab navigation with `?return_to=<current-url>` so the user
 * lands back on the right clip after auth.
 */

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Triggered when the popup posts back kc:auth:success. The parent
   *  should retry whatever action the user was attempting (like, comment). */
  onAuthenticated?: () => void;
  /** What the user was trying to do — surfaces in the prompt copy
   *  ("...pour liker", "...pour commenter"). */
  intent?: "like" | "comment" | "rate" | "share";
}

const INTENT_COPY: Record<string, string> = {
  like: "pour liker ce kill",
  comment: "pour commenter",
  rate: "pour noter",
  share: "pour partager",
};

export function InlineAuthPrompt({
  isOpen,
  onClose,
  onAuthenticated,
  intent,
}: Props) {
  // Listen for the auth-success message from the popup.
  useEffect(() => {
    if (!isOpen) return;
    const onMessage = (e: MessageEvent) => {
      // Same-origin guard
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "kc:auth:success") {
        onAuthenticated?.();
        onClose();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isOpen, onAuthenticated, onClose]);

  // Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const handleDiscord = () => {
    const returnTo = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    const authUrl = `/login?popup=1&return_to=${returnTo}`;
    // Try popup first
    const win = window.open(
      authUrl,
      "kc_auth",
      "width=500,height=700,menubar=no,toolbar=no",
    );
    if (!win) {
      // Popup blocked — fall back to same-tab nav
      window.location.href = `/login?return_to=${returnTo}`;
    }
  };

  const reason = intent ? INTENT_COPY[intent] : null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[400] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/65 backdrop-blur-md"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="relative w-full max-w-sm rounded-3xl border border-[var(--gold)]/30 bg-[var(--bg-surface)] p-7 shadow-[0_40px_120px_rgba(0,0,0,0.7)] text-center"
            initial={{ scale: 0.92, y: 12, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            <button
              onClick={onClose}
              className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Fermer"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Discord-coloured glow */}
            <div className="mx-auto h-16 w-16 mb-5 flex items-center justify-center rounded-2xl bg-[#5865F2]/15 border border-[#5865F2]/40 shadow-[0_0_40px_rgba(88,101,242,0.35)]">
              <svg className="h-8 w-8 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" />
              </svg>
            </div>

            <h2 className="font-display text-xl md:text-2xl font-black text-white mb-1">
              Connexion rapide
            </h2>
            <p className="text-sm text-white/65 mb-6 leading-relaxed">
              Connecte-toi avec Discord {reason ? reason : ""}.
              <br />
              <span className="text-xs text-white/40">
                Aucun mot de passe, on garde juste ton pseudo + avatar.
              </span>
            </p>

            <button
              type="button"
              onClick={handleDiscord}
              className="w-full flex items-center justify-center gap-3 rounded-2xl bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold py-3.5 transition-all active:scale-[0.97] shadow-[0_8px_30px_rgba(88,101,242,0.4)]"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" />
              </svg>
              Continuer avec Discord
            </button>

            <button
              type="button"
              onClick={onClose}
              className="mt-3 text-xs text-white/45 hover:text-white/65 transition-colors"
            >
              Plus tard
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
