"use client";

/**
 * ScrollContextPanel — Wave 36 / desktop wide-stage right column.
 *
 * The editorial "marginalia" rail that sits to the RIGHT of the 9:16 stage
 * on wide viewports (>=1024). It is the quiet, reading-room counterpart to
 * the loud full-bleed video: instead of stacking SaaS cards, it lays out
 * micro-data under Losange eyebrows in muted Space-Mono, the way a printed
 * match programme annotates a photograph.
 *
 * ── Contract ──────────────────────────────────────────────────────────
 *   - Width is exactly --ctx (372px). The parent reserves this track and
 *     ONLY mounts this component behind its own isWideStage (min-width
 *     1024) flag — this file renders nothing media-query-specific itself,
 *     so the <768 mobile feed code path is never touched.
 *   - role="complementary" (it complements the stage, it is not the main
 *     content). Left edge is a .gold-line hairline, NOT a full border.
 *   - Re-renders on every active-kill change, so every sub-section is
 *     wrapped in React.memo and only re-paints when its own slice of the
 *     kill changed.
 *
 * ── Sections ──────────────────────────────────────────────────────────
 *   1. MATCH HEADER   — KC vs opponent codes, stage, date, score, W/L.
 *   2. RATE           — the 1-5 StarRating as a first-class inline control
 *                       wired to the rateKill() server action. Login-gated:
 *                       on authRequired it surfaces InlineAuthPrompt
 *                       (intent='rate') and retries the pending score after
 *                       a successful Discord login. Shows avg + count.
 *   3. DESCRIPTION    — the FULL, un-clamped Gemini AI description.
 *   4. RELATED        — "À suivre" : feed_score-ranked thumbnails (passed
 *                       in via props, NO new fetch) that call onJumpTo(i).
 *   5. COMMENTS       — docked <CommentSheetV2 mode='panel'/>, collapsed.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useT } from "@/lib/i18n/use-lang";
import { m, useReducedMotion } from "motion/react";
import type { VideoFeedItem } from "@/components/scroll/ScrollFeed";
import { StarRating } from "@/components/star-rating";
import { rateKill } from "@/components/community/actions";
import { InlineAuthPrompt } from "@/components/community/InlineAuthPrompt";
import { CommentSheetV2 } from "@/components/community/CommentSheetV2";
import { isDescriptionClean } from "@/lib/scroll/sanitize-description";

/**
 * A single "À suivre" candidate. A structural subset of VideoFeedItem so
 * callers can pass real feed items straight through (the assignment is
 * covariant — extra fields are simply ignored). `index` is the absolute
 * position in the parent's feed array, handed back verbatim to onJumpTo.
 */
export interface RelatedFeedCandidate {
  index: number;
  id: string;
  thumbnail: string | null;
  killerChampion: string;
  victimChampion: string;
  killerName: string | null;
  multiKill: string | null;
  isFirstBlood: boolean;
  score: number;
}

interface ScrollContextPanelProps {
  /** The currently-active feed item. We narrow to VideoFeedItem because
   *  only real clips carry the match metadata + AI description this panel
   *  is built to annotate. */
  kill: VideoFeedItem;
  /** Jump the feed to the item at `index`. Wired to the RELATED thumbs. */
  onJumpTo?: (index: number) => void;
  /** feed_score-ranked neighbours for the "À suivre" strip. PROPS ONLY —
   *  the parent already has the ranked feed in memory, this panel never
   *  fetches. Defaults to none (strip hidden) so the prop stays optional
   *  and the required `{ kill, onJumpTo }` signature is preserved. */
  related?: RelatedFeedCandidate[];
}

// Tiny 1x2 dark gradient base64 — soft blur placeholder under thumbnails
// while they decode (same recipe FeedItem uses, no white flash).
const BLUR_PLACEHOLDER =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAACAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpgD//Z";

// ════════════════════════════════════════════════════════════════════
// Shared ornaments — quiet Losange eyebrow + section heading.
// ════════════════════════════════════════════════════════════════════

/** Small gold losange — reuse of the VSRoulette recipe, inline-flex so it
 *  sits flush before an eyebrow label. */
function Losange() {
  return (
    <span
      aria-hidden
      className="inline-block flex-shrink-0"
      style={{
        width: 7,
        height: 7,
        transform: "rotate(45deg)",
        background: "linear-gradient(135deg, var(--gold-bright), var(--gold))",
        boxShadow: "0 0 12px rgba(200,170,110,0.45)",
      }}
    />
  );
}

/** Editorial eyebrow: losange + ALL-CAPS Space-Mono micro-label in
 *  --text-muted. The section content reads as marginalia beneath it. */
