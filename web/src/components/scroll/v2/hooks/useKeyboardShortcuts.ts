"use client";

/**
 * useKeyboardShortcuts — pro-mode keyboard nav for /scroll-v2 desktop.
 *
 * Bindings (visible via the "?" overlay):
 *
 *   ↓ / J / Espace      next clip
 *   ↑ / K               previous clip
 *   M                   toggle mute
 *   L                   like (rate 5)
 *   C                   open comments panel
 *   S                   share (Web Share API)
 *   Esc                 close any open panel
 *   ?                   toggle shortcuts overlay
 *
 * Shortcuts are SUPPRESSED when:
 *   - Focus is in an INPUT / TEXTAREA / contenteditable
 *   - The ScrollChipBar's expanded panel is open (avoid hijacking the
 *     user typing in the player chip search)
 *   - A modifier key is held (Cmd / Ctrl / Alt) — those are reserved
 *     for browser shortcuts
 *
 * Each binding is opt-in via a callback prop. Components that don't
 * implement a feature (e.g. share when navigator.share is missing)
 * simply don't pass the callback.
 */

import { useEffect, useState } from "react";

interface Bindings {
  onNext?: () => void;
  onPrev?: () => void;
  onToggleMute?: () => void;
  onLike?: () => void;
  onOpenComments?: () => void;
  onShare?: () => void;
  onCloseAll?: () => void;
}

export function useKeyboardShortcuts(bindings: Bindings) {
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip if user is typing somewhere.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      // Skip if modifier held — reserve those for browser shortcuts.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key;
      const lower = k.toLowerCase();

      // Help overlay first — uses ? which doesn't conflict.
      if (k === "?" || (e.shiftKey && k === "/")) {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }

      if (k === "Escape") {
        e.preventDefault();
        if (showHelp) setShowHelp(false);
        bindings.onCloseAll?.();
        return;
      }

      if (k === "ArrowDown" || lower === "j" || k === " ") {
        e.preventDefault();
        bindings.onNext?.();
        return;
      }
      if (k === "ArrowUp" || lower === "k") {
        e.preventDefault();
        bindings.onPrev?.();
        return;
      }
      if (lower === "m") {
        e.preventDefault();
        bindings.onToggleMute?.();
        return;
      }
      if (lower === "l") {
        e.preventDefault();
        bindings.onLike?.();
        return;
      }
      if (lower === "c") {
        e.preventDefault();
        bindings.onOpenComments?.();
        return;
      }
      if (lower === "s") {
        e.preventDefault();
        bindings.onShare?.();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // bindings is a stable reference per-render; intentionally not in deps
    // to avoid re-binding listener every render. The bindings object's
    // current callbacks are read inside the closure each call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHelp]);

  return { showHelp, setShowHelp };
}
