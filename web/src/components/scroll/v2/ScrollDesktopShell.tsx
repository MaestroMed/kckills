"use client";

/**
 * ScrollDesktopShell — Wave 36 / the 3-zone desktop wide-stage (≥1024) shell.
 *
 * Mounts ONLY when ScrollFeedV2's isWideStage flag is true (min-width 1024).
 * The <768 mobile feed never reaches this file — it stays on the sacred
 * fixed-inset-0 tree. This is the structural core that turns /scroll from a
 * full-bleed blow-up into a framed cinema:
 *
 *   ┌─────────┬──────────────────────────┬──────────┐
 *   │  nav    │          stage           │   ctx    │
 *   │ (rail)  │   <StageFrame>{pool}</>   │ (panel)  │
 *   │ 248/72  │      minmax(0,1fr)        │  372px   │
 *   └─────────┴──────────────────────────┴──────────┘
 *
 * grid-template-columns: var(--rail) minmax(0,1fr) var(--ctx)
 * grid-template-areas:   "nav stage ctx"
 * block-size: 100dvh ; background via .scroll-hall (NEVER #000).
 *
 * ── RESPONSIVE (1024–1279) ────────────────────────────────────────────
 * On the in-between desktop band the side columns are too greedy, so:
 *   - --rail collapses to 72px (ScrollRail collapsed=icon mode ; its own
 *     hover-expand is a fixed overlay handled inside ScrollRail).
 *   - the ctx column becomes a CLOSED-BY-DEFAULT right DRAWER (focus-trap,
 *     Esc, role=dialog) toggled by a floating button + the `C` key.
 * From 1280 up, both columns are permanent tracks.
 *
 * The `C`-key + comment toggle is bridged via the `kc:toggle-context`
 * window event (dispatched by ScrollFeedV2's keymap onComment) so the
 * keyboard hook doesn't need a ref into this component.
 *
 * INTERFACE:
 *   export function ScrollDesktopShell({
 *     children, activeKill, clipCount, onJumpTo, related, cinema
 *   })
 * where `children` is the FeedPlayerPool subtree (passed straight into
 * <StageFrame>).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { m, AnimatePresence, useReducedMotion } from "motion/react";
import type { VideoFeedItem } from "@/components/scroll/ScrollFeed";
import { ScrollRail } from "./ScrollRail";
import { ScrollContextPanel, type RelatedFeedCandidate } from "./ScrollContextPanel";
import { StageFrame } from "./StageFrame";
import { useT } from "@/lib/i18n/use-lang";

interface ScrollDesktopShellProps {
  /** The FeedPlayerPool subtree — rendered inside the bounded StageFrame. */
  children: React.ReactNode;
  /** The currently-active feed item. Only VideoFeedItem carries the match
   *  metadata + AI description the context panel annotates ; non-video
   *  active items (moments/aggregates) suppress the panel content. */
  activeKill: VideoFeedItem | null;
  clipCount?: number;
  /** Jump the feed to absolute index `i` — wired to the "À suivre" thumbs. */
  onJumpTo?: (index: number) => void;
  /** feed_score-ranked neighbours for the panel's "À suivre" strip. Built
   *  by the parent from the in-memory feed — NO new fetch. */
  related?: RelatedFeedCandidate[];
  /** Cinema mode — threaded straight to StageFrame (9:16 → 16:9). */
  cinema?: boolean;
}