const Eyebrow = memo(function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <Losange />
      <span className="font-data text-[10px] uppercase tracking-[0.28em] text-[var(--text-muted)]">
        {children}
      </span>
    </div>
  );
});

// ════════════════════════════════════════════════════════════════════
// Section 1 — MATCH HEADER
// ════════════════════════════════════════════════════════════════════

interface MatchHeaderProps {
  isKcKill: boolean;
  opponentCode: string;
  matchStage: string;
  matchDate: string;
  matchScore: string | null;
  kcWon: boolean | null;
  gameNumber: number;
}

const MatchHeader = memo(function MatchHeader({
  isKcKill,
  opponentCode,
  matchStage,
  matchDate,
  matchScore,
  kcWon,
  gameNumber,
}: MatchHeaderProps) {
  const t = useT();
  // matchDate arrives as an ISO string. Render a stable, locale-stamped
  // short date; guard against an unparseable value so a bad row never
  // throws inside the panel.
  const dateLabel = useMemo(() => {
    const d = new Date(matchDate);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }, [matchDate]);

  const opp = opponentCode || "LEC";

  return (
    <header>
      <Eyebrow>{t("p_scroll.rail_match")}</Eyebrow>
      {/* Team codes — KC always on the left, opponent on the right. The
          side that scored the kill is highlighted gold. */}
      <div className="flex items-center gap-2.5 font-display text-2xl font-black leading-none">
        <span className={isKcKill ? "text-[var(--gold)]" : "text-white/85"}>
          KC
        </span>
        <span className="font-data text-xs font-normal text-[var(--text-muted)]">
          {t("p_scroll.rail_vs")}
        </span>
        <span className={!isKcKill ? "text-[var(--gold)]" : "text-white/85"}>
          {opp}
        </span>
        {kcWon != null && (
          <span
            className={`ml-auto font-data text-[11px] font-bold uppercase tracking-widest ${
              kcWon ? "text-[var(--green)]" : "text-[var(--red)]"
            }`}
          >
            {kcWon ? t("p_scroll.rail_victory") : t("p_scroll.rail_defeat")}
          </span>
        )}
      </div>

      {/* Micro-data line — stage · game · score · date. Quiet mono, the
          marginalia voice. Pieces are joined by hairline dots only when
          present so we never render dangling separators. */}
      <p className="mt-3 font-data text-[11px] leading-relaxed text-[var(--text-muted)]">
        {[
          matchStage || null,
          gameNumber ? t("p_scroll.rail_game", { n: gameNumber }) : null,
          matchScore || null,
          dateLabel,
        ]
          .filter(Boolean)
          .map((part, i, arr) => (
            <span key={i}>
              {part}
              {i < arr.length - 1 && (
                <span className="mx-1.5 text-[var(--gold)]/40">◆</span>
              )}
            </span>
          ))}
      </p>
    </header>
  );
});

// ════════════════════════════════════════════════════════════════════
// Section 2 — RATE (StarRating wired to rateKill, login-gated)
// ════════════════════════════════════════════════════════════════════

interface RateSectionProps {
  killId: string;
  avgRating: number | null;
  ratingCount: number;
}

