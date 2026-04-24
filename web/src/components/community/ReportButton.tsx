"use client";

/**
 * ReportButton — universal "..." moderation flag.
 *
 * Two render paths driven by viewport width :
 *
 *   * MOBILE  (<= 768px) — bottom-sheet (drag-to-dismiss, focus
 *     trapped, body-scroll-locked, big finger-friendly rows).
 *   * DESKTOP (> 768px)  — tight dropdown anchored to the trigger.
 *
 * Both paths POST the same body to `/api/report` and surface the
 * same inline confirmation toast — only the affordances differ.
 *
 * Drop into any feed surface (FeedSidebarV2, CommentSheetV2,
 * /kill/[id]) — the component is self-contained : it owns its own
 * sheet, its own toast, its own session-store dedup ("Déjà signalé").
 *
 * Behaviour :
 *   - Click "..." → reasons UI (sheet on mobile, dropdown on desktop).
 *   - Pick a reason → POST /api/report.
 *   - Success      → 2s "Merci, signalé" toast, button locks for the
 *                    session via sessionStorage.
 *   - 429          → "Trop de signalements, réessayez plus tard"
 *   - 5xx / network → "Erreur, réessaie"
 *   - "Autre" reveals a 500-char textarea sent as `reasonText`.
 *   - The component never throws and never blocks the host UI.
 *
 * a11y :
 *   - Mobile sheet : role="dialog" aria-modal="true", focus trap on
 *     open + restore focus on close, Esc / backdrop-tap dismiss,
 *     keyboard arrow-key navigation across reason rows.
 *   - Desktop dropdown : role="menu" + role="menuitem", focus-visible
 *     ring on every interactive element.
 *   - prefers-reduced-motion : disables the spring; sheet just fades.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useId,
} from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Public types ─────────────────────────────────────────────────────

export type ReportTargetType = "kill" | "comment" | "community_clip";

export interface ReportButtonProps {
  targetType: ReportTargetType;
  targetId: string;
  /** "sm" = 24px touch target (comment row), "md" = 32px (sidebar). */
  size?: "sm" | "md";
  /** Optional className on the outer wrapper so the host can adjust
   *  alignment without poking at internals. */
  className?: string;
  /** Tooltip / aria-label override. Default depends on targetType. */
  ariaLabel?: string;
  /** Imperative trigger for a parent that wants to open the sheet
   *  without the user touching the "..." button — e.g. a long-press
   *  gesture from FeedSidebarV2. The parent passes a ref and calls
   *  `ref.current?.open()`. */
  controllerRef?: React.MutableRefObject<ReportButtonController | null>;
  /** Hide the trigger button entirely — useful when the parent owns
   *  the gesture surface (e.g. long-press on a different chip) but
   *  still wants the sheet UI. */
  hideTrigger?: boolean;
}

export interface ReportButtonController {
  open: () => void;
  close: () => void;
  /** Whether this target was already reported in this session. */
  isLocked: () => boolean;
}

// ─── Reason catalog ───────────────────────────────────────────────────

interface ReasonOption {
  code: string;
  label: string;
  /** Short helper line shown under the label in the mobile sheet. */
  description: string;
  /** Inline SVG `d` for a generic 24×24 stroke icon. */
  iconPath: string;
  /** Which target_types this option applies to. We hide reasons that
   *  make no sense for the target (e.g. "spam" for a kill clip). */
  appliesTo: ReportTargetType[];
}

const REASONS: ReasonOption[] = [
  {
    code: "wrong_clip",
    label: "Le clip ne correspond pas",
    description: "Mauvais moment, mauvais match, ou clip vide.",
    iconPath:
      "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
    appliesTo: ["kill", "community_clip"],
  },
  {
    code: "no_kill_visible",
    label: "On ne voit pas le kill",
    description: "Camera ailleurs, écran de mort, ou trop court.",
    iconPath:
      "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21",
    appliesTo: ["kill"],
  },
  {
    code: "wrong_player",
    label: "Mauvais joueur / champion",
    description: "Identification erronée du killer ou de la victime.",
    iconPath:
      "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
    appliesTo: ["kill", "community_clip"],
  },
  {
    code: "spam",
    label: "Spam",
    description: "Pub, lien suspect, message répété.",
    iconPath:
      "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
    appliesTo: ["comment", "community_clip"],
  },
  {
    code: "toxic",
    label: "Toxique / haineux",
    description: "Insultes, harcèlement, contenu de haine.",
    iconPath:
      "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L18.364 5.636M5.636 18.364l12.728-12.728",
    appliesTo: ["comment", "community_clip"],
  },
  {
    code: "other",
    label: "Autre",
    description: "Décris ce qui ne va pas (optionnel).",
    iconPath:
      "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    appliesTo: ["kill", "comment", "community_clip"],
  },
];

