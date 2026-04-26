"use client";

/**
 * HomeTopScorerCarousel — rotating spotlight on the 5 KC players.
 *
 * Replaces the old "Top scorer carrière" single-player card. Auto-rotates
 * through the 5 starters every 4.5s with a smooth fade, each card
 * surfacing the player's signature achievement (most kills / best win
 * rate / most pentas / best KDA / most clips published).
 *
 * The data is computed server-side (parent passes the full list) so the
 * client just orchestrates rotation + UX. Tap a card → opens player page.
 * Tap the indicator dots → jump to a specific player.
 *
 * Pause-on-hover so the user can read a specific card. Resume on leave.
 * Respects prefers-reduced-motion (no rotation, just shows the first
 * card with manual nav).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { m, useReducedMotion } from "motion/react";

export interface RosterPlayerStat {
  ign: string;
  role: string;
  imageUrl: string | null;
  totalKills: number;
  gamesPlayed: number;
  winRate: number; // 0..1
  pentas?: number;
  bestKda?: number;
  publishedClips?: number;
  /** The "achievement headline" — the card's hook text. */
  achievement: string;
  /** A label like "Top kills" / "WR Champion" / "Penta King" — small chip top-left. */
  achievementLabel: string;
}

const ROTATE_MS = 4500;

export function HomeTopScorerCarousel({ players }: { players: RosterPlayerStat[] }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useReducedMotion() ?? false;
  const intervalRef = useRef<number | null>(null);

  const safe = players.length > 0 ? players : [];
  const current = safe[idx] ?? null;

  useEffect(() => {
    if (reducedMotion || paused || safe.length <= 1) return;
    intervalRef.current = window.setInterval(() => {
      setIdx((i) => (i + 1) % safe.length);
    }, ROTATE_MS);
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [reducedMotion, paused, safe.length]);

  if (!current) return null;

  return (
    <div
      className="relative rounded-xl bg-black/55 backdrop-blur-md border border-[var(--gold)]/20 px-5 py-4 transition-all hover:border-[var(--gold)]/50 hover:bg-black/70 overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <p className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--gold)]/60">
          {current.achievementLabel}
        </p>
        <p className="font-data text-[9px] text-white/40 tabular-nums">
          {idx + 1} / {safe.length}
        </p>
      </div>

      {/* Card body — animated transition between players */}
      <m.div
        key={current.ign}
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex items-center gap-3"
      >
        <Link
          href={`/player/${encodeURIComponent(current.ign)}`}
          className="shrink-0 group"
          aria-label={`Voir le profil de ${current.ign}`}
        >
          {current.imageUrl ? (
            <Image
              src={current.imageUrl}
              alt={current.ign}
              width={56}
              height={56}
              className="rounded-full border-2 border-[var(--gold)]/40 group-hover:border-[var(--gold)] object-cover object-top transition-all"
            />
          ) : (
            <div className="h-14 w-14 rounded-full bg-[var(--gold)]/20 grid place-items-center font-display font-black text-[var(--gold)] text-xl">
              {current.ign[0]}
            </div>
          )}
        </Link>
        <div className="flex-1 min-w-0">
          <Link
            href={`/player/${encodeURIComponent(current.ign)}`}
            className="block font-display text-lg font-black text-white hover:text-[var(--gold)] transition-colors truncate"
          >
            {current.ign}
          </Link>
          <p className="text-[10px] text-white/50 font-data uppercase tracking-wider">
            {current.role}
          </p>
          <p className="text-[11px] text-[var(--gold-bright)] mt-0.5 line-clamp-2 leading-tight">
            {current.achievement}
          </p>
        </div>
      </m.div>

      {/* Dots indicator */}
      <div
        className="mt-3 flex items-center justify-center gap-1.5"
        role="tablist"
        aria-label="Sélectionner un joueur"
      >
        {safe.map((p, i) => (
          <button
            key={p.ign}
            onClick={() => {
              setIdx(i);
              setPaused(true);
              window.setTimeout(() => setPaused(false), 6000); // resume rotation after a beat
            }}
            role="tab"
            aria-selected={i === idx}
            aria-label={`Voir ${p.ign}`}
            className={`
              h-1.5 rounded-full transition-all
              ${i === idx
                ? "w-6 bg-[var(--gold)]"
                : "w-1.5 bg-white/20 hover:bg-white/40"}
            `}
          />
        ))}
      </div>

      {/* Subtle progress bar (auto-rotate timer indicator) */}
      {!reducedMotion && !paused && safe.length > 1 && (
        <m.div
          key={`progress-${idx}`}
          className="absolute bottom-0 left-0 h-[2px] bg-[var(--gold)]/40"
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: ROTATE_MS / 1000, ease: "linear" }}
        />
      )}
    </div>
  );
}