const RateSection = memo(function RateSection({
  killId,
  avgRating,
  ratingCount,
}: RateSectionProps) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  // Local mirror of the server-truth aggregate so the avg/count refresh
  // the instant our own rating lands, without a parent re-fetch.
  const [avg, setAvg] = useState<number | null>(avgRating);
  const [count, setCount] = useState<number>(ratingCount);
  // The user's own selected score (0 = not yet rated this session).
  const [myScore, setMyScore] = useState(0);
  const [pending, setPending] = useState(false);
  const [justRated, setJustRated] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  // Score the user clicked while logged out — replayed after auth.
  const pendingScoreRef = useRef<number | null>(null);
  const confirmTimerRef = useRef<number | null>(null);

  // When the active kill changes, the parent re-mounts/re-renders us with
  // fresh aggregates. Re-sync local state and clear the per-clip "my" rating.
  useEffect(() => {
    setAvg(avgRating);
    setCount(ratingCount);
    setMyScore(0);
    setJustRated(false);
  }, [killId, avgRating, ratingCount]);

  useEffect(
    () => () => {
      if (confirmTimerRef.current != null) {
        window.clearTimeout(confirmTimerRef.current);
      }
    },
    [],
  );

  const flashConfirm = useCallback(() => {
    setJustRated(true);
    if (confirmTimerRef.current != null) window.clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = window.setTimeout(() => setJustRated(false), 2200);
  }, []);

  const submit = useCallback(
    async (score: number) => {
      if (pending) return;
      // Optimistic: paint the stars immediately.
      const prevMine = myScore;
      setMyScore(score);
      setPending(true);
      try {
        const res = await rateKill(killId, score);
        if (res.ok) {
          setAvg(res.avgRating);
          setCount(res.ratingCount);
          flashConfirm();
        } else if (res.authRequired) {
          // Roll the stars back to their pre-click state and stash the
          // score so we can replay it after the Discord popup returns.
          setMyScore(prevMine);
          pendingScoreRef.current = score;
          setAuthOpen(true);
        } else {
          // Hard failure — revert the optimistic star fill.
          setMyScore(prevMine);
        }
      } catch {
        setMyScore(prevMine);
      } finally {
        setPending(false);
      }
    },
    [killId, myScore, pending, flashConfirm],
  );

  const onAuthenticated = useCallback(() => {
    const score = pendingScoreRef.current;
    pendingScoreRef.current = null;
    if (score != null) void submit(score);
  }, [submit]);

  // What the stars show: the user's pick once they've rated, otherwise the
  // rounded community average so the control reads as "the current verdict".
  const displayScore = myScore || (avg != null ? Math.round(avg) : 0);

  return (
    <section aria-label={t("p_scroll.rail_rate_aria")}>
      <Eyebrow>{t("p_scroll.rail_your_rating")}</Eyebrow>
      <div className="flex items-center gap-3">
        <div className={pending ? "pointer-events-none opacity-70" : ""}>
          <StarRating rating={displayScore} size="lg" onRate={(s) => void submit(s)} />
        </div>
        {/* Aggregate read-out — avg/5 + count, quiet mono. */}
        <div className="flex flex-col leading-tight">
          {avg != null && count > 0 ? (
            <>
              <span className="font-data text-sm font-bold text-[var(--gold)]">
                {avg.toFixed(1)}
                <span className="text-[var(--text-muted)] text-[11px]">/5</span>
              </span>
              <span className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                {count <= 1 ? t("p_scroll.rail_vote_one", { n: count }) : t("p_scroll.rail_vote_many", { n: count })}
              </span>
            </>
          ) : (
            <span className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              {t("p_scroll.rail_be_first")}
            </span>
          )}
        </div>
        {/* Confirmation pill — opacity-only fade, reduced-motion safe. */}
        <m.span
          aria-hidden={!justRated}
          initial={false}
          animate={{ opacity: justRated ? 1 : 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="ml-auto font-data text-[10px] font-bold uppercase tracking-widest text-[var(--green)]"
        >
          {t("p_scroll.rail_rated")}
        </m.span>
      </div>

      <InlineAuthPrompt
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={onAuthenticated}
        intent="rate"
      />
    </section>
  );
});

// ════════════════════════════════════════════════════════════════════
// Section 3 — FULL AI DESCRIPTION (un-clamped)
// ════════════════════════════════════════════════════════════════════

const DescriptionSection = memo(function DescriptionSection({
  aiDescription,
}: {
  aiDescription: string | null;
}) {
  const t = useT();
  // Gate on the same cleanliness pass the feed uses — if the legacy field
  // was moderation-rejected, hide it here too.
  if (!isDescriptionClean(aiDescription) || !aiDescription) return null;
  return (
    <section aria-label={t("p_scroll.rail_description")}>
      <Eyebrow>{t("p_scroll.rail_the_moment")}</Eyebrow>
      {/* FULL text — no line-clamp. Serif-adjacent reading size, the long-
          form counterpart to the feed's 3-line teaser. */}
      <p className="text-[15px] leading-relaxed text-[var(--cream)]/90 italic">
        {"« "}
        {aiDescription}
        {" »"}
      </p>
    </section>
  );
});

// ════════════════════════════════════════════════════════════════════
// Section 4 — RELATED "À suivre"
// ════════════════════════════════════════════════════════════════════

const RelatedThumb = memo(function RelatedThumb({
  item,
  onJumpTo,
}: {
  item: RelatedFeedCandidate;
  onJumpTo?: (index: number) => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => onJumpTo?.(item.index)}
      aria-label={t("p_scroll.rail_jump_to_aria", { killer: item.killerChampion, victim: item.victimChampion })}
      className="group relative block aspect-[9/16] w-full overflow-hidden rounded-lg border border-[var(--border-gold)] bg-black transition-colors hover:border-[var(--gold)]/50"
    >
      {item.thumbnail ? (
        <Image
          src={item.thumbnail}
          alt=""
          fill
          sizes="110px"
          placeholder="blur"
          blurDataURL={BLUR_PLACEHOLDER}
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-[var(--bg-elevated)]" />
      )}
      {/* Legibility veil + caption */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 60%)",
        }}
      />
      {/* Top badges — multi / FB chips, kept tiny so the thumb stays clean. */}
      {(item.multiKill || item.isFirstBlood) && (
        <span className="absolute top-1 left-1 flex gap-1">
          {item.multiKill && (
            <span className="rounded bg-[var(--orange)]/30 border border-[var(--orange)]/55 px-1 py-px text-[8px] font-black uppercase tracking-wider text-[var(--orange)] backdrop-blur-sm">
              ✦
            </span>
          )}
          {item.isFirstBlood && (
            <span className="rounded bg-[var(--red)]/30 border border-[var(--red)]/55 px-1 py-px text-[8px] font-black uppercase tracking-wider text-[var(--red)] backdrop-blur-sm">
              FB
            </span>
          )}
        </span>
      )}
      <span className="absolute inset-x-1 bottom-1 block text-left">
        <span className="block truncate font-display text-[11px] font-bold leading-tight text-white">
          {item.killerChampion}
        </span>
        {item.killerName && (
          <span className="block truncate font-data text-[8px] uppercase tracking-widest text-[var(--gold)]/80">
            {item.killerName}
          </span>
        )}
      </span>
    </button>
  );
});

