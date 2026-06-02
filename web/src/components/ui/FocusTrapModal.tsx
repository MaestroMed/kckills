"use client";

/**
 * FocusTrapModal — Wave 36 / reusable accessible dialog primitive.
 *
 * Extracted from ScrollDesktopShell's 1024–1279 ContextDrawer, which was the
 * canonical hand-rolled focus-trap in the codebase. This file generalises that
 * exact pattern into two dependency-free exports so every dialog/drawer/sheet
 * on kckills shares ONE audited implementation:
 *
 *   1. useFocusTrap(ref, { active, onEscape, restoreFocus })
 *        The behavioural core. Given a container ref, when `active`:
 *          - stashes document.activeElement (the trigger),
 *          - moves focus to the first focusable inside the container on the
 *            next frame (fallback: the container itself — give it tabIndex=-1),
 *          - traps Tab / Shift+Tab so focus cycles within the container,
 *          - calls onEscape() on the Escape key,
 *          - marks every *sibling* of the container's top-level ancestor
 *            inert + aria-hidden so AT and pointer can't reach the page behind,
 *          - on deactivate/unmount restores focus to the stashed trigger
 *            (unless restoreFocus === false) and un-inerts the siblings.
 *
 *   2. <Modal open onClose ...>{children}</Modal>
 *        A thin wrapper: AnimatePresence + a dimmed scrim (click-to-close) +
 *        a focus-trapped panel (role defaults to "dialog", aria-modal) that
 *        runs useFocusTrap internally. `children` is the panel content.
 *
 * Motion: uses the `m` component under the app-root LazyMotion(domAnimation,
 * strict) — never the `motion` factory, never the `layout` prop. Both exports
 * honour prefers-reduced-motion (animations collapse to an instant fade).
 *
 * Client primitive — "use client". Not server-safe by design.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { m, AnimatePresence, useReducedMotion } from "motion/react";

// Matches the ContextDrawer selector — every natively/explicitly focusable
// node. [tabindex="-1"] is excluded so programmatic-only stops don't become
// Tab targets (the container itself can still take focus as a fallback).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    // offsetParent === null ⇒ display:none / detached → not actually focusable.
    (el) => el.offsetParent !== null,
  );
}

export interface UseFocusTrapOptions {
  /** When true the trap is armed (focus moves in, Tab cycles, Esc fires,
   *  background is inert). Toggling to false tears it all down + restores. */
  active: boolean;
  /** Called when Escape is pressed while the trap is active. The keydown is
   *  preventDefault'd before this runs. Omit to ignore Escape. */
  onEscape?: () => void;
  /** Restore focus to the element that was focused before activation, on
   *  deactivate/unmount. Default true. Set false when the trigger is gone
   *  (e.g. it unmounts with the dialog). */
  restoreFocus?: boolean;
}

