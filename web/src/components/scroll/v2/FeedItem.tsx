"use client";

/**
 * FeedItem — UI shell of a single feed entry. NO <video> element.
 *
 * In the v2 architecture, video playback lives in a 5-slot pool
 * (FeedPlayerPool) that floats above the feed and follows the active
 * item via translate3d. The <video> elements never re-mount.
 *
 * What this component renders:
 *   - The poster placeholder (thumbnail) — visible while the pool's
 *     video for this item is loading or hasn't been allocated yet.
 *     The pool video sits on TOP of this when allocated.
 *   - All overlays: gradient, badges (KC kill / multi / FB), AI desc,
 *     player tag, match meta.
 *   - Action sidebar (rate / chat / share) — wired to parent state.
 *   - Tap-to-pause flash glyph.
 *
 * The wrapper's height is exactly itemHeight (full viewport) so the
 * snap calculations in the parent line up perfectly with the pool's
 * translate3d offsets.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { VideoFeedItem, MomentFeedItem } from "@/components/scroll/ScrollFeed";
import { isDescriptionClean } from "@/lib/scroll/sanitize-description";
import { useImpressionTracker } from "./hooks/useImpressionTracker";
import { useFeedItemError } from "./hooks/useFeedItemError";
import { useSwipeShare } from "./hooks/useSwipeShare";
import { Description } from "@/components/i18n/Description";
import { FeedSidebarV2 } from "@/components/community/FeedSidebarV2";
import { DoubleTapHeart } from "@/components/community/DoubleTapHeart";
import { FeedItemError } from "./FeedItemError";
import { track } from "@/lib/analytics/track";

interface SharedFeedItemProps {
  index: number;
  total: number;
  itemHeight: number;
  /** Is this item currently the live, playing item? Drives overlay
   *  fade-in via the .is-active class so it pops only when relevant. */
  isActive: boolean;
}

/** Tiny 1x2 dark gradient base64 used as `blurDataURL` placeholder
 *  on every Image. Renders as a soft dark blur until the real
 *  thumbnail decodes — no flash of empty white frame. */
const BLUR_PLACEHOLDER =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAACAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpgD//Z";

/**
 * Per-item analytics hook.
 *
 * Fires :
 *   - `clip.viewed`    when the item becomes active (one event per
 *                      isActive transition, deduped per item id).
 *   - `clip.started`   when the pool's video for this item dispatches
 *                      `kc:clip-played`.
 *   - `clip.completed` when the pool dispatches `kc:clip-ended` AND the
 *                      reported duration is above THRESHOLD seconds.
 *                      We only count "real" completes — a 0.5s loop on
 *                      a broken source shouldn't count as engagement.
 *
 * Per-mount dedup so swipe-back-and-forth doesn't multi-count.
 */
const COMPLETE_DURATION_THRESHOLD_S = 3;

