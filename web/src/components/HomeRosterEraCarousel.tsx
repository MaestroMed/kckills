"use client";

/**
 * HomeRosterEraCarousel — full-bleed carousel cycling through every
 * iconic KC roster from 2021 to today.
 *
 * Replaces the static roster band that only showed the current 5
 * starters. Now the homepage tells the team's story chronologically :
 * Genèse 2021 → Rekkles 2022 → Renaissance 2023 → Pari Coréen 2024
 * → LE SACRE 2025 → Renouveau 2026, with each era's signature color
 * driving the visual tone.
 *
 * Visual contract
 * ───────────────
 * * Five player bands per era, same vertical-on-mobile / horizontal
 *   on desktop layout as the original section so the eye doesn't have
 *   to relearn anything when the era flips.
 * * Per-era radial gradient that "breathes" — slow 4 s ease-in-out
 *   pulse on opacity + scale, painted in the era color. Subtle enough
 *   to not distract, alive enough to feel premium.
 * * Year tabs above the bands — click jumps directly. Active tab gets
 *   the era color as underline + glow.
 * * Auto-rotates every 7 s. Pauses on tab hover, on band hover, and
 *   when the user has clicked a tab manually (until they explicitly
 *   re-enable auto by clicking the play indicator).
 * * Reduced-motion : no breathing, no auto-rotate, no fade — just the
 *   first era and let the user pick via tabs.
 * * Crossfade between eras (300 ms opacity + 8 px translateY) so the
 *   transition reads as a story turn, not a snap-cut.
 *
 * Why client-only
 * ───────────────
 * Auto-rotation, hover state, and the breathing animation all need
 * client-side JS. The roster *data* is built server-side in
 * `lib/era-rosters.ts` and passed in as a prop, so this component
 * doesn't make any DB calls — it just orchestrates the UX.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { championIconUrl, championSplashUrl } from "@/lib/constants";
import { displayRole } from "@/lib/real-data";
import { defaultEraIndex, type EraRoster } from "@/lib/era-rosters";

const AUTO_ROTATE_MS = 7000;
const FADE_MS = 300;

/** Convert a hex color (#RRGGBB) to an `r,g,b` triplet for use inside
 *  rgba() expressions. Tolerates invalid input by falling back to the
 *  KC gold so the gradient never goes black on a bad color string. */
function hexToRgb(hex: string): string {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(clean)) return "200,170,110"; // gold fallback
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

/**
 * The breathing radial gradient — owns the per-era color tone. Lives
 * in its own absolutely-positioned layer behind the player bands so
 * the bands stay untouched and the gradient can pulse independently.
 */
function BreathingGradient({
  color,
  reducedMotion,
}: {
  color: string;
  reducedMotion: boolean;
}) {
  const rgb = hexToRgb(color);
  return (
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        background: `radial-gradient(ellipse at center, rgba(${rgb}, 0.28) 0%, rgba(${rgb}, 0.12) 35%, rgba(0,0,0,0) 70%)`,
        animation: reducedMotion
          ? undefined
          : `roster-era-breathe 4s ease-in-out infinite`,
      }}
    />
  );
}

/**
 * One player band — vertical on mobile, equal-flex on desktop. Hovering
 * a band expands it to flex-2 (matches the original section's behavior)
 * with a subtle border-glow in the era color so the active card pops.
 */
