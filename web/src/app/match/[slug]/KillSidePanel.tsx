"use client";

/**
 * KillSidePanel — slide-in side panel for the Match Replay timeline.
 *
 * Built specifically for the /match/[slug] viewer (Wave 30d) :
 *
 *   - Desktop (≥ md) : slides in from the RIGHT edge of the viewport,
 *     420 px wide, full-height. Backdrop blur, scroll-lock on body.
 *   - Mobile (< md) : becomes a BOTTOM SHEET — anchored to the bottom
 *     of the viewport, max-h 85 vh, drag handle at the top. Mirrors the
 *     pattern fans expect from FotMob / Sofascore on phones.
 *
 * Content :
 *   - Clip player (vertical preferred, vertical_low when save-data is on).
 *   - Kill timing chip (T+mm:ss, multi_kill, first blood).
 *   - Killer → Victim matchup, AI description.
 *   - Score chip + AI tags.
 *   - Prev / Next buttons cycle through the match's chronological kills.
 *   - "Voir en plein écran" link → /scroll?kill=<id> (TikTok feed).
 *   - "Voir la fiche complète" link → /kill/<id>.
 *
 * Accessibility :
 *   - role="dialog" aria-modal="true" — closes on Esc + backdrop click.
 *   - Focus moves to the close button on mount, focus trap on Tab.
 *   - Respects prefers-reduced-motion (motion cross-fade only).
 *   - aria-live region announces the new active kill on Prev / Next.
 *
 * Why a separate component vs reusing `KillLightbox` ?
 *   - Lightbox is centred + uses framer's spring scale — premium for a
 *     full-page modal but heavy for the "scrub the timeline" UX where the
 *     user wants the page context to stay visible. The side panel keeps
 *     the timeline strip visible above (md+) or the strip just below
 *     the dot (mobile) so the dot-click → preview loop feels instant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  pickAssetUrl,
  pickBestForViewport,
} from "@/lib/kill-assets";
import type { PublishedKillRow } from "@/lib/supabase/kills";

// ─── Types ────────────────────────────────────────────────────────────

export interface KillSidePanelProps {
  /** Match kills in chronological order. */
  kills: PublishedKillRow[];
  /** Index of the currently-active kill, or null = closed. */
  activeIdx: number | null;
  /** Opponent display name — used in the panel subtitle. */
  opponentName: string;
  /** 3-letter opponent code — used in the prev/next preview labels. */
  opponentCode: string;
  /** Close handler. */
  onClose: () => void;
  /** Swap to a sibling kill. */
  onChange: (idx: number) => void;
}

// ─── Hooks ────────────────────────────────────────────────────────────

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useViewportClass(): "mobile" | "desktop" {
  const [cls, setCls] = useState<"mobile" | "desktop">("desktop");
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setCls(mq.matches ? "desktop" : "mobile");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return cls;
}