const RelatedSection = memo(function RelatedSection({
  related,
  onJumpTo,
}: {
  related: RelatedFeedCandidate[];
  onJumpTo?: (index: number) => void;
}) {
  const t = useT();
  if (related.length === 0) return null;
  return (
    <section aria-label={t("p_scroll.rail_up_next")}>
      <Eyebrow>{t("p_scroll.rail_up_next")}</Eyebrow>
      <div className="grid grid-cols-3 gap-2">
        {related.slice(0, 6).map((item) => (
          <RelatedThumb key={item.id} item={item} onJumpTo={onJumpTo} />
        ))}
      </div>
    </section>
  );
});

// ════════════════════════════════════════════════════════════════════
// Root
// ════════════════════════════════════════════════════════════════════

export function ScrollContextPanel({
  kill,
  onJumpTo,
  related = [],
}: ScrollContextPanelProps) {
  const t = useT();
  const isKcKill = kill.kcInvolvement === "team_killer";

  // Exclude the active kill from its own "À suivre" strip — seeing the clip
  // you're already watching as a "next up" thumbnail reads as a bug.
  const relatedFiltered = useMemo(
    () => related.filter((r) => r.id !== kill.id),
    [related, kill.id],
  );

  return (
    <aside
      role="complementary"
      aria-label={t("p_scroll.rail_context_aria")}
      className="relative h-full overflow-y-auto bg-[var(--bg-surface)]/70 backdrop-blur-md"
      style={{ width: "var(--ctx)" }}
    >
      {/* Left edge — a .gold-line HAIRLINE (1px gradient), not a full
          border. Rotated 90° via the vertical helper below so it runs the
          full height of the rail. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-px"
        style={{
          background:
            "linear-gradient(to bottom, transparent, var(--gold), transparent)",
        }}
      />

      <div className="flex flex-col gap-7 px-6 py-7">
        <MatchHeader
          isKcKill={isKcKill}
          opponentCode={kill.opponentCode}
          matchStage={kill.matchStage}
          matchDate={kill.matchDate}
          matchScore={kill.matchScore}
          kcWon={kill.kcWon}
          gameNumber={kill.gameNumber}
        />

        {/* Hairline rule between header and the interactive block. */}
        <div className="gold-line opacity-40" />

        <RateSection
          killId={kill.id}
          avgRating={kill.avgRating}
          ratingCount={kill.ratingCount}
        />

        <DescriptionSection aiDescription={kill.aiDescription} />

        <RelatedSection related={relatedFiltered} onJumpTo={onJumpTo} />

        {/* Docked comments — panel mode, collapsed by default. The
            CommentSheetV2 panel branch owns its own expand/collapse +
            lazy fetch; isOpen/onClose are inert in panel mode but the
            prop contract still requires them. */}
        <section aria-label={t("p_scroll.rail_comments")}>
          <CommentSheetV2 killId={kill.id} isOpen={false} onClose={() => {}} mode="panel" />
        </section>

        {/* Deep-link to the full kill page for the long read. */}
        <Link
          href={`/kill/${kill.id}`}
          className="mt-1 inline-flex items-center gap-1.5 font-data text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)] transition-colors hover:text-[var(--gold)]"
        >
          {t("p_scroll.rail_kill_page")}
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </aside>
  );
}
