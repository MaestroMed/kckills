"use client";

/**
 * StreakBadge — V18 (Wave 21.5).
 *
 * Habit-loop hook : tracks consecutive days the user has visited
 * /scroll. Surface a discrete chip "🔥 Day N" in the top bar so
 * loyal visitors get a soft "don't break the streak" prompt.
 *
 * Rules :
 *   * Today vs last_visit  → no change.
 *   * 1-day gap            → streak++.
 *   * >1-day gap           → streak reset to 1.
 *   * Cold-start (no key)  → streak = 1, no badge shown until the
 *                            second visit (avoid bragging on day 1).
 *
 * Storage : `localStorage.kc_streak_v1` (versioned key for safe
 * future schema bumps). Read AND write happen on the client only ;
 * the badge renders nothing during SSR. No login required — purely
 * device-local.
 *
 * Privacy : zero PII. Just "you visited yesterday and today" state.
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "kc_streak_v1";

interface StreakState {
  /** ISO date YYYY-MM-DD of the last successful visit. */
  last_visit: string;
  streak: number;
}

function todayUtcIso(): string {
  // UTC date so timezone-shifting users don't accidentally double-count.
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  // Both inputs are YYYY-MM-DD strings ; parse via Date.UTC to dodge
  // local-timezone surprises.
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms =
    Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd);
  return Math.round(ms / 86400000);
}

function readState(): StreakState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StreakState;
    if (
      typeof parsed?.last_visit === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.last_visit) &&
      typeof parsed?.streak === "number" &&
      Number.isFinite(parsed.streak) &&
      parsed.streak > 0
    ) {
      return parsed;
    }
  } catch {
    /* corrupted JSON — fall through to fresh start */
  }
  return null;
}

function writeState(s: StreakState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* quota exceeded / storage disabled — silent */
  }
}

/** Compute the new state from the existing one + today. */
function tickStreak(prev: StreakState | null, today: string): StreakState {
  if (!prev) return { last_visit: today, streak: 1 };
  const gap = daysBetween(today, prev.last_visit);
  if (gap === 0) return prev; // already counted today
  if (gap === 1) {
    return { last_visit: today, streak: prev.streak + 1 };
  }
  // gap >= 2 → streak broken, reset to 1.
  return { last_visit: today, streak: 1 };
}

export function StreakBadge() {
  const [streak, setStreak] = useState<number | null>(null);

  useEffect(() => {
    const today = todayUtcIso();
    const prev = readState();
    const next = tickStreak(prev, today);
    if (!prev || prev.last_visit !== next.last_visit || prev.streak !== next.streak) {
      writeState(next);
    }
    setStreak(next.streak);
  }, []);

  // Hide on cold-start (day 1) — bragging on the first visit reads
  // weird. From day 2 onwards, surface the chip.
  if (streak == null || streak < 2) return null;

  return (
    <span
      role="status"
      aria-label={`Série de ${streak} jours`}
      className="inline-flex items-center gap-1 rounded-full bg-[var(--gold)]/15 border border-[var(--gold)]/40 backdrop-blur-sm px-2 py-0.5 text-[10px] font-data font-bold uppercase tracking-widest text-[var(--gold)] pointer-events-none select-none"
      title={`Tu reviens depuis ${streak} jours d'affilée`}
    >
      <span aria-hidden>🔥</span>
      <span>Day {streak}</span>
    </span>
  );
}
