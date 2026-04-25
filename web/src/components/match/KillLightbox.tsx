"use client";

/**
 * KillLightbox — modal overlay opened from `MatchTimeline` dots.
 *
 * Renders a centered video (vertical 9:16 on phones, horizontal 16:9
 * from sm: up via `pickBestForViewport`) with the killer → victim
 * matchup as the title, the AI description, a score chip, AI tags, a
 * (read-only) star rating, the comment count, and a link to the full
 * `/kill/[id]` detail page. Prev / Next buttons cycle through the
 * match's chronological kill list (disabled at the boundaries).
 *
 * Behaviour :
 *   - Backdrop blur (backdrop-blur-md). Click on the backdrop closes.
 *   - Esc key closes. Arrow Left / Right cycle prev / next clip.
 *   - Body scroll is locked while the modal is open
 *     (`document.body.style.overflow = "hidden"`).
 *   - Focus trap : the close button receives focus on mount, and a
 *     keydown handler bounces Tab back into the dialog if it tries to
 *     escape.
 *   - Framer-motion `AnimatePresence` drives the entrance / exit. The
 *     spring is killed when `prefers-reduced-motion: reduce` matches —
 *     in that case the modal cross-fades only.
 *   - Fires `clip.opened` once per mount with `{ kill_id, source:
 *     "match_timeline" }`. `track()` is silent on failure so this is
 *     safe even if the analytics endpoint is down.
 *
 * Mobile-first per CLAUDE.md (375px design target). The dialog
 * container is full-bleed on small viewports (mx-3 inset), capped at
 * max-w-3xl from md: up. Vertical clip variant is the default
 * (matches the worker's primary asset), horizontal is preferred from
 * the `sm:` breakpoint up via the `pickBestForViewport` chain.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { pickAssetUrl, pickBestForViewport } from "@/lib/kill-assets";
import { track } from "@/lib/analytics/track";
import { StarRating } from "@/components/star-rating";
import type { PublishedKillRow } from "@/lib/supabase/kills";

// ─── Types ────────────────────────────────────────────────────────────

export interface KillLightboxProps {
  /** All match kills, in chronological order (built by parent). */
  kills: PublishedKillRow[];
  /** Index into `kills` of the currently displayed clip. */
  activeIdx: number;
  /** Opponent full name — used in the modal subtitle. */
  opponentName: string;
  /** Close the modal. */
  onClose: () => void;
  /** Switch to a sibling kill (prev / next button or arrow keys). */
  onChange: (idx: number) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Detect `prefers-reduced-motion: reduce`. Returns false during SSR
 * so the first paint matches the unanimated baseline (avoids a hydration
 * flash for users who toggle the OS setting between renders).
 */
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

/**
 * Track viewport size cheaply for the manifest pick. We only need a
 * "is this a desktop-ish viewport" boolean — the threshold matches the
 * Tailwind `md` breakpoint.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

/** Read the saver-data hint to bias the asset pick toward `vertical_low`. */
function useSaveData(): boolean {
  const [save, setSave] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    type ConnectionLike = { saveData?: boolean };
    const conn = (navigator as unknown as { connection?: ConnectionLike }).connection;
    setSave(!!conn?.saveData);
  }, []);
  return save;
}

