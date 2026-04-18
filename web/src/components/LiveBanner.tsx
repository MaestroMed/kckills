"use client";

import { useState, useEffect, useRef } from "react";

/**
 * LiveBanner — fixed top strip that surfaces "KC EN LIVE" during an
 * active match. Polls the server-side /api/live proxy (NOT the
 * LolEsports API directly — see api/live/route.ts for the rationale).
 *
 * Polling cadence: 2 minutes. The server endpoint is CDN-cached for
 * 60s with a 30s SWR window, so even if every visitor polled at the
 * same instant the upstream LolEsports API would still see at most
 * one call per minute per region.
 *
 * Race protection: every fetch uses a fresh AbortController. The
 * effect's cleanup aborts any pending request before unmount and
 * before the next interval tick, so a slow response can never
 * setState on an unmounted component or land out-of-order.
 */
export function LiveBanner() {
  const [isLive, setIsLive] = useState(false);
  const [opponent, setOpponent] = useState<string | null>(null);
  const failureCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;
    let currentController: AbortController | null = null;

    const check = async () => {
      // Cancel any in-flight request before starting a new one.
      if (currentController) currentController.abort();
      const ac = new AbortController();
      currentController = ac;
      try {
        const r = await fetch("/api/live", {
          signal: ac.signal,
          // Don't bypass the CDN cache — the whole point of the proxy.
        });
        if (cancelled || ac.signal.aborted) return;
        if (!r.ok) {
          failureCountRef.current += 1;
          return;
        }
        failureCountRef.current = 0;
        const data: { isLive?: boolean; opponent?: string | null } = await r.json();
        if (cancelled || ac.signal.aborted) return;
        setIsLive(Boolean(data.isLive));
        setOpponent(data.opponent ?? null);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        failureCountRef.current += 1;
        // Silent fallback — banner stays in its last-known state.
      }
    };

    void check();
    intervalId = window.setInterval(check, 120_000); // 2 min

    return () => {
      cancelled = true;
      if (intervalId != null) window.clearInterval(intervalId);
      if (currentController) currentController.abort();
    };
  }, []);

  if (!isLive) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center gap-2 bg-[var(--red)] px-4 py-1.5 text-center text-sm font-bold text-white animate-pulse">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
      </span>
      KC EN LIVE {opponent && `vs ${opponent}`}
    </div>
  );
}