/**
 * useFocusTrap — wires focus-stash / first-focus / Tab cycling / Escape /
 * background-inert / focus-restore onto the container referenced by `ref`.
 *
 * Give the container `tabIndex={-1}` so the focus-first fallback can land on
 * it when it has no focusable children.
 *
 * @param ref  Ref to the trap container (the dialog panel).
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  { active, onEscape, restoreFocus = true }: UseFocusTrapOptions,
): void {
  // Stable handle to onEscape so a caller passing an inline arrow doesn't
  // re-arm the whole effect every render.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    // 1) Stash the trigger for restore-on-close.
    const previouslyFocused = (document.activeElement as HTMLElement) ?? null;

    // 2) Inert the rest of the page: every sibling of the container's
    //    top-level ancestor (the chain up to <body>'s direct child). This
    //    hides the live region from AT + blocks pointer/Tab into it without
    //    assuming a portal. We record prior attribute state to restore it.
    const inerted: Array<{
      el: HTMLElement;
      hadInert: boolean;
      prevAriaHidden: string | null;
    }> = [];
    let topLevel: HTMLElement = node;
    while (
      topLevel.parentElement &&
      topLevel.parentElement !== document.body
    ) {
      topLevel = topLevel.parentElement;
    }
    if (topLevel.parentElement === document.body) {
      for (const sibling of Array.from(document.body.children)) {
        if (sibling === topLevel) continue;
        if (!(sibling instanceof HTMLElement)) continue;
        inerted.push({
          el: sibling,
          hadInert: sibling.hasAttribute("inert"),
          prevAriaHidden: sibling.getAttribute("aria-hidden"),
        });
        sibling.setAttribute("inert", "");
        sibling.setAttribute("aria-hidden", "true");
      }
    }

    // 3) Move focus to the first focusable (fallback: the container). Deferred
    //    one frame so a slide/fade-in mount has committed before we focus.
    const raf = requestAnimationFrame(() => {
      const focusables = getFocusable(node);
      (focusables[0] ?? node).focus();
    });

    // 4) Trap Tab / Shift+Tab, fire Escape.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onEscapeRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = getFocusable(node);
      if (focusables.length === 0) {
        // Nothing tabbable — keep focus pinned on the container.
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      // Also re-capture focus if it somehow escaped the container entirely.
      if (e.shiftKey && (activeEl === first || !node.contains(activeEl))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeEl === last || !node.contains(activeEl))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      // Un-inert the background (restore prior attribute state exactly).
      for (const { el, hadInert, prevAriaHidden } of inerted) {
        if (!hadInert) el.removeAttribute("inert");
        if (prevAriaHidden === null) el.removeAttribute("aria-hidden");
        else el.setAttribute("aria-hidden", prevAriaHidden);
      }
      // Restore focus to the trigger.
      if (restoreFocus) previouslyFocused?.focus?.();
    };
    // restoreFocus intentionally read at cleanup via closure; including it
    // keeps the effect honest if a caller flips it. ref is stable.
  }, [active, restoreFocus, ref]);
}

export interface ModalProps {
  /** Controls mount/visibility. AnimatePresence drives the exit transition. */
  open: boolean;
  /** Fired by Escape, scrim click, and the built-in close button. */
  onClose: () => void;
  /** Panel content. */
  children: ReactNode;
  /** ARIA role for the panel. Default "dialog". Use "alertdialog" for
   *  interruptions that need an explicit ack. */
  role?: "dialog" | "alertdialog";
  /** id of the element labelling the panel → aria-labelledby. Provide this OR
   *  `label`. */
  labelledBy?: string;
  /** id of the element describing the panel → aria-describedby. */
  describedBy?: string;
  /** Accessible name when there's no visible title element to point at →
   *  aria-label. Ignored when `labelledBy` is set. */
  label?: string;
  /** Restore focus to the opener on close. Default true. */
  restoreFocus?: boolean;
  /** Render the built-in top-right close (✕) button. Default true. Set false
   *  when the panel supplies its own close affordance. */
  showCloseButton?: boolean;
  /** Accessible label for the built-in close button. Default "Fermer". */
  closeLabel?: string;
  /** Extra classes on the panel (layout/size/skin). The primitive only sets
   *  positioning-neutral defaults + outline-none. */
  panelClassName?: string;
  /** Extra classes on the full-screen overlay wrapper (controls panel
   *  placement via flex — e.g. "justify-end" for a right drawer, the default
   *  centres). */
  overlayClassName?: string;
  /** Scrim opacity utility. Default "bg-black/55". */
  scrimClassName?: string;
  /** z-index on the overlay. Default 80 (above the /scroll shell's z-60). */
  zIndexClassName?: string;
}

/**
 * Modal — overlay scrim + focus-trapped panel built on useFocusTrap.
 *
 * Minimal, unopinionated about size/skin: pass `panelClassName` for the box
 * and `overlayClassName` (flex alignment) for placement. The panel is a
 * tabIndex=-1 `m.div` so the trap can fall back to it. Reduced-motion users
 * get an instant fade with no transform.
 */
export function Modal({
  open,
  onClose,
  children,
  role = "dialog",
  labelledBy,
  describedBy,
  label,
  restoreFocus = true,
  showCloseButton = true,
  closeLabel = "Fermer",
  panelClassName = "",
  overlayClassName = "items-center justify-center p-4",
  scrimClassName = "bg-black/55",
  zIndexClassName = "z-[80]",
}: ModalProps) {
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);

  useFocusTrap(panelRef, { active: open, onEscape: onClose, restoreFocus });

  // Stable close for the scrim/button so they don't churn.
  const close = useCallback(() => onClose(), [onClose]);

  return (
    <AnimatePresence>
      {open && (
        <m.div
          className={`fixed inset-0 flex ${overlayClassName} ${zIndexClassName}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.2 }}
        >
          {/* Scrim — click to close. aria-hidden: it's decorative; the close
              path is also covered by Escape + the button. */}
          <div
            aria-hidden
            className={`absolute inset-0 ${scrimClassName}`}
            onClick={close}
          />

          {/* Panel — focus-trapped. tabIndex=-1 = the trap's focus fallback. */}
          <m.div
            ref={panelRef}
            role={role}
            aria-modal="true"
            aria-label={labelledBy ? undefined : label}
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            tabIndex={-1}
            className={`relative outline-none ${panelClassName}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            transition={
              reduce
                ? { duration: 0 }
                : { type: "spring", stiffness: 320, damping: 34 }
            }
          >
            {showCloseButton && (
              <button
                type="button"
                onClick={close}
                aria-label={closeLabel}
                className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white/75 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-[var(--gold)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
            {children}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
