"use client";

/**
 * ReportButton — tiny "..." menu that lets a user flag a kill, comment
 * or community clip for moderation.
 *
 * Drop into any feed surface (FeedSidebarV2, CommentSheetV2,
 * /kill/[id]) — the component is self-contained : it owns its own
 * dropdown, its own toast, its own session-store dedup ("Déjà
 * signalé").
 *
 * Behaviour :
 *   - Click "..." → dropdown of localised reason labels.
 *   - Pick a reason → POST /api/report.
 *   - Success → 2s "Merci, signalé" toast, button locked for the
 *     session via sessionStorage ("kc_reported:{type}:{id}").
 *   - Already-reported → button shows "Déjà signalé" and is disabled.
 *   - The component never throws and never blocks the host UI :
 *     errors fall through to a discrete inline message and the user
 *     can dismiss the dropdown.
 *
 * Loading strategy : the actual reasons-list and POST logic live in
 * this same file (lightweight enough to inline) but the CONTAINER is
 * tiny so the parent can mount it without code-splitting. If we later
 * grow the menu (e.g. with screenshots), wrap in next/dynamic
 * server-side.
 */

import { useState, useEffect, useRef, useCallback } from "react";

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
}

// ─── Reason catalog ───────────────────────────────────────────────────

interface ReasonOption {
  code: string;
  label: string;
  /** Which target_types this option applies to. We hide reasons that
   *  make no sense for the target (e.g. "spam" for a kill clip). */
  appliesTo: ReportTargetType[];
}

const REASONS: ReasonOption[] = [
  {
    code: "wrong_clip",
    label: "Le clip ne correspond pas",
    appliesTo: ["kill", "community_clip"],
  },
  {
    code: "no_kill_visible",
    label: "On ne voit pas le kill",
    appliesTo: ["kill"],
  },
  {
    code: "wrong_player",
    label: "Mauvais joueur / champion",
    appliesTo: ["kill", "community_clip"],
  },
  {
    code: "spam",
    label: "Spam",
    appliesTo: ["comment", "community_clip"],
  },
  {
    code: "toxic",
    label: "Toxique / haineux",
    appliesTo: ["comment", "community_clip"],
  },
  {
    code: "other",
    label: "Autre",
    appliesTo: ["kill", "comment", "community_clip"],
  },
];

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

// ─── Component ────────────────────────────────────────────────────────

export function ReportButton({
  targetType,
  targetId,
  size = "sm",
  className,
  ariaLabel,
}: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<"sent" | "error" | null>(null);
  const [reported, setReported] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Initial dedup check from sessionStorage (sync read in effect to
  // avoid SSR hydration mismatch).
  useEffect(() => {
    setReported(alreadyReportedThisSession(targetType, targetId));
  }, [targetType, targetId]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
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

  const flashToast = useCallback((kind: "sent" | "error") => {
    setToast(kind);
    if (toastTimerRef.current != null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2000);
  }, []);

  const submit = useCallback(
    async (reasonCode: string) => {
      if (submitting || reported) return;
      setSubmitting(true);
      setOpen(false);
      try {
        const anonId = getOrCreateAnonId();
        const res = await fetch("/api/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetType,
            targetId,
            reasonCode,
            reporterAnonId: anonId,
          }),
        });
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
      } catch {
        flashToast("error");
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, reported, targetType, targetId, flashToast],
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

  return (
    <div ref={wrapperRef} className={`relative inline-flex ${className ?? ""}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (reported || submitting) return;
          setOpen((v) => !v);
        }}
        disabled={reported || submitting}
        aria-label={reported ? "Déjà signalé" : label}
        title={reported ? "Déjà signalé" : label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${sizeBoxClass} flex items-center justify-center rounded-full text-white/55 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <svg
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      {open && reasons.length > 0 && (
        <div
          role="menu"
          aria-label="Raisons du signalement"
          className="absolute right-0 top-full mt-1.5 z-[400] min-w-[220px] rounded-xl border border-white/10 bg-[var(--bg-surface)] shadow-[0_18px_48px_rgba(0,0,0,0.65)] overflow-hidden"
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
            {reasons.map((r) => (
              <li key={r.code}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    void submit(r.code);
                  }}
                  className="w-full text-left px-3 py-2 text-[12px] text-white/85 hover:bg-white/8 hover:text-white transition-colors"
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`absolute right-0 top-full mt-1.5 z-[401] whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium shadow-md pointer-events-none ${
            toast === "sent"
              ? "bg-[var(--green)]/20 text-[var(--green)] border border-[var(--green)]/35"
              : "bg-[var(--red)]/20 text-[var(--red)] border border-[var(--red)]/35"
          }`}
        >
          {toast === "sent" ? "Merci, signalé" : "Erreur, réessaie"}
        </div>
      )}
    </div>
  );
}

export default ReportButton;
