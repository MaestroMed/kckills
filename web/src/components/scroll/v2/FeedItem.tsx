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

import Image from "next/image";
import Link from "next/link";
import type { VideoFeedItem, MomentFeedItem } from "@/components/scroll/ScrollFeed";

interface SharedFeedItemProps {
  index: number;
  total: number;
  itemHeight: number;
  /** Is this item currently the live, playing item? Drives overlay
   *  fade-in via the .is-active class so it pops only when relevant. */
  isActive: boolean;
}

// ─── Video item (single-kill clip from kills table) ────────────────────

export function FeedItemVideo({
  item,
  index,
  total,
  itemHeight,
  isActive,
}: SharedFeedItemProps & { item: VideoFeedItem }) {
  const isKcKill = item.kcInvolvement === "team_killer";
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

      {/* Bottom overlay */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 px-4 md:px-6 transition-opacity duration-500 ${
          isActive ? "opacity-100" : "opacity-90"
        }`}
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom, 2rem))" }}
      >
        <div className="space-y-3">
          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] ${
                isKcKill
                  ? "bg-[var(--gold)]/20 border border-[var(--gold)]/45 text-[var(--gold)]"
                  : "bg-[var(--red)]/20 border border-[var(--red)]/45 text-[var(--red)]"
              }`}
            >
              {isKcKill ? "KC Kill" : "KC Death"}
            </span>
            {item.isFirstBlood && (
              <span className="rounded-md bg-[var(--red)]/20 border border-[var(--red)]/40 px-2.5 py-1 text-[10px] font-black text-[var(--red)] uppercase tracking-[0.15em]">
                First Blood
              </span>
            )}
            {item.multiKill && (
              <span className="rounded-md bg-[var(--orange)]/20 border border-[var(--orange)]/40 px-2.5 py-1 text-[10px] font-black text-[var(--orange)] uppercase tracking-wider">
                {item.multiKill} kill
              </span>
            )}
            {item.highlightScore != null && (
              <span className="rounded-md bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2 py-1 text-[10px] font-data font-bold text-[var(--gold)]">
                {item.highlightScore.toFixed(1)}/10
              </span>
            )}
          </div>

          {/* Matchup */}
          <p className="font-display text-2xl md:text-3xl font-black leading-tight text-white drop-shadow-lg">
            <span className={isKcKill ? "text-[var(--gold)]" : "text-white"}>
              {item.killerChampion}
            </span>
            <span className="text-[var(--gold)] mx-2">→</span>
            <span className={!isKcKill ? "text-[var(--gold)]" : "text-white/85"}>
              {item.victimChampion}
            </span>
          </p>

          {/* AI description */}
          {item.aiDescription && (
            <p className="text-sm md:text-base text-white/85 italic line-clamp-3 max-w-md">
              « {item.aiDescription} »
            </p>
          )}

          {/* Match meta */}
          <p className="text-[11px] font-data uppercase tracking-wider text-white/60">
            {item.opponentCode ? `vs ${item.opponentCode}` : item.matchStage}
            {item.gameNumber ? ` · G${item.gameNumber}` : ""}
            {item.matchScore ? ` · ${item.matchScore}` : ""}
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

export function FeedItemMoment({
  item,
  index,
  total,
  itemHeight,
  isActive,
}: SharedFeedItemProps & { item: MomentFeedItem }) {
  const isKc = item.kcInvolvement === "kc_aggressor" || item.kcInvolvement === "kc_both";
  const label = MOMENT_LABEL[item.classification] ?? item.classification;
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
      <div
        className={`absolute inset-x-0 bottom-0 z-10 px-4 md:px-6 transition-opacity duration-500 ${
          isActive ? "opacity-100" : "opacity-90"
        }`}
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom, 2rem))" }}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                isKc
                  ? "bg-[var(--gold)]/20 border border-[var(--gold)]/45 text-[var(--gold)]"
                  : "bg-[var(--red)]/20 border border-[var(--red)]/45 text-[var(--red)]"
              }`}
            >
              {label}
            </span>
            <span className="rounded-md bg-black/50 border border-white/15 px-2 py-1 text-[10px] font-data font-bold text-white/80">
              {item.killCount} kills
            </span>
            {item.momentScore != null && (
              <span className="rounded-md bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2 py-1 text-[10px] font-data font-bold text-[var(--gold)]">
                {item.momentScore.toFixed(1)}/10
              </span>
            )}
          </div>
          {item.aiDescription && (
            <p className="text-sm md:text-base text-white/85 italic line-clamp-3 max-w-md">
              « {item.aiDescription} »
            </p>
          )}
          <p className="text-[11px] font-data uppercase tracking-wider text-white/60">
            {item.blueKills}-{item.redKills} ·{" "}
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