function useFeedItemAnalytics({
  itemId,
  isActive,
}: {
  itemId: string;
  isActive: boolean;
}) {
  const viewedRef = useRef(false);
  // V1 (Wave 21.1) — dwell tracking. When the item becomes active we
  // stamp a start timestamp ; when it becomes inactive (user swiped
  // away or unmounted) we emit `clip.dwell` with the wall-clock dwell
  // duration. The recommendation engine consumes this to weight
  // anchors by engagement strength.
  const dwellStartRef = useRef<number | null>(null);
  const clipDurationSecRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) return;
    if (!viewedRef.current) {
      viewedRef.current = true;
      track("clip.viewed", { entityType: "kill", entityId: itemId });
    }
    // Mark the dwell-start moment.
    dwellStartRef.current = performance.now();
    return () => {
      // Item became inactive (or unmounted while active). Emit dwell.
      const startedAt = dwellStartRef.current;
      dwellStartRef.current = null;
      if (startedAt == null) return;
      const dwellMs = Math.round(performance.now() - startedAt);
      // Sub-100ms dwell almost always = a fast scroll-past, not real
      // engagement. Drop the noise so the analytics dashboard isn't
      // dominated by "user flicked through 30 items in 3 s".
      if (dwellMs < 100) return;
      const clipS = clipDurationSecRef.current ?? null;
      const dwellFraction =
        clipS != null && clipS > 0
          ? Math.min(1, dwellMs / 1000 / clipS)
          : null;
      track("clip.dwell", {
        entityType: "kill",
        entityId: itemId,
        metadata: {
          dwell_ms: dwellMs,
          clip_duration_s: clipS,
          dwell_fraction: dwellFraction,
        },
      });
    };
  }, [itemId, isActive]);

  useEffect(() => {
    if (!isActive) return;
    const onPlay = (ev: Event) => {
      const detail = (ev as CustomEvent<{ itemId?: string; durationSec?: number }>).detail;
      if (detail?.itemId !== itemId) return;
      // Capture clip duration if the dispatcher provided it — used by
      // the dwell-fraction calculation in the cleanup above.
      if (typeof detail?.durationSec === "number" && detail.durationSec > 0) {
        clipDurationSecRef.current = detail.durationSec;
      }
      track("clip.started", { entityType: "kill", entityId: itemId });
    };
    const onEnded = (ev: Event) => {
      const detail = (ev as CustomEvent<{ itemId?: string; duration?: number }>).detail;
      if (detail?.itemId !== itemId) return;
      const duration = detail?.duration ?? 0;
      if (duration < COMPLETE_DURATION_THRESHOLD_S) return;
      track("clip.completed", {
        entityType: "kill",
        entityId: itemId,
        metadata: { duration_s: duration },
      });
    };
    window.addEventListener("kc:clip-played", onPlay as EventListener);
    window.addEventListener("kc:clip-ended", onEnded as EventListener);
    return () => {
      window.removeEventListener("kc:clip-played", onPlay as EventListener);
      window.removeEventListener("kc:clip-ended", onEnded as EventListener);
    };
  }, [itemId, isActive]);
}

// ─── Video item (single-kill clip from kills table) ────────────────────

interface FeedItemVideoProps extends SharedFeedItemProps {
  item: VideoFeedItem;
  /** Wave 6 — fired by FeedItemError's auto-skip + the swipe-left
   *  share gesture's "no neighbour to advance" fallback. Parent should
   *  call `jumpTo(activeIndex + 1)`. Optional: when omitted the auto-skip
   *  path silently no-ops. */
  onAutoSkipNext?: () => void;
}