export function ScrollDesktopShell({
  children,
  activeKill,
  clipCount,
  onJumpTo,
  related = [],
  cinema = false,
}: ScrollDesktopShellProps) {
  const t = useT();
  const reduce = useReducedMotion();

  // ─── In-between band detection (1024–1279) ──────────────────────────
  // At <1280 the rail collapses to icons and the ctx column becomes a
  // drawer. At ≥1280 both are permanent tracks. SSR-safe default = false
  // (the parent only mounts us ≥1024, so the worst first-paint case is a
  // brief full-width rail that snaps to collapsed — no layout break).
  const [isNarrowDesktop, setIsNarrowDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px) and (max-width: 1279px)");
    const apply = () => setIsNarrowDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    // Re-read on raw resize too — the MQ `change` event alone is unreliable
    // across the boundary in some environments ; this keeps the rail-collapse
    // + ctx-drawer switch from getting stuck.
    window.addEventListener("resize", apply);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);

  // ─── Drawer state (only meaningful in the narrow band) ──────────────
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The `C` key (ScrollFeedV2 keymap onComment) dispatches kc:toggle-context.
  // In the narrow band that toggles the drawer ; in the wide band the panel
  // is always visible so we no-op (the keystroke still reaches CommentSheetV2
  // inside the panel for the in-place comment focus, which it owns).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onToggle = () => {
      if (mqNarrow()) setDrawerOpen((v) => !v);
    };
    window.addEventListener("kc:toggle-context", onToggle);
    return () => window.removeEventListener("kc:toggle-context", onToggle);
  }, []);

  // Close the drawer when we leave the narrow band (e.g. user widens the
  // window) so it doesn't linger as a stuck overlay over the permanent col.
  useEffect(() => {
    if (!isNarrowDesktop) setDrawerOpen(false);
  }, [isNarrowDesktop]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div
      className="scroll-hall fixed inset-0 z-[60] overflow-hidden"
      style={{
        display: "grid",
        // Narrow band (1024–1279): rail collapses to a 72px icon column AND
        // the ctx track is dropped (it becomes the drawer). The 72px here
        // MUST match ScrollRail's internal collapsed width so the track and
        // the rail agree. Wide band (≥1280): full --rail + --ctx tracks.
        gridTemplateColumns: isNarrowDesktop
          ? "72px minmax(0,1fr)"
          : "var(--rail) minmax(0,1fr) var(--ctx)",
        gridTemplateAreas: isNarrowDesktop
          ? '"nav stage"'
          : '"nav stage ctx"',
        blockSize: "100dvh",
      }}
    >
      {/* ── NAV ── persistent left rail. Collapses to 72px icons in the
          narrow band (its hover-expand is a fixed overlay handled inside
          ScrollRail). --rail is overridden to 72px below via a data attr. */}
      <div style={{ gridArea: "nav", minWidth: 0 }}>
        <ScrollRail clipCount={clipCount} collapsed={isNarrowDesktop} />
      </div>

      {/* ── STAGE ── the bounded 9:16 cinema box. The pool subtree lives
          inside StageFrame, so its width:100% resolves to the FRAME. */}
      <div style={{ gridArea: "stage", minWidth: 0, position: "relative" }}>
        <StageFrame cinema={cinema}>{children}</StageFrame>
      </div>

      {/* ── CTX ── permanent right column (wide band only). */}
      {!isNarrowDesktop && (
        <div style={{ gridArea: "ctx", minWidth: 0 }}>
          {activeKill ? (
            <ScrollContextPanel
              kill={activeKill}
              onJumpTo={onJumpTo}
              related={related}
            />
          ) : (
            <ContextPanelEmpty />
          )}
        </div>
      )}

      {/* ── NARROW-BAND DRAWER ── closed-by-default right drawer that the
          floating button + the C key open. Focus-trap + Esc + role=dialog. */}
      {isNarrowDesktop && (
        <>
          {/* Floating open button — only when the drawer is closed. Lives
              top-right so it never collides with the stage's action rail. */}
          {!drawerOpen && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={t("p_scroll.sh_open_context")}
              aria-keyshortcuts="C"
              className="group fixed right-5 top-5 z-[70] flex h-12 w-12 items-center justify-center rounded-full border border-[var(--gold)]/45 bg-[var(--bg-surface)]/80 backdrop-blur-md text-[var(--gold)] shadow-[0_8px_26px_rgba(0,0,0,0.5)] transition-colors hover:border-[var(--gold)] hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </button>
          )}

          <ContextDrawer
            open={drawerOpen}
            onClose={closeDrawer}
            reduce={reduce ?? false}
          >
            {activeKill ? (
              <ScrollContextPanel
                kill={activeKill}
                onJumpTo={(i) => {
                  onJumpTo?.(i);
                  closeDrawer();
                }}
                related={related}
              />
            ) : (
              <ContextPanelEmpty />
            )}
          </ContextDrawer>
        </>
      )}
    </div>
  );
}

// matchMedia helper read at event time (avoids a stale-closure capture of
// isNarrowDesktop inside the kc:toggle-context listener).
function mqNarrow(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(min-width: 1024px) and (max-width: 1279px)").matches;
}

// ════════════════════════════════════════════════════════════════════
// ContextDrawer — focus-trapped, Esc-closable right drawer (narrow band).
// role=dialog + aria-modal. Slides from the right edge ; a scrim dims the
// stage behind. Reuses the .glass / gold-hairline language of the panel.
// ════════════════════════════════════════════════════════════════════

function ContextDrawer({
  open,
  onClose,
  reduce,
  children,
}: {
  open: boolean;
  onClose: () => void;
  reduce: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Esc to close + focus trap. On open we stash the previously-focused
  // element and move focus into the drawer ; on close we restore it.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;

    // Move focus to the first focusable element in the panel (fallback: the
    // panel itself, which carries tabIndex=-1).
    const node = panelRef.current;
    const focusFirst = () => {
      if (!node) return;
      const focusables = node.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      (focusables[0] ?? node).focus();
    };
    // Defer one frame so the slide-in mount has committed.
    const raf = requestAnimationFrame(focusFirst);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
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
    };

    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      // Restore focus to the opener.
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <m.div
          className="fixed inset-0 z-[80] flex justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.2 }}
        >
          {/* Scrim — click to close. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-black/55"
            onClick={onClose}
          />
          {/* Drawer panel — slides from the right. ScrollContextPanel sets
              its own width:var(--ctx) ; we cap to the viewport so it never
              overflows on a 1024px screen. */}
          <m.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("p_scroll.sh_context_label")}
            tabIndex={-1}
            className="relative h-full max-w-[90vw] outline-none"
            initial={reduce ? { opacity: 0 } : { x: "100%" }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: "100%" }}
            transition={
              reduce
                ? { duration: 0 }
                : { type: "spring", stiffness: 320, damping: 34 }
            }
          >
            {/* Close affordance inside the drawer for pointer users. */}
            <button
              type="button"
              onClick={onClose}
              aria-label={t("p_scroll.sh_close_context")}
              className="absolute right-3 top-3 z-[90] flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white/75 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-[var(--gold)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {children}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

// ════════════════════════════════════════════════════════════════════
// ContextPanelEmpty — quiet placeholder when the active item isn't a
// video kill (a moment / aggregate). Keeps the column from going blank.
// ════════════════════════════════════════════════════════════════════

function ContextPanelEmpty() {
  const t = useT();
  return (
    <aside
      role="complementary"
      aria-label={t("p_scroll.sh_context_label")}
      className="relative flex h-full items-center justify-center bg-[var(--bg-surface)]/70 px-6 backdrop-blur-md"
      style={{ width: "var(--ctx)" }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-px"
        style={{
          background:
            "linear-gradient(to bottom, transparent, var(--gold), transparent)",
        }}
      />
      <p className="text-center font-data text-[11px] uppercase tracking-[0.28em] text-[var(--text-muted)]">
        {t("p_scroll.sh_empty_panel_l1")}
        <br />
        {t("p_scroll.sh_empty_panel_l2")}
      </p>
    </aside>
  );
}
