"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { m, AnimatePresence, useReducedMotion } from "motion/react";
import { useToast } from "./Toast";
import {
  getActivePushSubscription,
  getPushPermissionState,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  type PushPermissionState,
} from "@/lib/push";
import type { LiveKillRow, LiveMatchRow } from "@/lib/supabase/live";

/**
 * LiveHotNow — sticky bottom bar that surfaces a currently-running KC
 * match + the freshest published kills, with a push-notifications
 * toggle so fans get pinged for each new highlight.
 *
 * Goal : keep visitors ON kckills.com during the match instead of
 * letting them drift to Twitter / Twitch chat. Polls /api/live/state
 * at an adaptive cadence (30 s idle, 15 s live) and overlays a
 * full-width strip above the navbar / wolf player.
 *
 * Mount point : Providers.tsx (global, every route except where the
 * server hides it via meta). DOM is rendered conditionally — when
 * no match is live, the component returns null so it doesn't compete
 * for stacking context with the rest of the chrome.
 *
 * Z-index decision : z-[90]. Higher than the wolf player (z-60),
 * lower than the command palette (z-100). The dismiss button collapses
 * the strip but keeps a tiny "🔴 LIVE" badge so users can re-open it.
 *
 * Reduced motion : `useReducedMotion()` swaps the bounce-in for a
 * fade-only animation and disables the pulsing red dot.
 */

interface LiveStatePayload {
  liveMatch: LiveMatchRow | null;
  recentKills: LiveKillRow[];
  score: { kc: number; opp: number };
}

const POLL_IDLE_MS = 30_000;
const POLL_LIVE_MS = 15_000;
const DISMISS_STORAGE_KEY = "kc-live-hot-dismissed";