function formatGameTime(seconds: number | null): string {
  if (seconds == null) return "??:??";
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

// ─── Component ────────────────────────────────────────────────────────

export function KillLightbox({
  kills,
  activeIdx,
  opponentName,
  onClose,
  onChange,
}: KillLightboxProps) {
  const reducedMotion = usePrefersReducedMotion();
  const isDesktop = useIsDesktop();
  const saveData = useSaveData();

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const kill = kills[activeIdx];
  const hasPrev = activeIdx > 0;
  const hasNext = activeIdx < kills.length - 1;

  // ─── Body scroll lock ──────────────────────────────────────────────
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ─── Focus management — focus close button on mount ────────────────
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  // ─── Analytics — fire `clip.opened` once per mount AND on idx change.
  // Re-running when `kill?.id` changes covers the cycle case where the
  // user clicks Next without unmounting, so we still record the new clip
  // view. `track()` is silent on failure (sendBeacon fallback in the
  // tracker), so this is safe to call from a render effect.
  useEffect(() => {
    if (!kill?.id) return;
    track("clip.opened", {
      entityType: "kill",
      entityId: kill.id,
      metadata: { source: "match_timeline" },
    });
  }, [kill?.id]);

  // ─── Keyboard handlers ─────────────────────────────────────────────
  const goPrev = useCallback(() => {
    if (hasPrev) onChange(activeIdx - 1);
  }, [hasPrev, activeIdx, onChange]);
  const goNext = useCallback(() => {
    if (hasNext) onChange(activeIdx + 1);
  }, [hasNext, activeIdx, onChange]);

  useEffect(() => {
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
        // Focus trap : keep Tab inside the dialog. The dialog is
        // small enough that we just bounce on the close button if
        // the user tries to tab out.
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
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
  }, [onClose, goPrev, goNext]);

  // ─── Pick the best video URL for the viewport ──────────────────────
  // Recompute when the viewport / save-data flips OR when the active
  // clip changes (otherwise navigating prev/next would keep the
  // previous src). pickBestForViewport handles legacy rows that have
  // no manifest by falling back through the flat columns.
  const videoSrc = useMemo(() => {
    if (!kill) return null;
    return pickBestForViewport(kill, {
      isDesktop,
      lowQuality: saveData,
    });
  }, [kill, isDesktop, saveData]);
  const poster = useMemo(() => {
    if (!kill) return null;
    return pickAssetUrl(kill, "thumbnail");
  }, [kill]);

  if (!kill) return null;

  // Localise to FR by default — the AI description is multi-language
  // but the worker writes the "main" `ai_description` in French, so
  // that's our happy path. Fall back to ai_description_fr if the main
  // column was somehow null (legacy rows pre-migration 030).
  const description = kill.ai_description ?? kill.ai_description_fr ?? "";

  // Animation variants — disabled when the user opted out of motion.
  const overlayVariants = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0.18 } },
        exit: { opacity: 0, transition: { duration: 0.15 } },
      };
  const dialogVariants = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.96, y: 12 },
        animate: {
          opacity: 1,
          scale: 1,
          y: 0,
          transition: { type: "spring" as const, stiffness: 320, damping: 28 },
        },
        exit: {
          opacity: 0,
          scale: 0.97,
          y: 8,
          transition: { duration: 0.15 },
        },
      };

  return (
    <AnimatePresence>
      <motion.div
        key="kill-lightbox-overlay"
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-md"
        onClick={onClose}
        initial={overlayVariants.initial}
        animate={overlayVariants.animate}
        exit={overlayVariants.exit}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="kill-lightbox-title"
          aria-describedby="kill-lightbox-desc"
          className="relative mx-3 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-elevated)] shadow-2xl shadow-black/60"
          onClick={(e) => e.stopPropagation()}
          initial={dialogVariants.initial}
          animate={dialogVariants.animate}
          exit={dialogVariants.exit}
        >
          {/* ─── Header bar ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between border-b border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 sm:px-4 sm:py-3">
            <div className="min-w-0">
              <p
                id="kill-lightbox-title"
                className="truncate font-display text-sm font-semibold text-[var(--text-primary)] sm:text-base"
              >
                {kill.multi_kill ? (
                  <span className="mr-1.5 rounded-md bg-[var(--gold)]/15 px-1.5 py-0.5 font-data text-[10px] uppercase tracking-widest text-[var(--gold)]">
                    {kill.multi_kill}
                  </span>
                ) : null}
                {kill.is_first_blood ? (
                  <span className="mr-1.5 text-xs" aria-label="Premier sang" title="Premier sang">
                    {"\uD83E\uDE78"}
                  </span>
                ) : null}
                <span className="text-[var(--gold)]">
                  {kill.killer_champion ?? "?"}
                </span>{" "}
                <span className="text-[var(--text-muted)]">→</span>{" "}
                <span className="text-[var(--red)]">
                  {kill.victim_champion ?? "?"}
                </span>
              </p>
              <p className="mt-0.5 truncate text-[10px] uppercase tracking-widest text-[var(--text-muted)] sm:text-[11px]">
                Game {kill.games?.game_number ?? "?"} ·{" "}
                T+{formatGameTime(kill.game_time_seconds)} · vs {opponentName}
              </p>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label="Fermer le clip"
              className="ml-2 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)] text-[var(--gold)] transition-colors hover:bg-[var(--gold)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 6l12 12M18 6L6 18"
                />
              </svg>
            </button>
          </div>

          {/* ─── Video region ───────────────────────────────────────── */}
          <div className="relative bg-black">
            {videoSrc ? (
              <video
                ref={videoRef}
                key={videoSrc.url}
                src={videoSrc.url}
                poster={poster ?? undefined}
                className={`mx-auto block max-h-[55vh] w-full object-contain ${
                  videoSrc.type === "horizontal"
                    ? "aspect-video"
                    : "aspect-[9/16] max-w-xs sm:max-w-sm"
                }`}
                autoPlay
                playsInline
                controls
                preload="metadata"
                aria-label={`Clip vidéo : ${kill.killer_champion ?? "?"} élimine ${kill.victim_champion ?? "?"}`}
              />
            ) : poster ? (
              <div className="relative mx-auto aspect-video max-h-[55vh] w-full">
                <Image
                  src={poster}
                  alt={`${kill.killer_champion ?? "?"} élimine ${kill.victim_champion ?? "?"}`}
                  fill
                  sizes="(max-width: 768px) 100vw, 768px"
                  className="object-contain"
                  unoptimized
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <p className="rounded-md bg-black/70 px-3 py-1.5 text-xs text-[var(--text-muted)]">
                    Aucun clip vidéo disponible
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex aspect-video items-center justify-center bg-[var(--bg-surface)]">
                <p className="text-xs text-[var(--text-muted)]">
                  Clip non disponible
                </p>
              </div>
            )}

            {/* Prev / Next overlay buttons */}
            <button
              type="button"
              onClick={goPrev}
              disabled={!hasPrev}
              aria-label="Clip précédent"
              className="absolute left-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-gold)] bg-black/60 text-[var(--gold)] backdrop-blur transition-opacity hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:cursor-not-allowed disabled:opacity-30"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={!hasNext}
              aria-label="Clip suivant"
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-gold)] bg-black/60 text-[var(--gold)] backdrop-blur transition-opacity hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:cursor-not-allowed disabled:opacity-30"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>

          {/* ─── Body : description, score, tags, rating, comments ──── */}
          <div className="space-y-3 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
            {description ? (
              <p
                id="kill-lightbox-desc"
                className="font-display text-sm leading-snug text-[var(--text-primary)] sm:text-base"
              >
                {description}
              </p>
            ) : (
              <p
                id="kill-lightbox-desc"
                className="text-xs italic text-[var(--text-muted)]"
              >
                Description IA indisponible.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {kill.highlight_score != null && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--gold)]/30 bg-[var(--gold)]/10 px-2.5 py-1 font-data text-[11px] font-semibold text-[var(--gold)]">
                  <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  Score {kill.highlight_score.toFixed(1)}/10
                </span>
              )}
              {kill.ai_tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-[var(--text-secondary)]"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-gold)] pt-3">
              <div className="flex items-center gap-2">
                <StarRating
                  rating={kill.avg_rating ?? 0}
                  size="sm"
                  readonly
                />
                <span className="font-data text-[11px] text-[var(--text-muted)]">
                  {kill.avg_rating != null ? kill.avg_rating.toFixed(1) : "—"}
                  {" · "}
                  {kill.rating_count} note{kill.rating_count > 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.84L3 20l1.04-3.66A8.94 8.94 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  {kill.comment_count}
                </span>
                <Link
                  href={`/kill/${kill.id}`}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-[var(--gold)] transition-colors hover:bg-[var(--gold)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
                  onClick={() => {
                    // Close before navigating so the body scroll lock
                    // is released and the next page lands clean.
                    onClose();
                  }}
                >
                  Voir la fiche
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>

            <p className="text-center font-data text-[10px] uppercase tracking-widest text-[var(--text-disabled)]">
              {activeIdx + 1} / {kills.length}
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
