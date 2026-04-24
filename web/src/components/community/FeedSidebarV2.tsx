"use client";

/**
 * FeedSidebarV2 — TikTok-style action rail anchored bottom-right of
 * each feed item.
 *
 * Replaces the v1 RightSidebar (Rate / Chat / Share / Detail). The
 * v2 lineup matches TikTok's mental model:
 *
 *     [Like ❤]      heart toggle, optimistic, count below (LikeButton)
 *     [Comments]    bubble icon, count, opens CommentSheetV2
 *     [Share]       Web Share API with sheet fallback
 *     [Star]        kept as secondary — opens 5-star sheet for users
 *                   who really want to grade beyond binary like
 *     [Detail]      link to /kill/[id] for full page
 *
 * The sidebar itself owns the InlineAuthPrompt — every action that
 * needs auth raises the prompt with the right `intent` so the copy
 * matches what the user was trying to do.
 *
 * Mobile (default): 6 buttons stacked vertically, anchored bottom-right
 * Desktop: same layout, just bigger hit targets via `variant="wide"`.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { LikeButton } from "./LikeButton";
import { CommentSheetV2 } from "./CommentSheetV2";
import { InlineAuthPrompt } from "./InlineAuthPrompt";
import { ReportButton, type ReportButtonController } from "./ReportButton";
import { track } from "@/lib/analytics/track";

// Long-press duration to open the report sheet directly. 500ms is the
// industry-standard threshold (iOS context menus, Android long-press).
// Less feels accidental on horizontal-scroll surfaces, more feels
// unresponsive.
const LONG_PRESS_MS = 500;

interface Props {
  killId: string;
  shareTitle: string;
  shareText?: string;
  /** Initial counts from server-render, avoid 0 flash. */
  initialLikeCount?: number;
  initialCommentCount?: number;
  /** Whether the parent is currently visible — drives entry animation
   *  + lazy-loads the comment sheet only when item is interactive. */
  visible: boolean;
}

