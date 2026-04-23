"use client";

/**
 * HomeQuoteRotator — slow rotating real-citations panel for the homepage.
 *
 * The user's brief : "Une beauté unique venue d'ailleurs, écriture
 * progressivement qui se révèle, etc... laisse 10 secondes le temps de
 * lire, puis s'efface en partant en nuage de particule pour laisser la
 * place à une autre citation. Que des citations réelles par contre."
 *
 * Pipeline :
 *   1. Pick a random quote from src/lib/quotes.ts (verified real sources)
 *   2. Fade in the quotation marks + author affiliation
 *   3. Reveal the body text character-by-character (≈40ms/char ; ~2-3s
 *      for a typical quote ; respects prefers-reduced-motion)
 *   4. Hold for ~10s (8s for short quotes, 12s for long ones, capped)
 *   5. "Particle dissolve" : split text into spans, animate each span
 *      to a small drift + fade. CSS only — no canvas, no JS animation
 *      loop. The illusion is good enough for the "nuage de particule"
 *      brief, and stays at 60fps even on a mid-tier mobile.
 *   6. Pick the NEXT quote (cycles through, re-shuffles after a full pass)
 *
 * Why client component : useEffect-driven timing, intersection observer
 * to pause when off-screen, useState for the currently shown quote.
 *
 * Why ALL real quotes : the brief was explicit. We import the QUOTES
 * array from lib/quotes.ts which is already curated with verified
 * sources (stream timestamps, interviews, press conferences, tweets).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { QUOTES, type Quote } from "@/lib/quotes";

const REVEAL_MS_PER_CHAR = 35;
const HOLD_MS_BASE = 9000;          // base reading time
const HOLD_MS_PER_CHAR = 35;        // extra reading time per character
const DISSOLVE_MS = 1400;
const FADE_IN_MS = 700;

/** Fisher-Yates shuffle, deterministic per-render via the seed. */
function shuffle<T>(arr: T[], seed: number): T[] {
  const out = arr.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface Props {
  /** Optional subset (e.g. only player-scoped quotes for player pages). */
  quotes?: Quote[];
  /** Add a kicker line above the quote ("Voix de la fanbase", etc). */
  kicker?: string;
  /** Section min-height. Default ~280px gives the big quotes room without
   *  causing layout shift on shorter ones. */
  minHeight?: string;
}

export function HomeQuoteRotator({
  quotes = QUOTES,
  kicker = "▽ Citations · KC dans leurs propres mots",
  minHeight = "min-h-[280px] md:min-h-[320px]",
}: Props) {
  const [seed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const order = useMemo(() => shuffle(quotes, seed), [quotes, seed]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"reveal" | "hold" | "dissolve">("reveal");
  const [revealedChars, setRevealedChars] = useState(0);
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reduced = useRef(false);

  // Detect prefers-reduced-motion once
  useEffect(() => {
    if (typeof window === "undefined") return;
    reduced.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }, []);

  // Pause when off-screen — the rotator is only useful when visible.
  useEffect(() => {
    if (!containerRef.current || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      ([entry]) => setPaused(!entry.isIntersecting),
      { threshold: 0.25 },
    );
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const current = order[idx % order.length];
  const text = current?.text ?? "";

  // Reveal phase : type-in
  useEffect(() => {
    if (phase !== "reveal" || paused) return;
    if (reduced.current) {
      setRevealedChars(text.length);
      return;
    }
    if (revealedChars >= text.length) return;
    const t = window.setTimeout(
      () => setRevealedChars((c) => Math.min(text.length, c + 1)),
      REVEAL_MS_PER_CHAR,
    );
    return () => window.clearTimeout(t);
  }, [phase, revealedChars, text, paused]);

  // Phase transitions :
  //   reveal  -> hold     when all chars shown
  //   hold    -> dissolve after the hold duration
  //   dissolve -> reveal  for next quote after the dissolve duration
  useEffect(() => {
    if (paused) return;

    if (phase === "reveal" && revealedChars >= text.length && text.length > 0) {
      const hold = Math.min(HOLD_MS_BASE + text.length * HOLD_MS_PER_CHAR, 16_000);
      const t = window.setTimeout(() => setPhase("hold"), 200);
      const t2 = window.setTimeout(() => setPhase("dissolve"), 200 + hold);
      return () => {
        window.clearTimeout(t);
        window.clearTimeout(t2);
      };
    }

    if (phase === "dissolve") {
      const t = window.setTimeout(() => {
        setIdx((i) => (i + 1) % order.length);
        setRevealedChars(0);
        setPhase("reveal");
      }, DISSOLVE_MS);
      return () => window.clearTimeout(t);
    }
  }, [phase, revealedChars, text, paused, order.length]);

  if (!current) return null;

  const charsToShow = reduced.current ? text.length : revealedChars;

  return (
    <section
      ref={containerRef}
      className={`relative w-full ${minHeight} flex items-center justify-center px-6 py-12 md:py-16`}
    >
      {/* Hextech radial glow — separate layer so it doesn't dissolve */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 40%, rgba(200,170,110,0.08) 0%, transparent 65%)",
        }}
      />

      {/* Decorative top + bottom hairlines */}
      <span
        aria-hidden
        className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-40 md:w-64"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(200,170,110,0.6), transparent)",
        }}
      />
      <span
        aria-hidden
        className="absolute bottom-0 left-1/2 -translate-x-1/2 h-px w-40 md:w-64"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(200,170,110,0.4), transparent)",
        }}
      />

      <div className="relative max-w-3xl mx-auto text-center">
        {kicker && (
          <p className="font-data text-[10px] uppercase tracking-[0.4em] text-[var(--gold)]/70 mb-6 transition-opacity duration-700">
            {kicker}
          </p>
        )}

        {/* Big decorative quote mark */}
        <span
          aria-hidden
          className="block font-display text-6xl md:text-7xl leading-none text-[var(--gold)]/30 select-none mb-2"
          style={{
            opacity: phase === "dissolve" ? 0 : 1,
            transition: `opacity ${DISSOLVE_MS}ms ease`,
          }}
        >
          &ldquo;
        </span>

        {/* The quote — letters revealed one by one, then dissolve */}
        <blockquote className="px-2">
          <p
            className="font-display text-xl md:text-3xl lg:text-4xl leading-snug font-medium text-white/95"
            aria-live="polite"
          >
            {text.split("").map((ch, i) => {
              const visible = i < charsToShow;
              const dissolving = phase === "dissolve";
              // Each character is its own span so we can animate them
              // independently for the "particle dissolve" effect.
              // The transform deltas are deterministic from the index
              // so the dissolve always looks the same — natural, but
              // not random-jittery between renders.
              const dx = ((i * 17) % 60) - 30;          // -30 .. +30 px
              const dy = -((i * 13) % 80) - 8;          // -88 .. -8 px (always up)
              const rot = ((i * 23) % 30) - 15;         // -15 .. +15 deg
              return (
                <span
                  key={i}
                  className="inline-block"
                  style={{
                    opacity: dissolving ? 0 : visible ? 1 : 0,
                    transform: dissolving
                      ? `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(0.6)`
                      : "translate(0,0) rotate(0) scale(1)",
                    transition: dissolving
                      ? `opacity ${DISSOLVE_MS}ms ease-out, transform ${DISSOLVE_MS}ms cubic-bezier(.4,.0,.2,1) ${(i * 6) % 200}ms`
                      : `opacity ${FADE_IN_MS}ms ease`,
                    willChange: "transform, opacity",
                  }}
                >
                  {ch === " " ? "\u00A0" : ch}
                </span>
              );
            })}
            {/* Blinking cursor while revealing */}
            {phase === "reveal" && charsToShow < text.length && !reduced.current && (
              <span className="inline-block w-[2px] h-[1em] align-middle bg-[var(--gold)] ml-1 animate-pulse" />
            )}
          </p>
        </blockquote>

        {/* Author + source — fades in last, dissolves first */}
        <footer
          className="mt-8 transition-all duration-700"
          style={{
            opacity: phase === "dissolve" ? 0 : charsToShow >= text.length ? 1 : 0,
            transform:
              phase === "dissolve"
                ? "translateY(-8px)"
                : charsToShow >= text.length
                  ? "translateY(0)"
                  : "translateY(8px)",
          }}
        >
          <p className="font-display text-base md:text-lg font-bold text-[var(--gold)]">
            {current.author}
          </p>
          <p className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] mt-1">
            {current.role}
            {current.date && (
              <>
                {" "}·{" "}
                <span className="text-[var(--text-disabled)]">{current.date}</span>
              </>
            )}
          </p>
          {current.source && (
            <p className="mt-2 text-[10px] italic text-[var(--text-disabled)]">
              {current.source}
            </p>
          )}
        </footer>

        {/* Pagination dots — quiet UI for "you are on quote N of M" */}
        <div className="mt-8 flex items-center justify-center gap-1.5">
          {order.slice(0, Math.min(order.length, 7)).map((_, i) => {
            const local = idx % order.length;
            const offset = (i - local % 7 + 7) % 7;
            const isActive = i === local % 7;
            return (
              <span
                key={i}
                aria-hidden
                className={`h-1 rounded-full transition-all duration-500 ${
                  isActive ? "w-6 bg-[var(--gold)]" : "w-1 bg-white/15"
                }`}
                style={{ opacity: 1 - offset * 0.05 }}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