// ─── useMediaQuery hook (inlined — no other consumer in the app) ───────

function useMediaQuery(query: string): boolean {
  // Initialise to `false` on the server and on the very first client
  // render so SSR / hydration match. The real value lands in the
  // first effect tick.
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    // addEventListener is the modern API ; older Safari needs addListener.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // Legacy fallback. Cast through unknown to satisfy TS in modern lib.dom.
    const legacy = mql as unknown as {
      addListener?: (cb: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (cb: (e: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener?.(onChange);
    return () => legacy.removeListener?.(onChange);
  }, [query]);

  return matches;
}

function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

// ─── Identity helpers (mirror analytics/track.ts) ─────────────────────

const ANON_ID_KEY = "kc_anon_id";

function getOrCreateAnonId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(ANON_ID_KEY);
    if (existing && existing.length >= 8) return existing;
    const fresh = generateUuid();
    window.localStorage.setItem(ANON_ID_KEY, fresh);
    return fresh;
  } catch {
    return generateUuid();
  }
}

function generateUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  // RFC4122-v4-ish best-effort fallback
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[(Math.random() * 4) | 8];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}

// ─── Session-scoped dedup ─────────────────────────────────────────────

function sessionKey(type: ReportTargetType, id: string): string {
  return `kc_reported:${type}:${id}`;
}

function alreadyReportedThisSession(type: ReportTargetType, id: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(sessionKey(type, id)) === "1";
  } catch {
    return false;
  }
}

function markReportedThisSession(type: ReportTargetType, id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(sessionKey(type, id), "1");
  } catch {
    /* sessionStorage blocked — caller still gets the toast, just no
       persistence between page navigations within the tab. */
  }
}

// ─── Body-scroll lock helper ──────────────────────────────────────────
// Counts open sheets so multiple ReportButtons opened back-to-back
// don't race with each other on `body.style.overflow`.

let bodyLockCount = 0;
let bodyLockOriginalOverflow: string | null = null;

function lockBodyScroll() {
  if (typeof document === "undefined") return;
  if (bodyLockCount === 0) {
    bodyLockOriginalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockCount += 1;
}

function unlockBodyScroll() {
  if (typeof document === "undefined") return;
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) {
    document.body.style.overflow = bodyLockOriginalOverflow ?? "";
    bodyLockOriginalOverflow = null;
  }
}

// ─── Component ────────────────────────────────────────────────────────

const DISMISS_THRESHOLD = 120; // px past which a release closes
const DISMISS_VELOCITY = 500; // px/sec — fast flick down also closes

