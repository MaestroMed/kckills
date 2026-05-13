"use client";

/**
 * <AchievementToast />
 *
 * Floating notification surface that pops every time the current user
 * (or anon session) earns a new badge. Two delivery mechanisms :
 *
 *   1. Polling — every 30 seconds we POST /api/achievements/evaluate
 *      with the BCC session hash. The RPC is idempotent, so the worker
 *      evaluator + this client poll race safely : whichever side wins
 *      the INSERT, the other gets an empty list. We dedupe earned slugs
 *      via localStorage so a re-evaluation never re-pops the same toast.
 *
 *   2. Custom event — anywhere in the app can dispatch
 *      `window.dispatchEvent(new CustomEvent("kckills:achievements:check"))`
 *      after a successful rating/comment/vote/share/etc. We listen for
 *      that and fire an immediate eval so the toast feels instant.
 *
 * Behaviour :
 *   - One toast at a time. Queue overflows are kept in state and
 *     popped sequentially.
 *   - Toasts auto-dismiss after 4.5s ; clicking them deeplinks to
 *     /achievements?focus=<slug>.
 *   - Respects `prefers-reduced-motion` (no slide animation).
 *   - Hidden on SSR (typeof window check before any heavy work).
 *
 * Mount once in the root layout (Providers wrapper).
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { getBCCSessionHash } from "@/lib/bcc-state";
import {
  type AchievementRarity,
  type AchievementUnlock,
  RARITY_COLOR,
  RARITY_LABEL,
} from "@/lib/supabase/achievements";

const LOCAL_STORAGE_KEY = "kckills_achievement_seen_v1";
const POLL_INTERVAL_MS = 30_000;
const TOAST_TTL_MS = 4_500;
const EVENT_NAME = "kckills:achievements:check";

interface ToastEntry extends AchievementUnlock {
  /** Internal id so the close animation can find the right entry. */
  uid: string;
}

function loadSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.map(String));
    return new Set();
  } catch {
    return new Set();
  }
}

function persistSeen(seen: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    // Cap stored size to avoid unbounded growth.
    const arr = Array.from(seen).slice(-200);
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // private mode — ignore
  }
}

export function AchievementToast() {
  const [queue, setQueue] = useState<ToastEntry[]>([]);
  const [current, setCurrent] = useState<ToastEntry | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const pollingRef = useRef<boolean>(false);

  const evaluate = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const session = typeof window !== "undefined" ? getBCCSessionHash() : null;
      const res = await fetch("/api/achievements/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: session ?? undefined }),
        cache: "no-store",
      });
      if (!res.ok) return;
      const payload = (await res.json()) as { unlocks?: AchievementUnlock[] };
      const unlocks = Array.isArray(payload.unlocks) ? payload.unlocks : [];
      if (unlocks.length === 0) return;

      const fresh: ToastEntry[] = [];
      for (const u of unlocks) {
        if (!u?.slug) continue;
        if (seenRef.current.has(u.slug)) continue;
        seenRef.current.add(u.slug);
        fresh.push({
          ...u,
          rarity: (u.rarity ?? "common") as AchievementRarity,
          uid: `${u.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        });
      }
      if (fresh.length === 0) return;
      persistSeen(seenRef.current);
      setQueue((q) => [...q, ...fresh]);
    } catch {
      // network blip — try again next interval
    } finally {
      pollingRef.current = false;
    }
  }, []);

  // Hydrate the seen-cache once. We do this before the first poll so the
  // "background-fired" badges (worker eval) don't trigger a toast on
  // page load if the user already saw them.
  useEffect(() => {
    seenRef.current = loadSeen();
  }, []);

  // Polling timer.
  useEffect(() => {
    let active = true;
    // Fire once on mount with a small delay so the initial render
    // settles before we hit the network.
    const initial = window.setTimeout(() => {
      if (active) evaluate();
    }, 4000);
    const id = window.setInterval(() => {
      if (active) evaluate();
    }, POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, [evaluate]);

  // Manual-trigger event listener (custom event from any client action).
  useEffect(() => {
    const handler = () => {
      evaluate();
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, [evaluate]);

  // Dequeue → current. Auto-dismiss after TTL.
  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setCurrent(next);
    setQueue(rest);
  }, [current, queue]);

  useEffect(() => {
    if (!current) return;
    const id = window.setTimeout(() => setCurrent(null), TOAST_TTL_MS);
    return () => window.clearTimeout(id);
  }, [current]);

  if (!current) return null;

  const color = RARITY_COLOR[current.rarity] ?? RARITY_COLOR.common;
  const rarityLabel = RARITY_LABEL[current.rarity] ?? RARITY_LABEL.common;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center px-4 motion-safe:animate-[slideUp_0.35s_cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none"
    >
      <Link
        href={`/achievements?focus=${encodeURIComponent(current.slug)}`}
        onClick={() => setCurrent(null)}
        className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border bg-[var(--bg-elevated)]/95 px-4 py-3 shadow-2xl backdrop-blur-md transition-colors hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
        style={{
          borderColor: `${color}88`,
          boxShadow: `0 0 0 1px ${color}33, 0 8px 32px -16px ${color}aa`,
        }}
      >
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-2xl"
          style={{
            backgroundColor: `${color}22`,
            border: `1px solid ${color}55`,
          }}
        >
          {/* The toast doesn't receive the catalogue icon because the
              evaluate RPC only returns slug/name/rarity/points. Default
              to the trophy glyph — the catalogue link gives users the
              full icon. */}
          🏆
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="text-[9px] font-bold uppercase tracking-widest"
            style={{ color }}
          >
            {rarityLabel} débloqué
          </p>
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {current.name}
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            +{current.points} pts · tape pour voir
          </p>
        </div>
      </Link>
    </div>
  );
}

/**
 * Imperative helper — call this after any successful user action to
 * trigger an immediate achievement evaluation. The toast component
 * listens for the underlying CustomEvent.
 *
 * Usage :
 *   import { triggerAchievementCheck } from "@/components/AchievementToast";
 *   await submitRating(...);
 *   triggerAchievementCheck();
 */
export function triggerAchievementCheck(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    // ignore — older browsers without CustomEvent
  }
}
