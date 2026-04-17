"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TEAM_LOGOS } from "@/lib/kc-assets";
import {
  getLiveMatch,
  getNextMatch,
  type UpcomingMatch,
} from "@/lib/next-match";

/**
 * Floating "next rendez-vous" overlay anchored to the homepage hero.
 *
 * State machine:
 *  - LIVE  → red pulse dot, "EN LIVE" label, links into /scroll for the
 *    real-time feed.
 *  - SOON (< 60 min before kickoff) → orange pulse, "EN APPROCHE" label,
 *    minute-precision countdown.
 *  - UPCOMING → calm gold accent, day/hour countdown.
 *  - none → component renders nothing.
 *
 * Re-evaluates the schedule + countdown every 30 s. We deliberately avoid
 * a 1 s ticker to keep React out of the way — the precision adds nothing
 * (kickoff is on the minute) and 1Hz renders waste battery on mobile.
 *
 * Honors `prefers-reduced-motion` by freezing the entry animation and the
 * pulse dot so a vestibular user isn't bothered.
 */
export function NextMatchOverlay() {
  const [now, setNow] = useState<Date | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const h = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // Wait for the client tick before rendering anything — server output is
  // always blank so SSR doesn't ship a "wrong now" copy that flickers.
  if (!now || dismissed) return null;

  const live = getLiveMatch(now);
  const next = live ?? getNextMatch(now);
  if (!next) return null;

  const kickoff = new Date(next.kickoffISO);
  const ms = kickoff.getTime() - now.getTime();
  const isLive = ms <= 0;
  const soon = !isLive && ms <= 60 * 60 * 1000;

  const accent = isLive ? "var(--red)" : soon ? "var(--orange)" : "var(--gold)";
  const label = isLive ? "EN LIVE" : soon ? "EN APPROCHE" : "PROCHAIN RDV";
  const countdown = formatCountdown(ms, { live: isLive, soon });

  const oppLogo = TEAM_LOGOS[next.opponentCode];

  return (
    <div
      className="absolute top-[max(env(safe-area-inset-top,0px),5.5rem)] right-4 md:right-8 z-30 pointer-events-none"
      aria-live="polite"
    >
      <Link
        href={isLive ? "/scroll" : "/matches"}
        className="next-match-overlay group relative flex items-stretch overflow-hidden rounded-2xl border backdrop-blur-xl pointer-events-auto"
        style={{
          background:
            "linear-gradient(135deg, rgba(10,20,40,0.78), rgba(1,10,19,0.88))",
          borderColor: `${accent}66`,
          boxShadow: `0 18px 48px rgba(0,0,0,0.55), 0 0 0 1px ${accent}30, 0 0 36px ${accent}33`,
          animation: reducedMotion
            ? "none"
            : "next-match-enter 700ms cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        {/* Accent rail on the left */}
        <span
          aria-hidden
          className="block w-1.5"
          style={{
            background: `linear-gradient(180deg, ${accent}, ${accent}55)`,
            boxShadow: `0 0 18px ${accent}80`,
          }}
        />

        <div className="flex items-center gap-4 pl-4 pr-5 py-3 md:py-3.5">
          {/* Status dot + label */}
          <div className="flex flex-col items-start min-w-0">
            <span className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor: accent,
                  boxShadow: `0 0 12px ${accent}`,
                  animation: reducedMotion
                    ? "none"
                    : "next-match-pulse 1.6s ease-in-out infinite",
                }}
              />
              <span
                className="font-data text-[10px] font-bold uppercase tracking-[0.28em]"
                style={{ color: accent }}
              >
                {label}
              </span>
            </span>
            <p className="mt-1 font-display text-base md:text-lg font-black text-white leading-none">
              {countdown}
            </p>
            <p className="mt-1 text-[11px] text-white/60 leading-tight">
              {next.stage}
            </p>
          </div>

          {/* Versus block */}
          <div className="flex items-center gap-2">
            <span className="font-display text-xs font-black text-[var(--gold)] tracking-wider">
              KC
            </span>
            <span className="text-white/30 text-xs">vs</span>
            {oppLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={oppLogo}
                alt={next.opponentCode}
                className="h-7 w-7 object-contain rounded-md"
              />
            ) : (
              <span className="font-display text-xs font-black text-white tracking-wider">
                {next.opponentCode}
              </span>
            )}
          </div>
        </div>

        {/* Subtle right-edge shimmer to sell the "live" feel */}
        <span
          aria-hidden
          className="absolute inset-y-0 right-0 w-px"
          style={{
            background: `linear-gradient(180deg, transparent, ${accent}55, transparent)`,
          }}
        />
      </Link>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Masquer le prochain rendez-vous"
        className="pointer-events-auto absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white/70 transition-opacity opacity-0 group-hover:opacity-100 hover:opacity-100 hover:text-white focus-visible:opacity-100"
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatCountdown(ms: number, ctx: { live: boolean; soon: boolean }): string {
  if (ctx.live) return "Match en cours";
  if (ms <= 0) return "Match en cours";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);

  if (ctx.soon) {
    return mins <= 0 ? "\u00c0 la baballe !" : `dans ${mins} min`;
  }
  if (days > 0) {
    return hours > 0 ? `dans ${days}j ${hours}h` : `dans ${days}j`;
  }
  if (hours > 0) {
    return mins > 0 ? `dans ${hours}h ${mins}min` : `dans ${hours}h`;
  }
  return `dans ${mins} min`;
}

function noopForUpcomingType(_m: UpcomingMatch): void {
  // Type-import keeps tree-shaking honest without an unused-warning.
  void _m;
}
void noopForUpcomingType;
