"use client";

/**
 * useKeyboardShortcuts — pro-mode keyboard nav for /scroll-v2 desktop.
 *
 * Bindings (visible via the "?" overlay):
 *
 *   ↓ / J               next clip
 *   ↑ / K               previous clip
 *   Espace              play / pause (preventDefault — no page scroll)
 *   M                   toggle mute
 *   L                   like
 *   C                   open comments panel
 *   S                   share (Web Share API / clipboard fallback)
 *   B                   bookmark
 *   F                   cinema mode
 *   1 – 5               rate the clip (1 to 5 stars)
 *   ← / →               previous / next VOD source
 *   ?                   toggle shortcuts overlay
 *   Esc                 close any open panel (handled by callers)
 *
 * Shortcuts are SUPPRESSED when:
 *   - Focus is in an INPUT / TEXTAREA / SELECT / contenteditable element
 *     (don't hijack the user typing in the player-chip search etc.)
 *   - A modifier key is held (Cmd / Ctrl / Alt) — those are reserved
 *     for browser shortcuts
 *   - The keystroke is part of an IME composition (e.isComposing)
 *
 * Each binding is opt-in via a callback prop. Components that don't
 * implement a feature (e.g. share when navigator.share is missing)
 * simply don't pass the callback.
 *
 * ── Stale-closure fix (Wave 37) ──────────────────────────────────────
 * The listener is attached ONCE (per `enabled` toggle), but the
 * `bindings` object is mirrored into a ref that is refreshed on every
 * render. The keydown handler reads `bindingsRef.current`, so it always
 * invokes the LIVE callbacks — never the ones captured when the effect
 * first ran. The previous implementation listed only `[showHelp]` in the
 * deps and read `bindings.onNext?.()` directly from the captured closure,
 * which meant every callback was frozen at first mount (the old comment
 * claiming otherwise was wrong).
 */

import { useEffect, useRef, useState } from "react";

export interface KeyboardBindings {
  onNext?: () => void;
  onPrev?: () => void;
  onPlayPause?: () => void;
  onMute?: () => void;
  onLike?: () => void;
  onComment?: () => void;
  onShare?: () => void;
  onBookmark?: () => void;
  onCinema?: () => void;
  onRate?: (n: 1 | 2 | 3 | 4 | 5) => void;
  onPrevSource?: () => void;
  onNextSource?: () => void;
  /**
   * Toggle the shortcuts cheatsheet. When omitted, the hook falls back to
   * toggling its own internal `showHelp` state (returned below), so a
   * caller that just renders <KeyboardHelpOverlay open={showHelp} /> keeps
   * working with zero wiring.
   */
  onToggleHelp?: () => void;
}

export function useKeyboardShortcuts(
  bindings: KeyboardBindings,
  enabled: boolean = true,
) {
  const [showHelp, setShowHelp] = useState(false);

  // Mirror the latest bindings into a ref every render so the (once-attached)
  // listener always calls the current callbacks instead of stale ones.
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  // Keep a ref to showHelp so the once-attached listener can read it
  // without re-subscribing whenever the overlay opens/closes.
  const showHelpRef = useRef(showHelp);
  showHelpRef.current = showHelp;

  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      // Skip IME composition keystrokes.
      if (e.isComposing) return;

      // Skip if the user is typing in a form field / editable region.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      // Skip if a modifier is held — reserve those for browser shortcuts.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const b = bindingsRef.current;
      const k = e.key;
      const lower = k.toLowerCase();

      // Help overlay — ? (Shift+/ on most layouts).
      if (k === "?" || (e.shiftKey && k === "/")) {
        e.preventDefault();
        if (b.onToggleHelp) b.onToggleHelp();
        else setShowHelp((v) => !v);
        return;
      }

      // Escape is intentionally handled by the callers (they own which
      // panel/overlay to close). We still close our own help overlay if
      // it's the thing that's open.
      if (k === "Escape") {
        if (showHelpRef.current) {
          setShowHelp(false);
        }
        return;
      }

      // Rate 1–5 (top-row digits or numpad).
      if (k >= "1" && k <= "5") {
        e.preventDefault();
        b.onRate?.(Number(k) as 1 | 2 | 3 | 4 | 5);
        return;
      }

      if (k === "ArrowDown" || lower === "j") {
        e.preventDefault();
        b.onNext?.();
        return;
      }
      if (k === "ArrowUp" || lower === "k") {
        e.preventDefault();
        b.onPrev?.();
        return;
      }
      if (k === " " || k === "Spacebar") {
        e.preventDefault();
        b.onPlayPause?.();
        return;
      }
      if (lower === "m") {
        e.preventDefault();
        b.onMute?.();
        return;
      }
      if (lower === "l") {
        e.preventDefault();
        b.onLike?.();
        return;
      }
      if (lower === "c") {
        e.preventDefault();
        b.onComment?.();
        return;
      }
      if (lower === "s") {
        e.preventDefault();
        b.onShare?.();
        return;
      }
      if (lower === "b") {
        e.preventDefault();
        b.onBookmark?.();
        return;
      }
      if (lower === "f") {
        e.preventDefault();
        b.onCinema?.();
        return;
      }
      if (k === "ArrowLeft") {
        e.preventDefault();
        b.onPrevSource?.();
        return;
      }
      if (k === "ArrowRight") {
        e.preventDefault();
        b.onNextSource?.();
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  return { showHelp, setShowHelp };
}