function useSaveData(): boolean {
  const [save, setSave] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    type ConnectionLike = { saveData?: boolean };
    const conn = (navigator as unknown as { connection?: ConnectionLike })
      .connection;
    setSave(!!conn?.saveData);
  }, []);
  return save;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatGameTime(seconds: number | null): string {
  if (seconds == null) return "??:??";
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

// ─── Component ────────────────────────────────────────────────────────

export function KillSidePanel({
  kills,
  activeIdx,
  opponentName,
  opponentCode,
  onClose,
  onChange,
}: KillSidePanelProps) {
  const reducedMotion = usePrefersReducedMotion();
  const viewport = useViewportClass();
  const saveData = useSaveData();

  const open = activeIdx !== null && activeIdx >= 0 && activeIdx < kills.length;
  const kill = open ? kills[activeIdx as number] : null;
  const hasPrev = open && (activeIdx as number) > 0;
  const hasNext = open && (activeIdx as number) < kills.length - 1;

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // ─── Body scroll lock ──────────────────────────────────────────────
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ─── Focus mgmt ────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      closeBtnRef.current?.focus();
    }
  }, [open]);

  // ─── Keyboard ──────────────────────────────────────────────────────
  const goPrev = useCallback(() => {
    if (hasPrev) onChange((activeIdx as number) - 1);
  }, [hasPrev, activeIdx, onChange]);
  const goNext = useCallback(() => {
    if (hasNext) onChange((activeIdx as number) + 1);
  }, [hasNext, activeIdx, onChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, goPrev, goNext]);

  // ─── Video source pick ─────────────────────────────────────────────
  const videoSrc = useMemo(() => {
    if (!kill) return null;
    return pickBestForViewport(kill, {
      // Vertical 9:16 always inside the side panel — it tracks the
      // worker's primary asset and the panel itself is portrait-oriented.
      isDesktop: false,
      lowQuality: saveData,
    });
  }, [kill, saveData]);
  const poster = useMemo(
    () => (kill ? pickAssetUrl(kill, "thumbnail") : null),
    [kill],
  );

  // ─── Animation variants ────────────────────────────────────────────
  const overlay = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0.18 } },
        exit: { opacity: 0, transition: { duration: 0.15 } },
      };

  const dialog = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : viewport === "desktop"
      ? {
          initial: { opacity: 0, x: 60 },
          animate: {
            opacity: 1,
            x: 0,
            transition: { type: "spring" as const, stiffness: 320, damping: 32 },
          },
          exit: { opacity: 0, x: 40, transition: { duration: 0.15 } },
        }
      : {
          initial: { opacity: 0, y: 80 },
          animate: {
            opacity: 1,
            y: 0,
            transition: { type: "spring" as const, stiffness: 320, damping: 32 },
          },
          exit: { opacity: 0, y: 60, transition: { duration: 0.15 } },
        };

  return (
    <AnimatePresence>
      {open && kill ? (
        <motion.div
          key="kill-side-overlay"
          className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm"
          initial={overlay.initial}
          animate={overlay.animate}
          exit={overlay.exit}
          onClick={onClose}
        >
          <motion.aside
            key="kill-side-panel"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="kill-side-title"
            aria-describedby="kill-side-desc"
            onClick={(e) => e.stopPropagation()}
            initial={dialog.initial}
            animate={dialog.animate}
            exit={dialog.exit}
            className={
              viewport === "desktop"
                ? "absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-[var(--border-gold)] bg-[var(--bg-elevated)] shadow-2xl shadow-black/60"
                : "absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl border-t-2 border-[var(--gold)]/40 bg-[var(--bg-elevated)] shadow-2xl shadow-black/60"
            }
          >
            {/* Mobile drag-handle decoration */}
            {viewport === "mobile" && (
              <div className="pt-2.5 pb-1 flex justify-center" aria-hidden>
                <span className="h-1 w-12 rounded-full bg-[var(--gold)]/40" />
              </div>
            )}

            {/* ─── Header ─────────────────────────────────────────── */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-gold)] bg-[var(--bg-primary)]/95 backdrop-blur px-4 py-3">
              <div className="min-w-0 flex-1">
                <p
                  className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)] mb-0.5"
                  aria-live="polite"
                >
                  Game {kill.games?.game_number ?? "?"} · T+
                  {formatGameTime(kill.game_time_seconds)}
                </p>
                <h2
                  id="kill-side-title"
                  className="font-display text-base font-bold text-[var(--text-primary)] truncate"
                >
                  {kill.multi_kill ? (
                    <span className="mr-1.5 rounded-md bg-[var(--gold)]/15 px-1.5 py-0.5 font-data text-[10px] uppercase tracking-widest text-[var(--gold)]">
                      {kill.multi_kill}
                    </span>
                  ) : null}
                  {kill.is_first_blood ? (
                    <span
                      className="mr-1.5 text-xs"
                      aria-label="Premier sang"
                      title="Premier sang"
                    >
                      {"🩸"}
                    </span>
                  ) : null}
                  <span
                    className={
                      kill.tracked_team_involvement === "team_killer"
                        ? "text-[var(--gold)]"
                        : "text-[var(--red)]"
                    }
                  >
                    {kill.killer_champion ?? "?"}
                  </span>{" "}
                  <span className="text-[var(--text-muted)]">→</span>{" "}
                  <span
                    className={
                      kill.tracked_team_involvement === "team_killer"
                        ? "text-[var(--red)]"
                        : "text-[var(--gold)]"
                    }
                  >
                    {kill.victim_champion ?? "?"}
                  </span>
                </h2>
                <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  vs {opponentName}
                </p>
              </div>
              <button
                ref={closeBtnRef}
                type="button"
                onClick={onClose}
                aria-label="Fermer le panneau du kill"
                className="ml-2 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)] text-[var(--gold)] transition-colors hover:bg-[var(--gold)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 6l12 12M18 6L6 18"
                  />
                </svg>
              </button>
            </div>

            {/* ─── Video / poster ─────────────────────────────────── */}
            <div className="relative bg-black">
              {videoSrc ? (
                <video
                  key={videoSrc.url}
                  src={videoSrc.url}
                  poster={poster ?? undefined}
                  autoPlay
                  playsInline
                  loop
                  controls
                  preload="metadata"
                  className="mx-auto block aspect-[9/16] max-h-[60vh] w-full max-w-xs object-contain sm:max-w-sm md:max-w-[360px]"
                  aria-label={`Clip vidéo : ${kill.killer_champion ?? "?"} élimine ${kill.victim_champion ?? "?"}`}
                />
              ) : poster ? (
                <div className="relative mx-auto aspect-[9/16] w-full max-w-xs">
                  <Image
                    src={poster}
                    alt={`${kill.killer_champion ?? "?"} élimine ${kill.victim_champion ?? "?"}`}
                    fill
                    sizes="(max-width: 768px) 88vw, 360px"
                    className="object-cover"
                    unoptimized
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                    <p className="rounded-md bg-black/70 px-3 py-1.5 text-xs text-[var(--text-muted)]">
                      Clip vidéo indisponible
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex aspect-[9/16] items-center justify-center bg-[var(--bg-surface)]">
                  <p className="text-xs text-[var(--text-muted)]">
                    Clip non disponible
                  </p>
                </div>
              )}

              {/* Prev / Next overlay */}
              <button
                type="button"
                onClick={goPrev}
                disabled={!hasPrev}
                aria-label="Kill précédent"
                className="absolute left-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-gold)] bg-black/60 text-[var(--gold)] backdrop-blur transition-opacity hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:cursor-not-allowed disabled:opacity-30"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 18l-6-6 6-6"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={!hasNext}
                aria-label="Kill suivant"
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-gold)] bg-black/60 text-[var(--gold)] backdrop-blur transition-opacity hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:cursor-not-allowed disabled:opacity-30"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 6l6 6-6 6"
                  />
                </svg>
              </button>
            </div>

            {/* ─── Body ───────────────────────────────────────────── */}
            <div className="space-y-3 px-4 py-4">
              {/* Description */}
              <p
                id="kill-side-desc"
                className="font-display text-sm leading-snug text-[var(--text-primary)]"
              >
                {kill.ai_description ??
                  kill.ai_description_fr ??
                  "Description IA indisponible."}
              </p>

              {/* Score + tags */}
              <div className="flex flex-wrap items-center gap-2">
                {kill.highlight_score != null && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--gold)]/30 bg-[var(--gold)]/10 px-2.5 py-1 font-data text-[11px] font-semibold text-[var(--gold)]">
                    <svg
                      className="h-3 w-3"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      aria-hidden
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    Score {kill.highlight_score.toFixed(1)}/10
                  </span>
                )}
                {kill.tracked_team_involvement === "team_killer" ? (
                  <span className="rounded-full border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-[var(--gold)]">
                    KC Kill
                  </span>
                ) : (
                  <span className="rounded-full border border-[var(--red)]/40 bg-[var(--red)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-[var(--red)]">
                    KC Death
                  </span>
                )}
                {kill.ai_tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-[var(--text-secondary)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              {/* Footer counters */}
              <div className="flex items-center justify-between border-t border-[var(--border-gold)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span className="font-data">
                  ★{" "}
                  {kill.avg_rating != null
                    ? kill.avg_rating.toFixed(1)
                    : "—"}
                  <span className="text-[var(--text-disabled)]">
                    {" "}
                    · {kill.rating_count} note
                    {kill.rating_count > 1 ? "s" : ""}
                  </span>
                </span>
                <span className="font-data text-[10px] uppercase tracking-widest text-[var(--text-disabled)]">
                  {(activeIdx as number) + 1} / {kills.length}
                </span>
              </div>

              {/* CTAs */}
              <div className="space-y-2 pt-1">
                <Link
                  href={`/scroll?kill=${kill.id}`}
                  onClick={onClose}
                  className="flex items-center justify-between rounded-xl border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-4 py-3 text-sm font-semibold uppercase tracking-widest text-[var(--gold)] transition-colors hover:bg-[var(--gold)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
                >
                  <span>Voir en plein écran</span>
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.4}
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </Link>
                <Link
                  href={`/kill/${kill.id}`}
                  onClick={onClose}
                  className="flex items-center justify-between rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] px-4 py-2.5 text-xs uppercase tracking-widest text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/40 hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
                >
                  <span>Voir la fiche complète</span>
                  <span className="text-[var(--text-disabled)]" aria-hidden>
                    ◆
                  </span>
                </Link>
              </div>

              {/* Side-by-side prev / next mini-previews */}
              <div className="grid grid-cols-2 gap-2 pt-3">
                <KillNeighborButton
                  label="Précédent"
                  kill={hasPrev ? kills[(activeIdx as number) - 1] : null}
                  opponentCode={opponentCode}
                  disabled={!hasPrev}
                  onClick={goPrev}
                />
                <KillNeighborButton
                  label="Suivant"
                  kill={hasNext ? kills[(activeIdx as number) + 1] : null}
                  opponentCode={opponentCode}
                  disabled={!hasNext}
                  onClick={goNext}
                  alignRight
                />
              </div>
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ─── Neighbor preview button ──────────────────────────────────────────

function KillNeighborButton({
  label,
  kill,
  opponentCode,
  disabled,
  onClick,
  alignRight,
}: {
  label: string;
  kill: PublishedKillRow | null;
  opponentCode: string;
  disabled: boolean;
  onClick: () => void;
  alignRight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex flex-col gap-0.5 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] p-2.5 text-left transition-colors hover:border-[var(--gold)]/40 hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] ${alignRight ? "items-end text-right" : ""}`}
    >
      <span className="font-data text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </span>
      <span className="truncate text-[11px] font-medium text-[var(--text-primary)]">
        {kill
          ? `${kill.killer_champion ?? "?"} → ${kill.victim_champion ?? "?"}`
          : "—"}
      </span>
      {kill ? (
        <span className="font-data text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
          T+{formatGameTime(kill.game_time_seconds)} ·{" "}
          {kill.tracked_team_involvement === "team_killer"
            ? "KC"
            : opponentCode}
        </span>
      ) : null}
    </button>
  );
}