export function ReportButton({
  targetType,
  targetId,
  size = "sm",
  className,
  ariaLabel,
  controllerRef,
  hideTrigger = false,
}: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<
    "sent" | "error" | "rate_limited" | null
  >(null);
  const [reported, setReported] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [activeReasonIndex, setActiveReasonIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sheetFirstButtonRef = useRef<HTMLButtonElement>(null);
  const sheetEndRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const headingId = useId();

  const isMobile = useMediaQuery("(max-width: 768px)");
  const reducedMotion = usePrefersReducedMotion();

  // Initial dedup check from sessionStorage (sync read in effect to
  // avoid SSR hydration mismatch).
  useEffect(() => {
    setReported(alreadyReportedThisSession(targetType, targetId));
  }, [targetType, targetId]);

  // Imperative controller for parents that own a gesture surface.
  useEffect(() => {
    if (!controllerRef) return;
    controllerRef.current = {
      open: () => {
        if (!alreadyReportedThisSession(targetType, targetId)) setOpen(true);
      },
      close: () => setOpen(false),
      isLocked: () => alreadyReportedThisSession(targetType, targetId),
    };
    return () => {
      if (controllerRef.current) controllerRef.current = null;
    };
  }, [controllerRef, targetType, targetId]);

  // ─── DESKTOP : click-outside + Escape ───────────────────────────────
  useEffect(() => {
    if (!open || isMobile) return;
    function onClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, isMobile]);

  // ─── MOBILE : focus trap + body lock + Escape on sheet ──────────────
  useEffect(() => {
    if (!open || !isMobile) return;
    previousFocusRef.current = document.activeElement;
    lockBodyScroll();
    // Focus first reason button on next tick so the motion enter
    // animation has started.
    const t = window.setTimeout(() => {
      sheetFirstButtonRef.current?.focus();
    }, 50);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      unlockBodyScroll();
      // Restore focus to the trigger (or the imperative caller's
      // anchor if focus drifted). Safari needs a microtask gap.
      const prev = previousFocusRef.current;
      if (prev && "focus" in prev && typeof (prev as HTMLElement).focus === "function") {
        window.setTimeout(() => (prev as HTMLElement).focus(), 0);
      }
    };
  }, [open, isMobile]);

  // Reset the "other" textarea when sheet/dropdown closes so a stale
  // draft doesn't bleed across submissions.
  useEffect(() => {
    if (!open) {
      setOtherText("");
      setActiveReasonIndex(0);
    }
  }, [open]);

  // Cleanup toast timer on unmount
  useEffect(
    () => () => {
      if (toastTimerRef.current != null) {
        window.clearTimeout(toastTimerRef.current);
      }
    },
    [],
  );

  const flashToast = useCallback(
    (kind: "sent" | "error" | "rate_limited") => {
      setToast(kind);
      if (toastTimerRef.current != null) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(
        () => setToast(null),
        kind === "sent" ? 2000 : 3000,
      );
    },
    [],
  );

  const submit = useCallback(
    async (reasonCode: string, reasonText?: string) => {
      if (submitting || reported) return;
      setSubmitting(true);
      try {
        const anonId = getOrCreateAnonId();
        const res = await fetch("/api/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetType,
            targetId,
            reasonCode,
            reasonText: reasonText && reasonText.trim().length > 0 ? reasonText.trim() : undefined,
            reporterAnonId: anonId,
          }),
        });
        if (res.status === 429) {
          flashToast("rate_limited");
          return;
        }
        if (!res.ok) {
          flashToast("error");
          return;
        }
        // Both fresh-report and already-reported responses are 200 OK
        // — server returns {alreadyReported: true} for the latter. Either
        // way we lock the button for the session.
        markReportedThisSession(targetType, targetId);
        setReported(true);
        flashToast("sent");
        // Auto-close after success — desktop dropdown closes
        // immediately; mobile sheet waits for the toast tail so the
        // user can read the confirmation before the sheet disappears.
        if (isMobile) {
          window.setTimeout(() => setOpen(false), 1200);
        } else {
          setOpen(false);
        }
      } catch {
        flashToast("error");
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, reported, targetType, targetId, flashToast, isMobile],
  );

  const sizeBoxClass =
    size === "md"
      ? "h-8 w-8 [&>svg]:h-4 [&>svg]:w-4"
      : "h-6 w-6 [&>svg]:h-3 [&>svg]:w-3";

  const reasons = REASONS.filter((r) => r.appliesTo.includes(targetType));
  const label =
    ariaLabel ??
    (targetType === "comment"
      ? "Signaler ce commentaire"
      : targetType === "community_clip"
        ? "Signaler ce clip communautaire"
        : "Signaler ce kill");

  // ─── Reason-row keyboard nav (arrow keys cycle, Enter selects) ──────
  const onReasonsKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (reasons.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveReasonIndex((i) => (i + 1) % reasons.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveReasonIndex((i) => (i - 1 + reasons.length) % reasons.length);
      } else if (e.key === "Home") {
        e.preventDefault();
        setActiveReasonIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setActiveReasonIndex(reasons.length - 1);
      }
    },
    [reasons.length],
  );

  // Move physical focus in sync with the highlighted index so screen
  // readers + sighted users see the same "active" row. Only when the
  // sheet/dropdown is open.
  useEffect(() => {
    if (!open) return;
    const el = wrapperRef.current?.querySelector<HTMLButtonElement>(
      `[data-reason-index="${activeReasonIndex}"]`,
    );
    el?.focus({ preventScroll: true });
  }, [activeReasonIndex, open]);

  // ─── Toast renderer (shared between paths) ──────────────────────────
  function renderToast() {
    if (!toast) return null;
    const text =
      toast === "sent"
        ? "Merci, signalé"
        : toast === "rate_limited"
          ? "Trop de signalements, réessayez plus tard"
          : "Erreur, réessaie";
    const tone =
      toast === "sent"
        ? "bg-[var(--green)]/20 text-[var(--green)] border border-[var(--green)]/35"
        : "bg-[var(--red)]/20 text-[var(--red)] border border-[var(--red)]/35";
    // On mobile the toast renders inside the sheet (so it lives within
    // the reading flow); on desktop it floats next to the dropdown.
    if (isMobile && open) {
      return (
        <div
          role="status"
          aria-live="polite"
          className={`mx-4 mb-3 rounded-lg px-3 py-2 text-[13px] font-medium ${tone}`}
        >
          {text}
        </div>
      );
    }
    return (
      <div
        role="status"
        aria-live="polite"
        className={`absolute right-0 top-full mt-1.5 z-[401] whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium shadow-md pointer-events-none ${tone}`}
      >
        {text}
      </div>
    );
  }

  // ─── Trigger button (shared between paths) ──────────────────────────
  const trigger = hideTrigger ? null : (
    <button
      ref={triggerRef}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (reported || submitting) return;
        setOpen((v) => !v);
      }}
      disabled={reported || submitting}
      aria-label={reported ? "Déjà signalé" : label}
      title={reported ? "Déjà signalé" : label}
      aria-haspopup={isMobile ? "dialog" : "menu"}
      aria-expanded={open}
      className={`${sizeBoxClass} flex items-center justify-center rounded-full text-white/55 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]`}
    >
      <svg fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="5" cy="12" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="19" cy="12" r="2" />
      </svg>
    </button>
  );

  return (
    <div ref={wrapperRef} className={`relative inline-flex ${className ?? ""}`}>
      {trigger}

      {/* ─── DESKTOP DROPDOWN ────────────────────────────────────── */}
      {!isMobile && open && reasons.length > 0 && (
        <div
          role="menu"
          aria-label="Raisons du signalement"
          onKeyDown={onReasonsKeyDown}
          className="absolute right-0 top-full mt-1.5 z-[400] min-w-[240px] rounded-xl border border-white/10 bg-[var(--bg-surface)] shadow-[0_18px_48px_rgba(0,0,0,0.65)] overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-white/5">
            <p className="font-display text-[11px] font-bold uppercase tracking-widest text-[var(--gold)]/80">
              Signaler
            </p>
            <p className="text-[10px] text-white/45 mt-0.5">
              Pourquoi tu signales ?
            </p>
          </div>
          <ul className="py-1">
            {reasons.map((r, i) => (
              <li key={r.code}>
                <button
                  type="button"
                  role="menuitem"
                  data-reason-index={i}
                  onClick={(e) => {
                    e.stopPropagation();
                    void submit(r.code);
                  }}
                  className="w-full text-left px-3 py-2 text-[12px] text-white/85 hover:bg-white/8 hover:text-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--gold)]"
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── MOBILE BOTTOM SHEET ─────────────────────────────────── */}
      <AnimatePresence>
        {isMobile && open && reasons.length > 0 && (
          <motion.div
            className="fixed inset-0 z-[400]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Backdrop — tap to dismiss */}
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-[3px]"
              onClick={() => setOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />

            {/* Sheet */}
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={headingId}
              className="absolute bottom-0 left-0 right-0 flex flex-col rounded-t-3xl bg-[var(--bg-surface)] border-t border-[var(--gold)]/25 shadow-[0_-30px_80px_rgba(0,0,0,0.75)] max-h-[85vh]"
              initial={reducedMotion ? { opacity: 0 } : { y: "100%" }}
              animate={reducedMotion ? { opacity: 1 } : { y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { y: "100%" }}
              transition={
                reducedMotion
                  ? { duration: 0.18 }
                  : { type: "spring", stiffness: 320, damping: 32 }
              }
              drag={reducedMotion ? false : "y"}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => {
                if (
                  info.offset.y > DISMISS_THRESHOLD ||
                  info.velocity.y > DISMISS_VELOCITY
                ) {
                  setOpen(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
                <div className="h-1.5 w-11 rounded-full bg-white/25" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 pb-3 border-b border-white/5">
                <div>
                  <h3
                    id={headingId}
                    className="font-display text-lg font-bold text-white leading-none"
                  >
                    Signaler
                  </h3>
                  <p className="font-data text-[10px] uppercase tracking-widest text-white/45 mt-1">
                    {targetType === "comment"
                      ? "Ce commentaire"
                      : targetType === "community_clip"
                        ? "Ce clip communautaire"
                        : "Ce kill"}
                  </p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/8 hover:bg-white/15 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
                  aria-label="Fermer"
                >
                  <svg
                    className="h-4 w-4 text-white/75"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Reasons list (scrollable in case viewport is short) */}
              <div
                role="menu"
                aria-label="Raisons du signalement"
                onKeyDown={onReasonsKeyDown}
                className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5"
              >
                {reasons.map((r, i) => {
                  const isActive = i === activeReasonIndex;
                  const isOther = r.code === "other";
                  return (
                    <div key={r.code}>
                      <button
                        type="button"
                        role="menuitem"
                        ref={i === 0 ? sheetFirstButtonRef : undefined}
                        data-reason-index={i}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isOther) {
                            // Don't auto-submit — let the user fill the
                            // textarea and tap the explicit "Envoyer" CTA.
                            setActiveReasonIndex(i);
                            return;
                          }
                          void submit(r.code);
                        }}
                        disabled={submitting}
                        className={`w-full flex items-start gap-3 min-h-[56px] rounded-xl px-3.5 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] ${
                          isActive
                            ? "bg-[var(--bg-elevated)]"
                            : "bg-white/[0.02] hover:bg-white/[0.06]"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <span
                          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                            isActive
                              ? "bg-[var(--gold)]/15 text-[var(--gold)]"
                              : "bg-white/8 text-white/65"
                          }`}
                        >
                          <svg
                            className="h-4.5 w-4.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.8}
                              d={r.iconPath}
                            />
                          </svg>
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold text-white leading-snug">
                            {r.label}
                          </p>
                          <p className="text-[11px] text-white/55 mt-0.5 leading-snug">
                            {r.description}
                          </p>
                        </div>
                      </button>

                      {/* Inline textarea for "Autre" — appears under the
                          row only when that reason is the active one. */}
                      {isOther && isActive && (
                        <div className="px-3 pt-2 pb-1">
                          <label
                            htmlFor={`${headingId}-note`}
                            className="sr-only"
                          >
                            Détails (optionnel)
                          </label>
                          <textarea
                            id={`${headingId}-note`}
                            value={otherText}
                            onChange={(e) => setOtherText(e.target.value)}
                            maxLength={500}
                            rows={3}
                            placeholder="Décris le problème (optionnel)"
                            disabled={submitting}
                            className="w-full rounded-lg bg-[var(--bg-primary)] border border-white/10 px-3 py-2 text-[13px] text-white placeholder-white/30 outline-none focus:border-[var(--gold)]/55 focus:bg-white/5 disabled:opacity-60 resize-none"
                          />
                          <p className="text-[10px] text-white/35 text-right mt-1">
                            {otherText.length}/500
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={sheetEndRef} />
              </div>

              {/* Toast slot inside the sheet so it doesn't disappear
                  with the sheet animation. */}
              {renderToast()}

              {/* Footer actions (Cancel / Submit) — only matters when
                  "Autre" is the active reason and the user wants to
                  send their note. For the other reasons the row tap
                  is itself the submit. */}
              <div
                className="flex gap-2 px-4 py-3 border-t border-white/5"
                style={{
                  paddingBottom:
                    "max(0.75rem, env(safe-area-inset-bottom, 0.75rem))",
                }}
              >
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="flex-1 rounded-full bg-white/8 hover:bg-white/12 px-4 py-3 text-[14px] font-semibold text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const r = reasons[activeReasonIndex];
                    if (!r) return;
                    void submit(r.code, r.code === "other" ? otherText : undefined);
                  }}
                  disabled={submitting || reported}
                  className="flex-1 rounded-full bg-[var(--gold)] hover:bg-[var(--gold-bright)] px-4 py-3 text-[14px] font-bold text-black transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Envoi…" : "Envoyer"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating toast for desktop — mobile renders it inside the sheet */}
      {(!isMobile || !open) && renderToast()}
    </div>
  );
}

export default ReportButton;