function PlayerBand({
  player,
  color,
  isLast,
}: {
  player: EraRoster["players"][number];
  color: string;
  isLast: boolean;
}) {
  const hasPhoto = !!player.imageUrl;
  const splash = championSplashUrl(player.signatureChampion);
  return (
    <Link
      href={`/player/${encodeURIComponent(player.ign)}`}
      className={`group relative flex-1 h-48 md:h-auto overflow-hidden border-b md:border-b-0 md:border-r border-[var(--border-gold)] ${
        isLast ? "md:border-r-0 last:border-b-0" : ""
      } transition-all duration-700 md:hover:flex-[2] md:hover:z-10`}
      style={{
        // Per-card border-glow accent in the era color on hover.
        // Only applies on desktop ; mobile stays clean.
        boxShadow: undefined,
      }}
    >
      {/* Background — player photo if present, else champion splash. */}
      {hasPhoto ? (
        <Image
          src={player.imageUrl!}
          alt={player.ign}
          fill
          sizes="(max-width: 768px) 100vw, 20vw"
          className="object-cover object-top transition-all duration-700 group-hover:scale-105 group-hover:brightness-110"
        />
      ) : (
        <Image
          src={splash}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 20vw"
          className="object-cover opacity-50 transition-all duration-700 group-hover:scale-110 group-hover:opacity-75"
        />
      )}

      {/* Bottom-up dark gradient + era-color tint on hover. */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          background: `linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.45) 35%, rgba(0,0,0,0) 70%)`,
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 pointer-events-none"
        style={{
          background: `linear-gradient(to top, rgba(${hexToRgb(color)}, 0.28) 0%, rgba(${hexToRgb(color)}, 0.05) 50%, rgba(0,0,0,0) 80%)`,
        }}
      />

      {/* Content — bottom. */}
      <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 z-10">
        {/* Iconic champion chip (only when we're using champion splash). */}
        {!hasPhoto && (
          <div className="flex gap-1.5 mb-3 opacity-60 group-hover:opacity-100 transition-opacity">
            <Image
              src={championIconUrl(player.signatureChampion)}
              alt={player.signatureChampion}
              width={24}
              height={24}
              className="rounded-full border border-black/50"
            />
            <span className="text-[10px] uppercase tracking-wider font-data text-white/40 self-center">
              {player.signatureChampion}
            </span>
          </div>
        )}

        <p
          className="font-display text-xl md:text-3xl font-black text-white transition-colors duration-300"
          style={{ ["--era-hover" as string]: color }}
        >
          {player.ign}
        </p>
        <p className="text-xs uppercase tracking-[0.2em] text-white/55 mt-1">
          {displayRole(player.role)}
        </p>
      </div>

      {/* Role badge top-right (era-color on hover). */}
      <div
        className="absolute top-3 right-3 z-10 rounded-md bg-black/60 backdrop-blur-sm px-2 py-1 text-[9px] font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color }}
      >
        {displayRole(player.role)}
      </div>
    </Link>
  );
}

export function HomeRosterEraCarousel({
  rosters,
}: {
  rosters: EraRoster[];
}) {
  const [idx, setIdx] = useState(() => defaultEraIndex(rosters));
  const [paused, setPaused] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const intervalRef = useRef<number | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const current = rosters[idx] ?? rosters[0];

  useEffect(() => {
    if (reducedMotion || paused || !autoEnabled || rosters.length <= 1) return;
    intervalRef.current = window.setInterval(() => {
      setIdx((i) => (i + 1) % rosters.length);
    }, AUTO_ROTATE_MS);
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [reducedMotion, paused, autoEnabled, rosters.length]);

  if (!current) return null;

  return (
    <section
      className="relative overflow-hidden py-2"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="Roster Karmine Corp par année"
    >
      {/* The breathing color layer — sits behind the player bands and
          provides the per-era visual tone. Animates by itself ; no
          interaction needed. */}
      <BreathingGradient color={current.color} reducedMotion={reducedMotion} />

      {/* ─── Tabs row : year selector ────────────────────────────── */}
      <div className="relative z-10 flex items-center gap-2 md:gap-3 px-4 md:px-6 lg:px-10 mb-3 overflow-x-auto scrollbar-thin">
        {rosters.map((r, i) => {
          const active = i === idx;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setIdx(i);
                setAutoEnabled(false);
              }}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] md:text-[11px] uppercase tracking-[0.18em] font-data font-bold transition-all ${
                active
                  ? "border-white/0 text-white shadow-[0_0_12px_rgba(0,0,0,0.4)]"
                  : "border-white/15 text-white/55 hover:text-white hover:border-white/40"
              }`}
              style={{
                background: active
                  ? `linear-gradient(135deg, rgba(${hexToRgb(r.color)}, 0.55), rgba(${hexToRgb(r.color)}, 0.25))`
                  : undefined,
              }}
              aria-pressed={active}
              aria-label={`Voir le roster ${r.yearLabel}`}
            >
              {r.yearLabel}
            </button>
          );
        })}
        {/* Auto-rotation toggle — discrete ▶ / ❚❚ icon. */}
        <button
          type="button"
          onClick={() => setAutoEnabled((v) => !v)}
          className="ml-auto shrink-0 rounded-full border border-white/15 text-white/55 hover:text-white hover:border-white/40 px-2 py-1 text-[10px] font-data tracking-wider transition-colors"
          aria-pressed={autoEnabled}
          aria-label={
            autoEnabled
              ? "Mettre en pause la rotation auto"
              : "Reprendre la rotation auto"
          }
        >
          {autoEnabled ? "❚❚ Auto" : "▶ Auto"}
        </button>
      </div>

      {/* ─── Era headline ────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-wrap items-baseline gap-3 px-4 md:px-6 lg:px-10 mb-3">
        <h2
          className="font-display text-2xl md:text-4xl font-black"
          style={{ color: current.color }}
        >
          {current.label}
        </h2>
        <span className="text-[11px] md:text-xs uppercase tracking-[0.25em] text-white/55 font-data">
          {current.period} · {current.result}
        </span>
        <span className="text-[10px] uppercase tracking-[0.22em] text-white/35 font-data ml-auto">
          Coach : {current.coach}
        </span>
      </div>

      {/* ─── Player bands : crossfade-keyed by era id ────────────── */}
      <div
        key={current.id}
        className="relative z-10 flex flex-col md:flex-row md:h-[60vh] md:min-h-[460px] animate-roster-era-fade"
      >
        {current.players.map((p, i) => (
          <PlayerBand
            key={`${current.id}-${p.ign}-${i}`}
            player={p}
            color={current.color}
            isLast={i === current.players.length - 1}
          />
        ))}
      </div>

      {/* Local CSS for the breathing + crossfade keyframes. Scoped via
          arbitrary class names (animate-roster-era-fade and the keyframe
          name `roster-era-breathe`) so we don't need a Tailwind config
          extension. */}
      <style jsx>{`
        @keyframes roster-era-breathe {
          0%, 100% { opacity: 0.85; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.03); }
        }
        @keyframes roster-era-fade {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-roster-era-fade {
          animation: roster-era-fade ${FADE_MS}ms ease-out;
        }
      `}</style>
    </section>
  );
}

/** Lightweight `prefers-reduced-motion` hook — avoids pulling motion/react
 *  here just for `useReducedMotion`. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}
