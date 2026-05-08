"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

interface LiveData {
  isLive: boolean;
  opponent: string | null;
  opponentName: string | null;
  kcScore: number;
  oppScore: number;
  block: string | null;
  format: string | null;
  streamUrl: string | null;
  matchId: string | null;
}

/**
 * LiveBanner — fixed top strip surfacing the active KC match.
 *
 * Pulls /api/live every 60s during a live match (faster than the 2min
 * idle cadence), shows scores + match format + stream link.
 * Becomes a hype CTA: "KC EN LIVE 1-0 vs G2 · Watch live".
 */
export function LiveBanner() {
  const [data, setData] = useState<LiveData | null>(null);
  const failureCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;
    let currentController: AbortController | null = null;

    const check = async () => {
      if (currentController) currentController.abort();
      const ac = new AbortController();
      currentController = ac;
      try {
        const r = await fetch("/api/live", { signal: ac.signal });
        if (cancelled || ac.signal.aborted) return;
        if (!r.ok) {
          failureCountRef.current += 1;
          return;
        }
        failureCountRef.current = 0;
        const json = await r.json();
        if (cancelled || ac.signal.aborted) return;
        setData(json);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        failureCountRef.current += 1;
      }
    };

    void check();
    // Adaptive: poll faster when live, slower when idle
    intervalId = window.setInterval(check, data?.isLive ? 60_000 : 180_000);

    return () => {
      cancelled = true;
      if (intervalId != null) window.clearInterval(intervalId);
      if (currentController) currentController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.isLive]);

  if (!data?.isLive) return null;

  const Wrapper = data.streamUrl ? "a" : "div";
  const wrapperProps = data.streamUrl
    ? { href: data.streamUrl, target: "_blank", rel: "noopener noreferrer" }
    : {};

  // 2026-05-08 — was `fixed top-0 z-[60]`, which overlaid the sticky
  // navbar (z-50) and hid the desktop menu. Normal flow is fine: the
  // banner stacks above the navbar in LayoutChrome's render order, and
  // when the user scrolls past it the navbar takes over via sticky-top.
  return (
    <Wrapper
      {...wrapperProps}
      className="relative z-[60] flex items-center justify-center gap-3 bg-gradient-to-r from-[var(--red)] via-[#FF3B5C] to-[var(--red)] px-4 py-2 text-center text-sm font-bold text-white shadow-lg hover:opacity-95 transition-opacity"
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top, 0.5rem))" }}
    >
      {/* Pulsing live dot */}
      <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
      </span>

      {/* Content */}
      <span className="font-display tracking-widest uppercase text-[11px]">EN LIVE</span>
      <span className="hidden sm:inline opacity-60">·</span>
      <span className="font-data text-base font-black">
        KC <span className="opacity-80 mx-1">{data.kcScore}-{data.oppScore}</span> {data.opponent ?? ""}
      </span>
      {data.format && (
        <span className="hidden md:inline opacity-70 text-[10px]">{data.format}</span>
      )}
      {data.streamUrl && (
        <span className="ml-2 rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] uppercase tracking-widest font-bold">
          ▶ Stream
        </span>
      )}
    </Wrapper>
  );
}
