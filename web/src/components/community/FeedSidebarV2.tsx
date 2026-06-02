"use client";

/**
 * FeedSidebarV2 — TikTok-style action rail anchored bottom-right of
 * each feed item.
 *
 * Wave 37 — "BIG cream-gold rail" restyle. Two visual tiers, hextech:
 *
 *     [Avatar]      killer portrait, 56px gold-ring circle, "+suivre"
 *                   badge → deep-links to /player/[slug]
 *     [★ NOTER]     PRIMARY hero — cream→gold→bronze gradient pill that
 *                   opens a 5-star StarRating popover calling rateKill
 *                   (login-gated via InlineAuthPrompt intent="rate").
 *                   This is the real Star slot the old header comment
 *                   referenced but never rendered.
 *     [Like ❤]      SECONDARY — heart toggle, optimistic (LikeButton)
 *     [Comments]    SECONDARY — bubble icon, count, opens CommentSheetV2
 *     [Share]       SECONDARY — Web Share API with sheet fallback
 *     [Bookmark]    SECONDARY — save-to-collection (onBookmark stub)
 *     [Detail]      link to /kill/[id] for full page
 *     [Report]      tertiary, long-press shortcut
 *
 * The sidebar itself owns the InlineAuthPrompt — every action that
 * needs auth raises the prompt with the right `intent` so the copy
 * matches what the user was trying to do.
 *
 * THE MOBILE FEED (<768px) IS SACRED — every base/`md:` className below
 * is preserved byte-for-byte; the BIG cream-gold look is layered ONLY
 * at the `lg:` breakpoint (≥1024 = the wide stage). So the <768 render
 * is identical to the previous rail (48px secondaries, gold star).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Modal } from "@/components/ui/FocusTrapModal";
import { LikeButton } from "./LikeButton";
import { CommentSheetV2 } from "./CommentSheetV2";
import { EmojiReactions } from "@/components/scroll/v2/EmojiReactions";
import { InlineAuthPrompt } from "./InlineAuthPrompt";
import { ReportButton, type ReportButtonController } from "./ReportButton";
import { rateKill } from "./actions";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";
import { championIconUrl } from "@/lib/constants";
import { track } from "@/lib/analytics/track";

// Long-press duration to open the report sheet directly. 500ms is the
// industry-standard threshold (iOS context menus, Android long-press).
// Less feels accidental on horizontal-scroll surfaces, more feels
// unresponsive.
const LONG_PRESS_MS = 500;

// ─── Secondary-tier (cream-gold) shared recipes ──────────────────────
//
// SACRED-MOBILE RULE: the unprefixed + `md:` tokens here are the EXACT
// dark-glass look the rail shipped with, so anything <1024 (incl. the
// <768 mobile feed) renders byte-identical. The cream-gold "BIG button"
// spec is layered ONLY on `lg:` utilities. Rest = cream-wash over a
// black scrim + thin gold border ; hover = full gold border + glow +
// stronger wash (the .gold-glow utility lives in globals.css).
const SECONDARY_TILE =
  "bg-black/55 backdrop-blur-sm border border-white/15 hover:bg-black/75 hover:border-white/25 shadow-[0_4px_18px_rgba(0,0,0,0.5)] " +
  "lg:bg-[var(--cream-wash)] lg:bg-black/35 lg:backdrop-blur-md lg:border-[var(--gold)]/45 lg:shadow-[0_8px_26px_rgba(0,0,0,0.5)] " +
  "lg:hover:bg-[var(--cream-wash-strong)] lg:hover:border-[var(--gold)] lg:hover:shadow-[0_0_20px_rgba(200,170,110,0.15),0_0_60px_rgba(200,170,110,0.05)] motion-safe:lg:hover:scale-[1.04]";

// "On"/active secondary (e.g. bookmark saved) — gold-filled accent.
const SECONDARY_TILE_ON =
  "border bg-[var(--gold)] border-[var(--gold)] shadow-[0_8px_26px_rgba(200,170,110,0.4),0_0_30px_rgba(200,170,110,0.25)] motion-safe:lg:hover:scale-[1.04]";

const SECONDARY_GLYPH = "text-white lg:text-[var(--gold)] transition-colors";

// Count / label sits in the gap — font-data, legible over bright frames
// via a drop-shadow. Mobile keeps its original size; bumps to 13px on lg.
const SECONDARY_LABEL =
  "font-data text-[10px] lg:text-[13px] 2xl:text-sm font-bold tabular-nums text-white/80 lg:text-white/85 [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]";

interface Props {
  killId: string;
  shareTitle: string;
  shareText?: string;
  /** Initial counts from server-render, avoid 0 flash. */
  initialLikeCount?: number;
  initialCommentCount?: number;
  /** Server-rendered rating so the ★ NOTER hero paints the right
   *  active-star count without a flash before rateKill hydrates. */
  initialAvgRating?: number | null;
  initialRatingCount?: number;
  /** Killer identity for the topmost avatar slot. `killerName` doubles
   *  as the /player/[slug] slug (slugs are IGNs). `killerChampion`
   *  drives the Data Dragon fallback portrait when the player isn't in
   *  PLAYER_PHOTOS. All optional — the avatar slot is skipped when we
   *  can't resolve a link target. */
  killerName?: string | null;
  killerPlayerId?: string | null;
  killerChampion?: string | null;
  /** Save-to-collection handler. Wave 37 ships the slot wired to an
   *  optional `onBookmark(killId, next)` stub — the V-next commit
   *  persists to a bookmarks table. When omitted the button is hidden
   *  so older callers don't render a dead control. */
  onBookmark?: (killId: string, next: boolean) => void;
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
  initialAvgRating = null,
  initialRatingCount = 0,
  killerName,
  killerPlayerId,
  killerChampion,
  onBookmark,
  visible,
}: Props) {
  const [authPromptIntent, setAuthPromptIntent] = useState<
    "like" | "comment" | "rate" | "share" | null
  >(null);
  const [showComments, setShowComments] = useState(false);
  const [shareSheet, setShareSheet] = useState(false);
  const [showRating, setShowRating] = useState(false);
  // Bookmark is purely optimistic for now (no server read-back) — the
  // onBookmark prop is a stub until the collections table lands.
  const [bookmarked, setBookmarked] = useState(false);
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

  const handleBookmark = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !bookmarked;
    setBookmarked(next);
    track(next ? "clip.saved" : "clip.unsaved", {
      entityType: "kill",
      entityId: killId,
    });
    onBookmark?.(killId, next);
  };

  // Killer avatar — real LEC portrait for KC players, Data Dragon
  // champion icon as the universal fallback. Slug = IGN (lower-cased
  // by the route's case-insensitive lookup). Only render when we can
  // resolve a link target.
  const playerSlug = killerName?.trim() ?? "";
  const avatarSrc =
    (killerName ? PLAYER_PHOTOS[killerName] : undefined) ??
    (killerChampion ? championIconUrl(killerChampion) : undefined);
  const showAvatar = !!playerSlug && !!avatarSrc;

  return (
    <>
      <div
        className={`absolute right-3 md:right-5 lg:right-7 2xl:right-12 bottom-32 md:bottom-40 lg:bottom-48 2xl:bottom-56 z-20 flex flex-col items-center gap-4 md:gap-5 lg:gap-[22px] 2xl:gap-7 transition-all duration-500 delay-150 ${
          visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-3 pointer-events-none"
        }`}
      >
        {/* Killer avatar — topmost. Hidden <lg so the sacred mobile
            rail is untouched; on the wide stage it anchors the rail
            with the player portrait + a "+suivre" badge → /player. */}
        {showAvatar && (
          <Link
            href={`/player/${encodeURIComponent(playerSlug)}`}
            onClick={(e) => {
              e.stopPropagation();
              track("clip.profile_tap", {
                entityType: "kill",
                entityId: killId,
                metadata: { kind: "player", target: killerPlayerId ?? playerSlug, source: "rail" },
              });
            }}
            aria-label={`Voir le profil de ${playerSlug}`}
            className="group relative hidden lg:flex h-14 w-14 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
          >
            <span className="relative block h-14 w-14 overflow-hidden rounded-full ring-2 ring-[var(--gold)] shadow-[0_8px_24px_rgba(0,0,0,0.55),0_0_24px_rgba(200,170,110,0.25)] transition-transform duration-300 group-hover:scale-[1.06]">
              <Image
                src={avatarSrc}
                alt={playerSlug}
                fill
                sizes="56px"
                className="object-cover object-top"
              />
            </span>
            {/* "+suivre" badge */}
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 flex h-5 min-w-5 items-center justify-center rounded-full border border-[var(--bg-primary)] bg-[var(--gold)] px-1.5 text-[9px] font-data font-bold uppercase tracking-wide text-[var(--bg-primary)] shadow-[0_2px_8px_rgba(0,0,0,0.5)]">
              +suivre
            </span>
          </Link>
        )}

        {/* ★ NOTER — PRIMARY hero. Opens the StarRating popover. Hidden
            <lg (the mobile rail keeps the binary like as the hero); on
            the wide stage it's the cream→gold→bronze gradient CTA. */}
        <RateHeroButton
          active={(initialRatingCount ?? 0) > 0 || (initialAvgRating ?? 0) > 0}
          onOpen={(e) => {
            e.stopPropagation();
            setShowRating(true);
          }}
        />
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
        {/* V16 (Wave 23.1) — emoji reactions palette. Lives between
            Like and Comments so it's discoverable but doesn't compete
            with the primary like CTA. Hidden when the item isn't
            active (visible=false) so off-screen sidebars don't keep
            mounted state. */}
        <EmojiReactions killId={killId} visible={visible} />

        <div className="hidden lg:block">
          <LikeButton
            killId={killId}
            initialCount={initialLikeCount}
            variant="wide"
            onAuthRequired={() => setAuthPromptIntent("like")}
          />
        </div>

        {/* Comments — SECONDARY cream-gold tier on the wide stage. */}
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
          className="group flex flex-col items-center gap-1.5 lg:gap-[5px] select-none"
        >
          <div
            className={`flex h-12 w-12 lg:h-14 lg:w-14 2xl:h-16 2xl:w-16 items-center justify-center rounded-full transition-all active:scale-90 ${SECONDARY_TILE}`}
          >
            <svg
              className={`h-6 w-6 lg:h-7 lg:w-7 2xl:h-8 2xl:w-8 ${SECONDARY_GLYPH}`}
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
          <span className={SECONDARY_LABEL}>{formatCount(initialCommentCount)}</span>
        </button>

        {/* Share — SECONDARY cream-gold tier on the wide stage. */}
        <button
          type="button"
          onClick={handleShare}
          aria-label="Partager"
          className="group flex flex-col items-center gap-1.5 lg:gap-[5px] select-none"
        >
          <div
            className={`flex h-12 w-12 lg:h-14 lg:w-14 2xl:h-16 2xl:w-16 items-center justify-center rounded-full transition-all active:scale-90 ${SECONDARY_TILE}`}
          >
            <svg
              className={`h-5 w-5 lg:h-6 lg:w-6 2xl:h-7 2xl:w-7 ${SECONDARY_GLYPH}`}
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
          <span className={SECONDARY_LABEL}>Partager</span>
        </button>

        {/* Bookmark — SECONDARY save-to-collection. Hidden <lg (the
            mobile rail's save lives in the long-press menu) and only
            rendered when the caller wires onBookmark. "On" state tints
            gold-filled per the active-accent spec. */}
        {onBookmark && (
          <button
            type="button"
            onClick={handleBookmark}
            aria-pressed={bookmarked}
            aria-label={bookmarked ? "Retirer des favoris" : "Enregistrer"}
            className="group hidden lg:flex flex-col items-center gap-[5px] select-none"
          >
            <span
              className={`flex h-14 w-14 2xl:h-16 2xl:w-16 items-center justify-center rounded-full transition-all active:scale-90 ${
                bookmarked ? SECONDARY_TILE_ON : SECONDARY_TILE
              }`}
            >
              <svg
                className={`h-7 w-7 2xl:h-8 2xl:w-8 ${bookmarked ? "text-[var(--bg-primary)]" : SECONDARY_GLYPH}`}
                viewBox="0 0 24 24"
                fill={bookmarked ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={bookmarked ? 0 : 2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                />
              </svg>
            </span>
            <span className={SECONDARY_LABEL}>{bookmarked ? "Gardé" : "Garder"}</span>
          </button>
        )}

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

      {/* ★ NOTER popover — the real StarRating slot. Calls rateKill;
          a 401 closes the popover and raises the auth prompt with
          intent="rate" so the copy matches. */}
      <StarRatingPopover
        killId={killId}
        isOpen={showRating}
        initialScore={Math.round(initialAvgRating ?? 0)}
        onClose={() => setShowRating(false)}
        onAuthRequired={() => {
          setShowRating(false);
          setAuthPromptIntent("rate");
        }}
      />

      {/* Auth prompt — single instance for all sidebar actions */}
      <InlineAuthPrompt
        isOpen={authPromptIntent !== null}
        intent={authPromptIntent ?? undefined}
        onClose={() => setAuthPromptIntent(null)}
        onAuthenticated={() => {
          // Re-open the action the user was attempting once they're in.
          // Today only the rating flow can resume cleanly (its UI is
          // self-contained); the others just close the prompt.
          const intent = authPromptIntent;
          setAuthPromptIntent(null);
          if (intent === "rate") setShowRating(true);
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

// ─── ★ NOTER — PRIMARY hero button ───────────────────────────────────
//
// Reuses the SpinButton recipe from VSRoulette: cream→gold→bronze
// gradient, layered hextech shadow, inner white-sweep on group-hover
// (vs-sweep keyframe). Hidden <lg so the sacred mobile rail keeps the
// binary heart as its hero — the precision star is a wide-stage affordance.
function RateHeroButton({
  active,
  onOpen,
}: {
  active: boolean;
  onOpen: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={active ? "Modifier ta note" : "Noter ce kill"}
      className="group relative hidden lg:flex flex-col items-center gap-[5px] select-none focus-visible:outline-none"
    >
      <span
        className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full transition-transform duration-200 group-hover:scale-[1.04] group-focus-visible:ring-2 group-focus-visible:ring-[var(--gold)] group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-[var(--bg-primary)] motion-safe:group-active:scale-[0.92]"
        style={{
          color: "var(--bg-primary)",
          background:
            "linear-gradient(135deg, #F0E6D2 0%, #C8AA6E 40%, #785A28 100%)",
          boxShadow:
            "0 12px 30px rgba(200,170,110,0.4), 0 0 50px rgba(0,87,255,0.20), inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -2px 0 rgba(0,0,0,0.3)",
        }}
      >
        {/* Inner white sweep — reuses the vs-sweep keyframe (VSRoulette). */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full overflow-hidden pointer-events-none"
        >
          <span
            className="absolute inset-y-0 -inset-x-8 motion-safe:group-hover:animate-[vs-sweep_1s_ease-in-out_infinite]"
            style={{
              background:
                "linear-gradient(110deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)",
              opacity: 0.45,
              transform: "translateX(-110%)",
            }}
          />
        </span>
        {/* Star glyph — filled when the kill is already rated. */}
        <svg
          className="relative h-8 w-8"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 2.5l2.81 6.06 6.69.62-5.05 4.44 1.49 6.56L12 17.27l-5.94 3.41 1.49-6.56-5.05-4.44 6.69-.62L12 2.5z" />
        </svg>
      </span>
      <span className="font-data text-[13px] 2xl:text-sm font-black uppercase tracking-[0.18em] text-[var(--gold-bright)] [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]">
        Noter
      </span>
      <style jsx>{`
        @keyframes vs-sweep {
          0% {
            transform: translateX(-110%);
          }
          100% {
            transform: translateX(110%);
          }
        }
      `}</style>
    </button>
  );
}

// ─── StarRating popover (rateKill) ───────────────────────────────────
//
// 1-5 star grader. Optimistic: the chosen score paints instantly, then
// rateKill persists it. On a 401 we bubble onAuthRequired so the parent
// raises the InlineAuthPrompt (intent="rate"). Score 0 = clear (handled
// by rateKill's delete path) — tapping the already-selected star toggles
// the rating off.
function StarRatingPopover({
  killId,
  isOpen,
  initialScore,
  onClose,
  onAuthRequired,
}: {
  killId: string;
  isOpen: boolean;
  initialScore: number;
  onClose: () => void;
  onAuthRequired: () => void;
}) {
  const [score, setScore] = useState(initialScore);
  const [hover, setHover] = useState(0);
  const [pending, setPending] = useState(false);

  // Re-sync when re-opened against a different kill / server value.
  useEffect(() => {
    if (isOpen) setScore(initialScore);
  }, [isOpen, initialScore]);

  const submit = async (value: number) => {
    // Toggle off when re-tapping the current score.
    const next = value === score ? 0 : value;
    setScore(next);
    setPending(true);
    try {
      const res = await rateKill(killId, next);
      if (!res.ok) {
        if (res.authRequired) onAuthRequired();
        return;
      }
      // Success — close after a beat so the user sees the confirmed state.
      window.setTimeout(() => onClose(), 320);
    } catch {
      /* network — leave the popover open, the user can retry */
    } finally {
      setPending(false);
    }
  };

  const display = hover || score;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      label="Noter ce kill"
      showCloseButton={false}
      zIndexClassName="z-[350]"
      overlayClassName="items-end justify-center p-4 md:items-center"
      scrimClassName="bg-black/60 backdrop-blur-sm"
      panelClassName="w-full max-w-xs rounded-3xl border border-[var(--gold)]/30 bg-[var(--bg-surface)] p-6 text-center shadow-[0_40px_120px_rgba(0,0,0,0.7)]"
    >
      <h3 className="font-display text-lg font-black text-[var(--gold-bright)]">
        Note ce kill
      </h3>
      <p className="mt-1 mb-5 text-xs text-white/55">
        De routine à exceptionnel — ta note alimente le feed.
      </p>
      <div
        className="star-rating flex items-center justify-center gap-2"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= display;
          return (
            <button
              key={n}
              type="button"
              disabled={pending}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(0)}
              onClick={() => void submit(n)}
              aria-label={`${n} étoile${n > 1 ? "s" : ""}`}
              aria-pressed={n <= score}
              className="star flex h-12 w-12 items-center justify-center rounded-full bg-black/30 transition-colors hover:bg-black/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:opacity-70"
            >
              <svg
                className={`h-7 w-7 transition-colors ${filled ? "text-[var(--gold)]" : "text-[var(--text-disabled)]"}`}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2.5l2.81 6.06 6.69.62-5.05 4.44 1.49 6.56L12 17.27l-5.94 3.41 1.49-6.56-5.05-4.44 6.69-.62L12 2.5z" />
              </svg>
            </button>
          );
        })}
      </div>
      {score > 0 && (
        <p className="mt-4 font-data text-xs text-white/60">
          Ta note : <span className="font-bold text-[var(--gold)]">{score}/5</span>
        </p>
      )}
    </Modal>
  );
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