export function LiveHotNow() {
  const [state, setState] = useState<LiveStatePayload | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [pushState, setPushState] = useState<PushPermissionState>("default");
  const [pushBusy, setPushBusy] = useState(false);
  const [hasSubscription, setHasSubscription] = useState(false);
  const lastMatchIdRef = useRef<string | null>(null);
  const reducedMotion = useReducedMotion();
  const toast = useToast();

  // ─── Dismiss persistence ─────────────────────────────────────────
  // We persist the dismiss decision PER MATCH. A new match wipes the
  // flag — without this, a user who dismissed match A on Tuesday would
  // never see the banner for match B on Thursday.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
      if (raw && state?.liveMatch && raw === state.liveMatch.id) {
        setCollapsed(true);
      }
    } catch {
      // localStorage disabled — no persistence, banner reappears each visit.
    }
  }, [state?.liveMatch]);

  // ─── Adaptive polling loop ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let controller: AbortController | null = null;

    const tick = async () => {
      if (controller) controller.abort();
      const ac = new AbortController();
      controller = ac;
      try {
        const res = await fetch("/api/live/state", { signal: ac.signal });
        if (cancelled || ac.signal.aborted) return;
        if (!res.ok) return;
        const data = (await res.json()) as LiveStatePayload;
        if (cancelled) return;
        setState(data);

        // Reset the dismiss flag when the live match identity changes
        // — a brand new match warrants a brand new toast.
        const liveId = data.liveMatch?.id ?? null;
        if (liveId && liveId !== lastMatchIdRef.current) {
          lastMatchIdRef.current = liveId;
          try {
            const stored = window.localStorage.getItem(DISMISS_STORAGE_KEY);
            if (stored && stored !== liveId) {
              window.localStorage.removeItem(DISMISS_STORAGE_KEY);
              setCollapsed(false);
            }
          } catch { /* noop */ }
        }
      } catch (err) {
        if ((err as { name?: string })?.name !== "AbortError") {
          // Network errors are routine — swallow them, the next tick
          // will retry. Surface only to console for debug.
          console.warn("[LiveHotNow] poll failed:", err);
        }
      } finally {
        if (cancelled) return;
        // Adaptive cadence : faster polling while live, slower idle.
        const nextDelay = state?.liveMatch ? POLL_LIVE_MS : POLL_IDLE_MS;
        timeoutId = window.setTimeout(tick, nextDelay);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      if (controller) controller.abort();
    };
    // We re-create the loop when liveMatch presence flips so the
    // cadence adapts. Stringifying the id keeps the dep stable.
  }, [state?.liveMatch?.id, state?.liveMatch]);

  // ─── Push permission state probe (once on mount, then on focus) ──
  useEffect(() => {
    if (!isPushSupported()) {
      setPushState("unsupported");
      return;
    }
    const refresh = async () => {
      setPushState(getPushPermissionState());
      const existing = await getActivePushSubscription();
      setHasSubscription(Boolean(existing));
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const onTogglePush = useCallback(async () => {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (hasSubscription) {
        await unsubscribeFromPush();
        setHasSubscription(false);
        setPushState(getPushPermissionState());
        toast("Notifications désactivées", "info");
        return;
      }
      const result = await subscribeToPush("/api/live/subscribe");
      if (result.ok) {
        setHasSubscription(true);
        setPushState("granted");
        toast("Notifications live activées 🔔", "success");
      } else if (result.reason === "permission-denied") {
        toast("Permission refusée — active depuis les réglages", "error");
      } else if (result.reason === "missing-vapid") {
        toast("Push pas encore configuré (VAPID)", "error");
      } else if (result.reason === "unsupported") {
        toast("Push non supporté sur ce navigateur", "error");
      } else {
        toast("Activation impossible — réessaie", "error");
      }
    } finally {
      setPushBusy(false);
    }
  }, [hasSubscription, pushBusy, toast]);

  const onDismiss = useCallback(() => {
    if (!state?.liveMatch) return;
    setCollapsed(true);
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, state.liveMatch.id);
    } catch { /* noop */ }
  }, [state?.liveMatch]);

  const onReopen = useCallback(() => {
    setCollapsed(false);
    try {
      window.localStorage.removeItem(DISMISS_STORAGE_KEY);
    } catch { /* noop */ }
  }, []);

  const match = state?.liveMatch ?? null;
  const top3 = useMemo(() => state?.recentKills.slice(0, 3) ?? [], [state?.recentKills]);

  // No live match → render nothing (no DOM).
  if (!match) return null;

  // Dismissed → small re-open chip in the bottom-left.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onReopen}
        className="fixed bottom-4 left-4 z-[90] flex items-center gap-2 rounded-full bg-[var(--red)]/95 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white shadow-2xl backdrop-blur-md hover:bg-[var(--red)] transition-colors"
        aria-label="Réouvrir la bannière live"
      >
        <span className="relative flex h-2 w-2">
          {!reducedMotion && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
        </span>
        Live
      </button>
    );
  }

  const pushLabel = (() => {
    if (pushBusy) return "...";
    if (pushState === "unsupported") return "Indispo";
    if (pushState === "denied") return "Bloqué";
    if (hasSubscription) return "🔔 ON";
    return "🔔 Activer";
  })();

  const matchupLabel = match.matchup_label ?? "KC en live";
  const formatLabel = match.format ? match.format.toUpperCase() : null;

  return (
    <AnimatePresence>
      <m.aside
        key="live-hot-now"
        initial={
          reducedMotion
            ? { opacity: 0 }
            : { opacity: 0, y: 80 }
        }
        animate={
          reducedMotion
            ? { opacity: 1 }
            : { opacity: 1, y: 0, transition: { type: "spring", stiffness: 220, damping: 22 } }
        }
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 80 }}
        className="fixed bottom-0 left-0 right-0 z-[90] border-t border-[var(--red)]/40 bg-gradient-to-t from-black via-[#170305] to-black/95 shadow-[0_-12px_40px_rgba(232,64,87,0.25)] backdrop-blur-md"
        aria-label="Bandeau live KC"
        role="region"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0)" }}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:gap-3 sm:py-2.5">
          {/* Header — pulse dot + matchup */}
          <div className="flex items-center gap-2.5 min-w-0 flex-shrink-0">
            <span className="relative flex h-2.5 w-2.5">
              {!reducedMotion && (
                <m.span
                  className="absolute inline-flex h-full w-full rounded-full bg-[var(--red)]"
                  animate={{ scale: [1, 1.8, 1], opacity: [0.75, 0, 0.75] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                />
              )}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--red)]" />
            </span>
            <span className="font-display tracking-widest text-[10px] uppercase text-[var(--red)]">
              KC EN LIVE
            </span>
            <span className="font-display text-sm font-bold text-[var(--text-primary)] truncate">
              {matchupLabel}
            </span>
            {formatLabel && (
              <span className="hidden md:inline rounded-full bg-white/5 px-2 py-0.5 font-data text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                {formatLabel}
              </span>
            )}
            {state && (
              <span className="hidden md:inline font-data text-xs font-bold text-[var(--gold)]">
                {state.score.kc} - {state.score.opp}
              </span>
            )}
          </div>

          {/* Recent kills strip */}
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5 scrollbar-hide">
            {top3.length === 0 && (
              <span className="text-xs italic text-[var(--text-muted)]">
                Match en cours — clips à venir...
              </span>
            )}
            {top3.map((kill) => (
              <LiveKillChip key={kill.id} kill={kill} reducedMotion={Boolean(reducedMotion)} />
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-shrink-0 items-center gap-2">
            <Link
              href={`/live`}
              className="rounded-full bg-[var(--red)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white shadow hover:bg-[#FF3B5C] transition-colors"
            >
              Voir le live
            </Link>
            <button
              type="button"
              onClick={onTogglePush}
              disabled={
                pushBusy || pushState === "unsupported" || pushState === "denied"
              }
              className="rounded-full border border-[var(--border-gold)] bg-white/5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[var(--gold-bright)] hover:bg-[var(--gold)]/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={hasSubscription ? "Désactiver les notifications live" : "Activer les notifications live"}
            >
              {pushLabel}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="grid h-7 w-7 place-items-center rounded-full text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)] transition-colors"
              aria-label="Fermer la bannière"
            >
              <span className="text-base leading-none">×</span>
            </button>
          </div>
        </div>
      </m.aside>
    </AnimatePresence>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

interface LiveKillChipProps {
  kill: LiveKillRow;
  reducedMotion: boolean;
}

function LiveKillChip({ kill, reducedMotion }: LiveKillChipProps) {
  const matchup = useMemo(() => {
    const k = kill.killer_champion ?? "?";
    const v = kill.victim_champion ?? "?";
    return `${k} → ${v}`;
  }, [kill.killer_champion, kill.victim_champion]);

  const isKcKill = kill.tracked_team_involvement === "team_killer";
  const isMulti = Boolean(kill.multi_kill);
  const isFirstBlood = kill.is_first_blood;

  return (
    <m.div
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 12 }}
      animate={
        reducedMotion
          ? { opacity: 1 }
          : { opacity: 1, x: 0, transition: { duration: 0.25 } }
      }
    >
      <Link
        href={`/kill/${kill.id}`}
        className={`flex items-center gap-2 rounded-lg border px-2 py-1 transition-colors ${
          isKcKill
            ? "border-[var(--gold)]/40 bg-[var(--gold)]/10 hover:bg-[var(--gold)]/20"
            : "border-white/10 bg-white/5 hover:bg-white/10"
        }`}
      >
        {kill.thumbnail_url ? (
          <span className="relative block h-8 w-8 overflow-hidden rounded-md bg-black/60 flex-shrink-0">
            <Image
              src={kill.thumbnail_url}
              alt={matchup}
              width={32}
              height={32}
              className="h-full w-full object-cover"
              unoptimized
            />
          </span>
        ) : (
          <span className="h-8 w-8 flex-shrink-0 rounded-md bg-black/60" aria-hidden />
        )}
        <span className="flex flex-col leading-tight">
          <span className="font-data text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            {isFirstBlood ? "First Blood" : isMulti ? kill.multi_kill : isKcKill ? "Kill KC" : "Death"}
          </span>
          <span className="font-display text-xs font-semibold text-[var(--text-primary)] truncate max-w-[14ch]">
            {matchup}
          </span>
        </span>
      </Link>
    </m.div>
  );
}