export function FeedItemVideo({
  item,
  index,
  total,
  itemHeight,
  isActive,
  onAutoSkipNext,
}: FeedItemVideoProps) {
  const isKcKill = item.kcInvolvement === "team_killer";
  // Fire impression beacon after 1.5s of dwell (real engagement signal,
  // filters out flick-pasts).
  useImpressionTracker({ killId: item.id, isActive });
  useFeedItemAnalytics({ itemId: item.id, isActive });
  const errState = useFeedItemError(item.id);
  const [shareToast, setShareToast] = useState<string | null>(null);

  const triggerShare = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/scroll?kill=${item.id}`;
    const shareTitle = `${item.killerChampion} → ${item.victimChampion}`;
    const shareText = item.aiDescription ?? undefined;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: shareTitle, url, ...(shareText ? { text: shareText } : {}) });
        track("clip.shared", {
          entityType: "kill",
          entityId: item.id,
          metadata: { channel: "native", source: "swipe_left" },
        });
        return;
      }
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "AbortError") {
        track("clip.shared", {
          entityType: "kill",
          entityId: item.id,
          metadata: { channel: "cancelled", source: "swipe_left" },
        });
        return;
      }
      // Real failure — fall through to clipboard
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareToast("Lien copié !");
      window.setTimeout(() => setShareToast(null), 2000);
      track("clip.shared", {
        entityType: "kill",
        entityId: item.id,
        metadata: { channel: "clipboard", source: "swipe_left" },
      });
    } catch {
      setShareToast("Copie impossible");
      window.setTimeout(() => setShareToast(null), 2000);
    }
  }, [item.id, item.killerChampion, item.victimChampion, item.aiDescription]);

  // Wave 6 — left-swipe to share. Only enabled on the active item so
  // pool slot neighbours can't accidentally fire. The bind() spreader
  // attaches to the central video area below the badges/sidebar.
  const swipeBind = useSwipeShare({
    enabled: isActive,
    onSwipeLeft: () => void triggerShare(),
  });

  // Wave 6 — Enter on focused FeedItem = like, Cmd/Ctrl+Shift+S = share.
  // Mounted only on the active item so the keystrokes resolve to the
  // visible kill (not whatever is in the pool's pre-roll).
  useEffect(() => {
    if (!isActive || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      // Don't hijack input typing.
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void triggerShare();
        return;
      }
      // Enter to like — only fires when the FeedItem itself (or a
      // child without its own Enter handler) is focused. Buttons that
      // already have native Enter→click semantics (LikeButton, etc.)
      // get the event before us via stopPropagation in their handlers.
      if (e.key === "Enter") {
        const isInteractiveTarget =
          target?.closest("button, a, input, textarea, [role='button']");
        if (isInteractiveTarget) return;
        e.preventDefault();
        try {
          window.dispatchEvent(
            new CustomEvent("kc:double-tap-like", { detail: { killId: item.id } }),
          );
          track("clip.liked", {
            entityType: "kill",
            entityId: item.id,
            metadata: { source: "keyboard_enter" },
          });
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, item.id, triggerShare]);

  // ─── Error state — replace the entire card with FeedItemError ─────
  if (errState.errorCode) {
    return (
      <FeedItemError
        key={`err-${item.id}-${errState.retryKey}`}
        killId={item.id}
        itemHeight={itemHeight}
        errorCode={errState.errorCode}
        isActive={isActive}
        onRetry={errState.retry}
        onAutoSkip={onAutoSkipNext}
      />
    );
  }

  return (
    <div
      data-feed-item
      data-feed-index={index}
      data-feed-id={item.id}
      style={{ height: `${itemHeight}px` }}
      className="relative w-full overflow-hidden bg-black"
    >
      {/* Poster — visible until the pool's video paints over it. We
          intentionally use Image (Next optimised) for the poster only;
          the actual video frame is painted by the pool's <video> element
          on z-index above. */}
      {item.thumbnail && (
        <Image
          src={item.thumbnail}
          alt={`${item.killerChampion} → ${item.victimChampion}`}
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          // priority=true for the active item only — others lazy-load.
          priority={isActive}
          placeholder="blur"
          blurDataURL={BLUR_PLACEHOLDER}
          className="object-cover"
          // The pool video sits at z-index 0; this poster at z-index 0
          // too but in a lower DOM order — the video paints OVER once
          // it has data. When the slot has no video bound (out of range)
          // the poster stays.
        />
      )}

      {/* Bottom + top gradient — same as v1 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 55%)," +
            "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 18%)",
        }}
      />

      {/* Top-right index pill */}
      <Link
        href={`/kill/${item.id}`}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-28 left-4 z-20 rounded-full bg-black/40 backdrop-blur-sm px-3 py-1 text-[10px] font-data text-[var(--text-muted)] hover:bg-black/60 transition-colors"
      >
        #{index + 1} / {total}
      </Link>

      {/* Wave 6 — left-swipe-to-share gesture surface. Sits BEHIND the
          DoubleTapHeart layer (z-[4] vs z-[5]) so single/double-taps
          still reach the heart logic. The drag detector fires only on
          horizontal release past 80px in <300ms — vertical scroll
          bubbles to the parent's useFeedGesture. */}
      {isActive && (
        <div
          {...swipeBind()}
          aria-hidden
          className="absolute inset-0 z-[4]"
          style={{ touchAction: "pan-y" }}
        />
      )}

      {/* DoubleTapHeart — TikTok signature gesture. Double-tap on the
          video → fire a like via the LikeButton's mechanism (custom
          event consumed by LikeButton). Single-tap is forwarded to the
          existing tap-to-pause if any.
          Wave 6 — also fires the clip.liked analytic with source.  */}
      {isActive && (
        <DoubleTapHeart
          onDoubleTap={() => {
            try {
              window.dispatchEvent(
                new CustomEvent("kc:double-tap-like", {
                  detail: { killId: item.id },
                }),
              );
              track("clip.liked", {
                entityType: "kill",
                entityId: item.id,
                metadata: { source: "double_tap" },
              });
            } catch {
              /* CustomEvent unsupported in some sandboxes */
            }
          }}
        />
      )}

      {/* TikTok-grade right action rail: like + comments + share + detail.
          Owns the InlineAuthPrompt — every action surfaces it on 401. */}
      <FeedSidebarV2
        killId={item.id}
        shareTitle={`${item.killerChampion} kills ${item.victimChampion}`}
        shareText={item.aiDescription ?? undefined}
        initialLikeCount={item.ratingCount ?? 0}
        initialCommentCount={item.commentCount ?? 0}
        visible={isActive}
      />

      {/* Wave 6 — share toast (fired from swipe-left + Cmd+Shift+S
          keyboard fallback when navigator.share is missing). */}
      {shareToast && (
        <div
          role="status"
          className="pointer-events-none fixed top-20 left-1/2 -translate-x-1/2 z-[200] rounded-full bg-black/85 backdrop-blur-sm px-4 py-2 text-xs font-bold text-[var(--gold)] shadow-lg"
        >
          {shareToast}
        </div>
      )}

      {/* Bottom overlay — STATE OF THE ART revamp.
          - Reserves right-side gutter for the FeedSidebarV2 (mobile 64px, desktop 96px)
          - Player names visible in addition to champions
          - Matchup poster style: "[KC PLAYER] sur [CHAMPION] → [OPP] sur [CHAMP]"
          - Badges chips with stronger contrast
          - AI description italic with subtle gradient fade if too long
          - Match meta line at the very bottom, monospaced, muted
          - Active item: full opacity, slight slide-up animation */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 pl-4 md:pl-7 lg:pl-10 pointer-events-none transition-all duration-500 ${
          isActive ? "opacity-100 translate-y-0" : "opacity-85 translate-y-1"
        }`}
        style={{
          paddingBottom: "max(2rem, env(safe-area-inset-bottom, 2rem))",
          // Reserve right-side gutter for the action sidebar so text doesn't
          // get covered by the like/comment/share buttons.
          paddingRight: "calc(72px + env(safe-area-inset-right, 0px))",
        }}
      >
        <div className="space-y-2.5 md:space-y-3 max-w-2xl">
          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
            <span
              className={`rounded-md px-2.5 py-1 text-[10px] md:text-[11px] font-black uppercase tracking-[0.15em] backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.5)] ${
                isKcKill
                  ? "bg-[var(--gold)]/25 border border-[var(--gold)]/55 text-[var(--gold)]"
                  : "bg-[var(--red)]/25 border border-[var(--red)]/55 text-[var(--red)]"
              }`}
            >
              {isKcKill ? "● KC kill" : "○ KC death"}
            </span>
            {item.isFirstBlood && (
              <span className="rounded-md bg-[var(--red)]/25 border border-[var(--red)]/55 backdrop-blur-sm px-2.5 py-1 text-[10px] md:text-[11px] font-black text-[var(--red)] uppercase tracking-[0.15em] shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
                ⚡ First blood
              </span>
            )}
            {item.multiKill && (
              <span className="rounded-md bg-[var(--orange)]/25 border border-[var(--orange)]/55 backdrop-blur-sm px-2.5 py-1 text-[10px] md:text-[11px] font-black text-[var(--orange)] uppercase tracking-wider shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
                ✦ {item.multiKill}
              </span>
            )}
            {item.highlightScore != null && (
              <span className="rounded-md bg-black/55 border border-[var(--gold)]/35 backdrop-blur-sm px-2 py-1 text-[10px] md:text-[11px] font-data font-bold text-[var(--gold)]">
                ★ {item.highlightScore.toFixed(1)}/10
              </span>
            )}
          </div>

          {/* Player line — small, ALL-CAPS data font, HIGH contrast.
              V12 (Wave 21.2) — killer name now tappable when we have
              the killerPlayerId, deep-linking the scroll feed filtered
              by that player. Re-uses the existing `?player=<id>` URL
              state contract so chip-bar + scroll-restore both work. */}
          {(item.killerName || item.victimName) && (
            <p className="font-data text-[11px] md:text-[12px] uppercase tracking-[0.2em] text-white/70 drop-shadow-md pointer-events-auto">
              {item.killerName ? (
                item.killerPlayerId ? (
                  <Link
                    href={`/scroll?player=${item.killerPlayerId}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      track("clip.profile_tap", {
                        entityType: "kill",
                        entityId: item.id,
                        metadata: {
                          kind: "player",
                          target: item.killerPlayerId ?? "",
                          source: "feed",
                        },
                      });
                    }}
                    className={
                      "underline-offset-4 decoration-transparent hover:decoration-current transition-colors " +
                      (isKcKill
                        ? "text-[var(--gold)] font-bold hover:text-[var(--gold-bright)]"
                        : "text-white/85 hover:text-white")
                    }
                  >
                    {item.killerName}
                  </Link>
                ) : (
                  <span
                    className={
                      isKcKill ? "text-[var(--gold)] font-bold" : "text-white/85"
                    }
                  >
                    {item.killerName}
                  </span>
                )
              ) : (
                <span className="text-white/55">?</span>
              )}
              <span className="text-white/35 mx-2">vs</span>
              {item.victimName ? (
                <span className={!isKcKill ? "text-[var(--gold)] font-bold" : "text-white/65"}>
                  {item.victimName}
                </span>
              ) : (
                <span className="text-white/45">?</span>
              )}
            </p>
          )}

          {/* Matchup — the headliner, big display font.
              V13 (Wave 21.2) — both champions are now tappable, deep-
              linking to /champion/<name>. Stops gesture bubbling so a
              tap on the champion doesn't accidentally pause the video. */}
          <p className="font-display text-2xl md:text-4xl lg:text-5xl font-black leading-[1.05] text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.85)] pointer-events-auto">
            <Link
              href={`/champion/${encodeURIComponent(item.killerChampion)}`}
              onClick={(e) => {
                e.stopPropagation();
                track("clip.profile_tap", {
                  entityType: "kill",
                  entityId: item.id,
                  metadata: {
                    kind: "champion",
                    target: item.killerChampion,
                    source: "feed",
                  },
                });
              }}
              className={
                "underline-offset-4 decoration-transparent hover:decoration-current transition-colors " +
                (isKcKill ? "text-[var(--gold)]" : "text-white")
              }
            >
              {item.killerChampion}
            </Link>
            <span className="text-[var(--gold)]/80 mx-2 md:mx-3 text-[0.85em] align-middle">→</span>
            <Link
              href={`/champion/${encodeURIComponent(item.victimChampion)}`}
              onClick={(e) => {
                e.stopPropagation();
                track("clip.profile_tap", {
                  entityType: "kill",
                  entityId: item.id,
                  metadata: {
                    kind: "champion",
                    target: item.victimChampion,
                    source: "feed",
                  },
                });
              }}
              className={
                "underline-offset-4 decoration-transparent hover:decoration-current transition-colors " +
                (!isKcKill ? "text-[var(--gold)]" : "text-white/80")
              }
            >
              {item.victimChampion}
            </Link>
          </p>

          {/* AI description — language-aware via <Description>.
              The picker chooses ai_description_<lang> from the active
              LangProvider, falling back to FR → legacy field. We still
              gate visibility through isDescriptionClean(item.aiDescription)
              because the moderation/cleanliness pass runs on the legacy
              field — if that one was rejected, the localized variants
              shouldn't show either. */}
          {isDescriptionClean(item.aiDescription) && (
            <Description
              kill={{
                ai_description: item.aiDescription,
                ai_description_fr: item.aiDescriptionFr,
                ai_description_en: item.aiDescriptionEn,
                ai_description_ko: item.aiDescriptionKo,
                ai_description_es: item.aiDescriptionEs,
              }}
              as="p"
              quoted
              className="text-[13px] md:text-[15px] lg:text-base text-white/90 italic leading-relaxed line-clamp-3 md:line-clamp-4 drop-shadow-md"
            />
          )}

          {/* V14 (Wave 21.2) — AI-tag chip row. Each tag deep-links into
              /scroll?tag=<tag> (the page-level handler treats unknown
              `tag` query as a chip-style filter). Limited to top 4 tags
              to avoid sidebar collisions. */}
          {item.aiTags && item.aiTags.length > 0 && (
            <ul className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
              {item.aiTags.slice(0, 4).map((tag) => (
                <li key={tag}>
                  <Link
                    href={`/scroll?tag=${encodeURIComponent(tag)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      track("clip.tag_clicked", {
                        entityType: "kill",
                        entityId: item.id,
                        metadata: { tag },
                      });
                    }}
                    className="inline-flex items-center rounded-full border border-white/20 bg-black/35 backdrop-blur-sm px-2 py-0.5 text-[10px] font-data tracking-widest text-white/75 hover:border-[var(--gold)]/55 hover:text-[var(--gold)] hover:bg-black/55 transition-colors"
                  >
                    #{tag.replace(/_/g, " ")}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* Match meta — small line at the bottom */}
          <p className="font-data text-[10px] md:text-[11px] uppercase tracking-[0.2em] text-white/55">
            {item.opponentCode ? `vs ${item.opponentCode}` : item.matchStage}
            {item.gameNumber ? ` · G${item.gameNumber}` : ""}
            {item.matchScore ? ` · ${item.matchScore}` : ""}
            {item.kcWon != null ? (
              <span className={`ml-2 font-bold ${item.kcWon ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                {item.kcWon ? "W" : "L"}
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Moment item (grouped fight from moments table) ────────────────────

const MOMENT_LABEL: Record<string, string> = {
  solo_kill: "SOLO KILL",
  skirmish: "SKIRMISH",
  teamfight: "TEAMFIGHT",
  ace: "ACE",
  objective_fight: "OBJECTIF",
};

interface FeedItemMomentProps extends SharedFeedItemProps {
  item: MomentFeedItem;
  /** Wave 6 — see FeedItemVideoProps.onAutoSkipNext. */
  onAutoSkipNext?: () => void;
}

export function FeedItemMoment({
  item,
  index,
  total,
  itemHeight,
  isActive,
  onAutoSkipNext,
}: FeedItemMomentProps) {
  const isKc = item.kcInvolvement === "kc_aggressor" || item.kcInvolvement === "kc_both";
  const label = MOMENT_LABEL[item.classification] ?? item.classification;
  useImpressionTracker({ killId: item.id, isActive });
  useFeedItemAnalytics({ itemId: item.id, isActive });
  const errState = useFeedItemError(item.id);
  const [shareToast, setShareToast] = useState<string | null>(null);

  const triggerShare = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/scroll?kill=${item.id}`;
    const shareTitle = `${label} · ${item.killCount} kills`;
    const shareText = item.aiDescription ?? undefined;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: shareTitle, url, ...(shareText ? { text: shareText } : {}) });
        track("clip.shared", {
          entityType: "kill",
          entityId: item.id,
          metadata: { channel: "native", source: "swipe_left" },
        });
        return;
      }
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "AbortError") {
        track("clip.shared", {
          entityType: "kill",
          entityId: item.id,
          metadata: { channel: "cancelled", source: "swipe_left" },
        });
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareToast("Lien copié !");
      window.setTimeout(() => setShareToast(null), 2000);
      track("clip.shared", {
        entityType: "kill",
        entityId: item.id,
        metadata: { channel: "clipboard", source: "swipe_left" },
      });
    } catch {
      setShareToast("Copie impossible");
      window.setTimeout(() => setShareToast(null), 2000);
    }
  }, [item.id, label, item.killCount, item.aiDescription]);

  const swipeBind = useSwipeShare({
    enabled: isActive,
    onSwipeLeft: () => void triggerShare(),
  });

  // Keyboard equivalents (Enter = like, Cmd/Ctrl+Shift+S = share). Mirrors
  // the FeedItemVideo handler — we duplicate rather than hoist because
  // the trigger logic uses item-specific share text.
  useEffect(() => {
    if (!isActive || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void triggerShare();
        return;
      }
      if (e.key === "Enter") {
        const isInteractiveTarget =
          target?.closest("button, a, input, textarea, [role='button']");
        if (isInteractiveTarget) return;
        e.preventDefault();
        try {
          window.dispatchEvent(
            new CustomEvent("kc:double-tap-like", { detail: { killId: item.id } }),
          );
          track("clip.liked", {
            entityType: "kill",
            entityId: item.id,
            metadata: { source: "keyboard_enter" },
          });
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, item.id, triggerShare]);

  if (errState.errorCode) {
    return (
      <FeedItemError
        key={`err-${item.id}-${errState.retryKey}`}
        killId={item.id}
        itemHeight={itemHeight}
        errorCode={errState.errorCode}
        isActive={isActive}
        onRetry={errState.retry}
        onAutoSkip={onAutoSkipNext}
      />
    );
  }

  return (
    <div
      data-feed-item
      data-feed-index={index}
      data-feed-id={item.id}
      style={{ height: `${itemHeight}px` }}
      className="relative w-full overflow-hidden bg-black"
    >
      {item.thumbnail && (
        <Image
          src={item.thumbnail}
          alt={label}
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          priority={isActive}
          placeholder="blur"
          blurDataURL={BLUR_PLACEHOLDER}
          className="object-cover"
        />
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 55%)," +
            "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 18%)",
        }}
      />
      <Link
        href={`/moment/${item.id}`}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-28 left-4 z-20 rounded-full bg-black/40 backdrop-blur-sm px-3 py-1 text-[10px] font-data text-[var(--text-muted)] hover:bg-black/60 transition-colors"
      >
        #{index + 1} / {total}
      </Link>

      {/* Wave 6 — left-swipe-to-share gesture surface (see FeedItemVideo). */}
      {isActive && (
        <div
          {...swipeBind()}
          aria-hidden
          className="absolute inset-0 z-[4]"
          style={{ touchAction: "pan-y" }}
        />
      )}

      {isActive && (
        <DoubleTapHeart
          onDoubleTap={() => {
            try {
              window.dispatchEvent(
                new CustomEvent("kc:double-tap-like", {
                  detail: { killId: item.id },
                }),
              );
              track("clip.liked", {
                entityType: "kill",
                entityId: item.id,
                metadata: { source: "double_tap" },
              });
            } catch {
              /* ignore */
            }
          }}
        />
      )}

      {/* TikTok-grade right action rail (same component as video items) */}
      <FeedSidebarV2
        killId={item.id}
        shareTitle={`${label} · ${item.killCount} kills`}
        shareText={item.aiDescription ?? undefined}
        initialLikeCount={item.ratingCount ?? 0}
        initialCommentCount={item.commentCount ?? 0}
        visible={isActive}
      />

      {/* Wave 6 — share toast */}
      {shareToast && (
        <div
          role="status"
          className="pointer-events-none fixed top-20 left-1/2 -translate-x-1/2 z-[200] rounded-full bg-black/85 backdrop-blur-sm px-4 py-2 text-xs font-bold text-[var(--gold)] shadow-lg"
        >
          {shareToast}
        </div>
      )}

      <div
        className={`absolute inset-x-0 bottom-0 z-10 pl-4 md:pl-7 lg:pl-10 pointer-events-none transition-all duration-500 ${
          isActive ? "opacity-100 translate-y-0" : "opacity-85 translate-y-1"
        }`}
        style={{
          paddingBottom: "max(2rem, env(safe-area-inset-bottom, 2rem))",
          paddingRight: "calc(72px + env(safe-area-inset-right, 0px))",
        }}
      >
        <div className="space-y-2.5 md:space-y-3 max-w-2xl">
          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
            <span
              className={`rounded-md px-2.5 py-1 text-[10px] md:text-[11px] font-black uppercase tracking-[0.18em] backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.5)] ${
                isKc
                  ? "bg-[var(--gold)]/25 border border-[var(--gold)]/55 text-[var(--gold)]"
                  : "bg-[var(--red)]/25 border border-[var(--red)]/55 text-[var(--red)]"
              }`}
            >
              {label}
            </span>
            <span className="rounded-md bg-black/55 border border-white/20 backdrop-blur-sm px-2 py-1 text-[10px] md:text-[11px] font-data font-bold text-white/85">
              {item.killCount} kills
            </span>
            {item.momentScore != null && (
              <span className="rounded-md bg-black/55 border border-[var(--gold)]/35 backdrop-blur-sm px-2 py-1 text-[10px] md:text-[11px] font-data font-bold text-[var(--gold)]">
                ★ {item.momentScore.toFixed(1)}/10
              </span>
            )}
          </div>
          <p className="font-display text-2xl md:text-3xl lg:text-4xl font-black text-white leading-tight drop-shadow-[0_4px_24px_rgba(0,0,0,0.85)]">
            {item.blueKills}
            <span className="text-[var(--gold)]/80 mx-2">·</span>
            {item.redKills}
          </p>
          {isDescriptionClean(item.aiDescription) && (
            <Description
              kill={{
                ai_description: item.aiDescription,
                ai_description_fr: item.aiDescriptionFr,
                ai_description_en: item.aiDescriptionEn,
                ai_description_ko: item.aiDescriptionKo,
                ai_description_es: item.aiDescriptionEs,
              }}
              as="p"
              quoted
              className="text-[13px] md:text-[15px] lg:text-base text-white/90 italic leading-relaxed line-clamp-3 md:line-clamp-4 drop-shadow-md"
            />
          )}
          <p className="font-data text-[10px] md:text-[11px] uppercase tracking-[0.2em] text-white/55">
            {item.kcInvolvement === "kc_aggressor"
              ? "KC dominant"
              : item.kcInvolvement === "kc_victim"
              ? "KC subit"
              : "Mixte"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Share button (Fab in top-right corner) ────────────────────────────

/**
 * Share a single kill from the /scroll feed.
 *
 * - navigator.share (mobile native sheet) if available
 * - navigator.clipboard fallback with a brief confirm toast
 *
 * The URL is /scroll?kill=<id> so when shared, the recipient lands on
 * the feed already pinned to the exact clip — not the top of the shuffle.
 */
function ShareFab({ killId }: { killId: string }) {
  const [toast, setToast] = useState<string | null>(null);

  const onShare = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const url = `${window.location.origin}/scroll?kill=${killId}`;
      const title = "KCKILLS — clip à voir";
      try {
        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
          await navigator.share({ title, url });
          return;
        }
      } catch {
        // user cancelled share sheet — fall through silently
        return;
      }
      // Clipboard fallback
      try {
        await navigator.clipboard.writeText(url);
        setToast("Lien copié !");
        window.setTimeout(() => setToast(null), 1800);
      } catch {
        setToast("Copie impossible");
        window.setTimeout(() => setToast(null), 1800);
      }
    },
    [killId],
  );

  return (
    <>
      <button
        type="button"
        onClick={onShare}
        aria-label="Partager ce clip"
        title="Partager"
        className="absolute top-28 right-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm text-white/80 hover:bg-[var(--gold)]/30 hover:text-[var(--gold)] transition-all active:scale-95"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
      </button>
      {toast && (
        <div className="pointer-events-none fixed top-20 left-1/2 -translate-x-1/2 z-[70] rounded-full bg-black/85 backdrop-blur-sm px-4 py-2 text-xs font-bold text-[var(--gold)] shadow-lg animate-pulse">
          {toast}
        </div>
      )}
    </>
  );
}
