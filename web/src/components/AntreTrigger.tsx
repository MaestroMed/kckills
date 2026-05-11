"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";

import { isBCCMember, markBCCMember } from "@/lib/bcc-state";

// The cave itself is lazy-loaded — zero bundle cost until the ritual
// fires. It pulls in Motion + the Supabase client + ~30 KB of editorial
// data, so we don't want it sitting in the player-page chunk by default.
const AntreOfBCC = dynamic(
  () => import("./AntreOfBCC").then((m) => m.AntreOfBCC),
  {
    ssr: false,
    // No skeleton — the entry animation is the loading state. The cave
    // mounts under the curtain that's already drawing itself.
    loading: () => null,
  },
);

/**
 * AntreTrigger — keyboard ritual that opens the Antre de la BCC.
 *
 * The ritual : type the letters `b`, `c`, `c` in sequence anywhere on
 * Bo's player page. Case-insensitive, no modifier keys, with a generous
 * 2.5-second sliding window between keystrokes. Any other character
 * resets the sequence (so casual typing in a search box doesn't fire it).
 *
 * Modeled after `KonamiBlueWall` :
 *   - one keydown listener at window scope
 *   - state machine driven by a moving cursor `idx`
 *   - timeout that resets the cursor after `RESET_WINDOW_MS` of silence
 *
 * Once the ritual fires, we flip `localStorage.bcc_member = "true"` so a
 * subtle "BCC" hint can appear on Bo's page next visit. Per spec, the
 * cave itself MUST be re-opened via the ritual each time — there is no
 * auto-open path.
 *
 * Closing the cave (via the X button or by typing "OUT") returns the
 * user to Bo's page with a fade-out. The trigger listener stays mounted
 * so the user can re-open the cave without a page reload.
 */

const SEQUENCE = ["b", "c", "c"] as const;
const RESET_WINDOW_MS = 2500;

export function AntreTrigger() {
  const [open, setOpen] = useState(false);
  const [member, setMember] = useState(false);
  const [progress, setProgress] = useState(0);

  // Hydrate the member flag once on mount.
  useEffect(() => {
    setMember(isBCCMember());
  }, []);

  const trigger = useCallback(() => {
    markBCCMember();
    setMember(true);
    setOpen(true);
  }, []);

  useEffect(() => {
    let idx = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function handler(e: KeyboardEvent) {
      // Ignore the ritual when:
      //  - the cave is already open (handled by the cave's own keydowns),
      //  - the user is holding a modifier (so Ctrl+B in the URL bar doesn't fire),
      //  - the target is contenteditable (the cave never appears inside an editor),
      //  - the key isn't a single printable letter.
      if (open) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName;
      // Skip contenteditable rich editors (none on Bo's page today, but
      // defensive against future additions).
      if (target?.isContentEditable) return;
      // Skip while typing into a form field — we don't want to steal
      // letters from a future search bar. Bo's page has no such field
      // today, but defensive against future composition.
      if (tagName === "INPUT" || tagName === "TEXTAREA") return;

      const key = e.key.toLowerCase();
      if (key === SEQUENCE[idx]) {
        idx += 1;
        setProgress(idx);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          idx = 0;
          setProgress(0);
        }, RESET_WINDOW_MS);
        if (idx === SEQUENCE.length) {
          idx = 0;
          setProgress(0);
          if (timer) clearTimeout(timer);
          trigger();
        }
      } else if (key.length === 1) {
        // Any other single character resets the sequence. Non-character
        // keys (Shift, ArrowDown…) are ignored so the user can scroll
        // mid-ritual without losing progress.
        idx = 0;
        setProgress(0);
      }
    }

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (timer) clearTimeout(timer);
    };
  }, [trigger, open]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <>
      {/* Subtle "BCC" hint — only after the user has unlocked the cave
          at least once, and never while the cave is open. Hidden on
          screens narrower than 640px so it never clips the player-name
          h1. Discreet by design : 8px font, 25% opacity, focuses to
          full opacity for keyboard users. */}
      {member && !open && (
        <div
          className="fixed bottom-4 left-4 z-[60] pointer-events-none select-none hidden sm:block"
          aria-hidden
        >
          <span
            className="font-data text-[9px] uppercase tracking-[0.4em] text-[var(--gold)]/25 transition-opacity hover:opacity-100"
            style={{ textShadow: "0 0 8px rgba(200,170,110,0.2)" }}
            title="Tape B-C-C pour entrer"
          >
            ◆ BCC
          </span>
        </div>
      )}

      {/* Ritual progress dots — only render once the user has typed the
          first letter. Three tiny gold rhombi at bottom-right that fill in
          as the sequence advances. Mirrors the Konami progress UI. */}
      {!open && progress > 0 && (
        <div
          className="fixed bottom-4 right-4 z-[80] pointer-events-none select-none"
          aria-hidden
        >
          <div className="flex items-center gap-1.5">
            {SEQUENCE.map((_, i) => (
              <span
                key={i}
                className="h-2 w-2 transition-all duration-200"
                style={{
                  transform: "rotate(45deg)",
                  background:
                    i < progress ? "var(--gold)" : "rgba(200,170,110,0.18)",
                  boxShadow:
                    i < progress
                      ? "0 0 8px rgba(200,170,110,0.6)"
                      : "none",
                }}
              />
            ))}
          </div>
        </div>
      )}

      {open && <AntreOfBCC onClose={handleClose} />}
    </>
  );
}