export function FeedSidebarV2({
  killId,
  shareTitle,
  shareText,
  initialLikeCount = 0,
  initialCommentCount = 0,
  visible,
}: Props) {
  const [authPromptIntent, setAuthPromptIntent] = useState<
    "like" | "comment" | "rate" | "share" | null
  >(null);
  const [showComments, setShowComments] = useState(false);
  const [shareSheet, setShareSheet] = useState(false);
  // Long-press shortcut → opens the report sheet without going through
  // the "..." dropdown. We hand a ref to ReportButton and call .open()
  // when the pointer-down survives 500ms.
  const reportControllerRef = useRef<ReportButtonController | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const startLongPress = (e: React.PointerEvent) => {
    // Ignore secondary buttons + non-primary pointers (e.g. right
    // mouse button, hover-only stylus).
    if (e.button !== 0 && e.pointerType === "mouse") return;
    longPressFiredRef.current = false;
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      // Vibrate on supported devices for physical feedback that the
      // long-press fired — matches Android long-press affordance.
      try {
        navigator.vibrate?.(15);
      } catch {
        /* not supported, fine */
      }
      reportControllerRef.current?.open();
    }, LONG_PRESS_MS);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const stopLongPressCapture = (e: React.PointerEvent) => {
    cancelLongPress();
    // If the long-press fired, swallow the click that follows so the
    // ReportButton's own onClick doesn't toggle the sheet a second
    // time. ReactSynthetic events don't bubble after stopPropagation.
    if (longPressFiredRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/kill/${killId}`
      : "";

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    track("clip.shared", { entityType: "kill", entityId: killId });
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          url: shareUrl,
          title: shareTitle,
          ...(shareText ? { text: shareText } : {}),
        });
        return;
      } catch (err) {
        const name = (err as { name?: string })?.name;
        if (name === "AbortError") return;
        // Real failure — fall through to manual sheet
      }
    }
    setShareSheet(true);
  };

  return (
    <>
      <div
        className={`absolute right-3 md:right-5 lg:right-7 2xl:right-12 bottom-32 md:bottom-40 lg:bottom-48 2xl:bottom-56 z-20 flex flex-col items-center gap-4 md:gap-5 lg:gap-6 2xl:gap-7 transition-all duration-500 delay-150 ${
          visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-3 pointer-events-none"
        }`}
      >
        {/* Like — primary action, biggest visual presence.
            Variant scales: compact (mobile/tablet) → wide (≥1280px). */}
        <div className="block lg:hidden">
          <LikeButton
            killId={killId}
            initialCount={initialLikeCount}
            variant="compact"
            onAuthRequired={() => setAuthPromptIntent("like")}
          />
        </div>
        <div className="hidden lg:block">
          <LikeButton
            killId={killId}
            initialCount={initialLikeCount}
            variant="wide"
            onAuthRequired={() => setAuthPromptIntent("like")}
          />
        </div>

        {/* Comments */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            track("clip.opened", {
              entityType: "kill",
              entityId: killId,
              metadata: { surface: "comments" },
            });
            setShowComments(true);
          }}
          aria-label={`Commentaires (${initialCommentCount})`}
          className="flex flex-col items-center gap-1.5 lg:gap-2 select-none"
        >
          <div className="flex h-12 w-12 lg:h-14 lg:w-14 2xl:h-16 2xl:w-16 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm border border-white/15 transition-all hover:bg-black/75 hover:border-white/25 active:scale-90 shadow-[0_4px_18px_rgba(0,0,0,0.5)]">
            <svg
              className="h-6 w-6 lg:h-7 lg:w-7 2xl:h-8 2xl:w-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
          <span className="font-data text-[10px] lg:text-xs 2xl:text-sm font-bold tabular-nums text-white/80">
            {formatCount(initialCommentCount)}
          </span>
        </button>

        {/* Share */}
        <button
          type="button"
          onClick={handleShare}
          aria-label="Partager"
          className="flex flex-col items-center gap-1.5 lg:gap-2 select-none"
        >
          <div className="flex h-12 w-12 lg:h-14 lg:w-14 2xl:h-16 2xl:w-16 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm border border-white/15 transition-all hover:bg-black/75 hover:border-white/25 active:scale-90 shadow-[0_4px_18px_rgba(0,0,0,0.5)]">
            <svg
              className="h-5 w-5 lg:h-6 lg:w-6 2xl:h-7 2xl:w-7 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4m0 0L8 6m4-4v13"
              />
            </svg>
          </div>
          <span className="font-data text-[10px] lg:text-xs 2xl:text-sm font-bold text-white/80">
            Partager
          </span>
        </button>

        {/* Detail link — keep visual hierarchy lower than the social actions */}
        <Link
          href={`/kill/${killId}`}
          onClick={(e) => e.stopPropagation()}
          className="flex flex-col items-center gap-1.5 mt-1 select-none"
          aria-label="Voir le détail"
        >
          <div className="flex h-10 w-10 lg:h-12 lg:w-12 2xl:h-14 2xl:w-14 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm border border-white/10 transition-all hover:bg-black/65 active:scale-90">
            <svg
              className="h-5 w-5 lg:h-6 lg:w-6 2xl:h-7 2xl:w-7 text-white/75"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        </Link>

        {/* Report — tertiary action, smallest visual weight. The user-
            triggered QC loop : flagging here enqueues a qc.verify job
            so the worker re-checks the clip / re-runs Gemini analysis.

            Mobile-first gesture : long-press (500ms) opens the report
            sheet directly without going through the "..." dropdown.
            Tap behaviour is unchanged. The wrapping <span> is the
            gesture surface — we can't put pointer handlers on the
            ReportButton itself because it has its own onClick logic
            and we want the long-press to short-circuit the click. */}
        <span
          onPointerDown={startLongPress}
          onPointerUp={stopLongPressCapture}
          onPointerCancel={cancelLongPress}
          onPointerLeave={cancelLongPress}
          // Suppress the iOS context-menu (text callout) on a long
          // press — we're using long-press for our own gesture.
          onContextMenu={(e) => {
            if (longPressFiredRef.current) e.preventDefault();
          }}
          style={{ touchAction: "manipulation", WebkitTouchCallout: "none" }}
          className="inline-flex"
        >
          <ReportButton
            targetType="kill"
            targetId={killId}
            size="md"
            ariaLabel="Signaler ce kill"
            controllerRef={reportControllerRef}
          />
        </span>
      </div>

      {/* Comment sheet — lazy mount via the isOpen prop driving its
          own AnimatePresence transitions. We render it always so the
          mount-then-render flicker is avoided; CommentSheetV2 returns
          null when isOpen=false. */}
      <CommentSheetV2
        killId={killId}
        isOpen={showComments}
        onClose={() => setShowComments(false)}
        onAuthRequired={() => setAuthPromptIntent("comment")}
      />

      {/* Auth prompt — single instance for all sidebar actions */}
      <InlineAuthPrompt
        isOpen={authPromptIntent !== null}
        intent={authPromptIntent ?? undefined}
        onClose={() => setAuthPromptIntent(null)}
        onAuthenticated={() => {
          // Re-trigger the action the user was attempting? For now
          // we just close the prompt — the user retries. Future
          // version: store the action callback + invoke it here.
          setAuthPromptIntent(null);
        }}
      />

      {/* Manual share sheet — fallback when Web Share API unavailable */}
      {shareSheet && (
        <ShareFallbackSheet
          url={shareUrl}
          title={shareTitle}
          onClose={() => setShareSheet(false)}
        />
      )}
    </>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// ─── Manual share sheet (Web Share fallback for desktop) ─────────────

function ShareFallbackSheet({
  url,
  title,
  onClose,
}: {
  url: string;
  title: string;
  onClose: () => void;
}) {
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore
    }
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[300] flex items-end md:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-3xl bg-[var(--bg-surface)] border border-[var(--gold)]/25 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.7)]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-base font-bold text-white">Partager</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/15"
            aria-label="Fermer"
          >
            <svg className="h-4 w-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <ShareTile label="Copier" onClick={copyLink}>
            <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
          </ShareTile>
          <ShareTile
            label="X"
            color="bg-white/10"
            onClick={() => {
              window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`, "_blank", "noopener,noreferrer");
              onClose();
            }}
          >
            <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </ShareTile>
          <ShareTile
            label="Discord"
            color="bg-[#5865F2]/20 border-[#5865F2]/30"
            onClick={() => {
              navigator.clipboard.writeText(`${title} ${url}`).catch(() => {});
              onClose();
            }}
          >
            <svg className="h-5 w-5 text-[#5865F2]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" />
            </svg>
          </ShareTile>
          <ShareTile
            label="WhatsApp"
            color="bg-[#25D366]/20 border-[#25D366]/30"
            onClick={() => {
              window.open(`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`, "_blank", "noopener,noreferrer");
              onClose();
            }}
          >
            <svg className="h-5 w-5 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          </ShareTile>
        </div>
      </div>
    </div>
  );
}

function ShareTile({
  label,
  onClick,
  children,
  color = "bg-white/10",
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 active:scale-95 transition-transform"
    >
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 ${color}`}
      >
        {children}
      </div>
      <span className="text-[10px] text-white/70">{label}</span>
    </button>
  );
}
