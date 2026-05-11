"use client";

/**
 * EntryCeremony — Wave 26 redesign of the Antre's entrance.
 *
 * Replaces the old "darken → losange → fissure → shatter" hextech-flavored
 * sequence with a 5-second cinematic that fits the new vintage gentlemen's-
 * club identity :
 *
 *   0 – 0.8s   keyhole appears center-screen (warm brass glow)
 *   0.8 – 2.0s slow zoom into the keyhole — cave glimpsed through it
 *   2.0 – 3.2s keyhole grows ×8, curtains pull aside from center
 *   3.2 – 4.5s brass plate descends from above on chains, cave fades in
 *   4.5 – 5.0s pipe smoke drifts in from the right ; rooms unlock
 *
 * `prefers-reduced-motion: reduce` collapses the entire sequence to a
 * 400ms cross-fade with the brass plate already settled.
 *
 * Performance : all transforms are translate3d / scale, willChange is set
 * on the long-running ones. Particles capped at 28 (dust) + 12 (smoke).
 */

import { useEffect, useMemo, useState } from "react";
import { m, AnimatePresence, useReducedMotion } from "motion/react";

export type EntryPhase =
  | "blackout"   // 0      → 0.05s  hard black + faint keyhole hint
  | "keyhole"    // 0.05s  → 0.8s   keyhole shimmers in
  | "peek"       // 0.8s   → 2.0s   slow zoom toward the keyhole
  | "open"       // 2.0s   → 3.2s   curtains pull aside
  | "settle"     // 3.2s   → 4.5s   brass plate descends, cave fades in
  | "cave";      // ≥ 4.5s          ceremony complete

const PHASE_TIMINGS: Record<EntryPhase, number> = {
  blackout: 0,
  keyhole: 50,
  peek: 800,
  open: 2000,
  settle: 3200,
  cave: 4500,
};

/** Coarse rustle SFX — short pink-noise burst with band-pass at ~600 Hz.
 *  Gated on a user gesture (the b-c-c ritual that opened the cave). Fires
 *  exactly once when the curtains start moving. Best-effort : if Web Audio
 *  is unavailable we silently no-op (we're not allowed to break entry). */
function playCurtainRustle() {
  if (typeof window === "undefined") return;
  try {
    const Ctor = window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    const dur = 0.8;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, Math.floor(sampleRate * dur), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      // Decaying pink-ish noise (random walk).
      const env = Math.pow(1 - i / data.length, 1.6);
      data[i] = (Math.random() * 2 - 1) * env * 0.6;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 620;
    band.Q.value = 1.4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.1);
    // Close the context after the SFX so we don't leak audio nodes.
    window.setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, (dur + 0.5) * 1000);
  } catch {
    /* fail silent — never block the ceremony */
  }
}

interface EntryCeremonyProps {
  onComplete: () => void;
}

export function EntryCeremony({ onComplete }: EntryCeremonyProps) {
  const prefersReducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<EntryPhase>("blackout");

  useEffect(() => {
    if (prefersReducedMotion) {
      // 400ms cross-fade with the brass plate text already in place.
      const t = window.setTimeout(() => { setPhase("cave"); onComplete(); }, 400);
      return () => window.clearTimeout(t);
    }

    const timers: number[] = [];
    (Object.keys(PHASE_TIMINGS) as EntryPhase[]).forEach((p) => {
      const delay = PHASE_TIMINGS[p];
      if (delay === 0) return;
      timers.push(window.setTimeout(() => {
        setPhase(p);
        if (p === "open") playCurtainRustle();
        if (p === "cave") onComplete();
      }, delay));
    });
    return () => { timers.forEach((t) => window.clearTimeout(t)); };
  }, [prefersReducedMotion, onComplete]);

  // 28 dust motes seeded once so re-renders don't reroll positions.
  const dust = useMemo(() => Array.from({ length: 28 }, () => ({
    x: Math.random() * 100,
    yStart: 100 + Math.random() * 30,
    delay: Math.random() * 1.6,
    duration: 6 + Math.random() * 4,
    size: 1.5 + Math.random() * 2,
    drift: (Math.random() - 0.5) * 40,
  })), []);

  if (prefersReducedMotion) {
    return (
      <m.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 30%, #2a1a0c 0%, #1a0e07 60%, #08040a 100%)",
        }}
      />
    );
  }

  const showKeyhole = phase !== "blackout" && phase !== "cave";
  const showCurtains = phase === "open" || phase === "settle";
  const curtainsOpen = phase === "settle";

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
      {/* ─── Black overlay (always present, fades out by `settle`) ── */}
      <m.div
        className="absolute inset-0"
        initial={{ opacity: 1 }}
        animate={{ opacity: phase === "settle" || phase === "cave" ? 0 : 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        style={{ background: "#02020a" }}
      />

      {/* ─── Cave glimpse seen THROUGH the keyhole during peek ─── */}
      <AnimatePresence>
        {(phase === "peek" || phase === "open") && (
          <m.div
            key="cave-glimpse"
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            exit={{ opacity: 1, transition: { duration: 0.4 } }}
            transition={{ duration: 0.8 }}
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse 30% 30% at 50% 50%, rgba(240,193,74,0.45) 0%, rgba(212,154,74,0.2) 30%, rgba(120,70,20,0.05) 60%, transparent 80%)",
                filter: "blur(2px)",
              }}
            />
          </m.div>
        )}
      </AnimatePresence>

      {/* ─── Keyhole + brass keyplate (the centerpiece of phases 1-3) ─── */}
      <AnimatePresence>
        {showKeyhole && (
          <m.div
            key="keyhole-wrap"
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{
              opacity: 1,
              scale:
                phase === "keyhole" ? 1 :
                phase === "peek"    ? 1.8 :
                phase === "open"    ? 8.5 : 12,
            }}
            exit={{ opacity: 0, scale: 14, transition: { duration: 0.5 } }}
            transition={{
              duration: phase === "open" ? 1.2 : phase === "peek" ? 1.2 : 0.8,
              ease: phase === "open" ? [0.7, 0, 0.6, 1] : [0.16, 1, 0.3, 1],
            }}
            style={{ willChange: "transform, opacity" }}
          >
            <div className="relative" style={{ width: 96, height: 144 }}>
              <div className="antre-keyplate" />
              {/* keyhole itself */}
              <m.div
                className="antre-keyhole antre-candle-light"
                style={{
                  position: "absolute",
                  left: "50%", top: "50%",
                  transform: "translate(-50%, -50%)",
                  willChange: "filter, opacity",
                }}
              />
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {/* ─── Curtains pulling aside ─── */}
      <AnimatePresence>
        {showCurtains && (
          <>
            <m.div
              key="curtain-l"
              className="antre-curtain antre-curtain-left"
              initial={{ x: 0 }}
              animate={{ x: curtainsOpen ? "-105%" : 0 }}
              exit={{ x: "-110%" }}
              transition={{ duration: 1.4, ease: [0.7, 0, 0.4, 1] }}
              style={{ willChange: "transform" }}
            />
            <m.div
              key="curtain-r"
              className="antre-curtain antre-curtain-right"
              initial={{ x: 0 }}
              animate={{ x: curtainsOpen ? "105%" : 0 }}
              exit={{ x: "110%" }}
              transition={{ duration: 1.4, ease: [0.7, 0, 0.4, 1] }}
              style={{ willChange: "transform" }}
            />
            {/* Tasseled rope swings as the curtains move */}
            {curtainsOpen && (
              <m.div
                key="tassel"
                className="absolute top-0 left-1/2 -translate-x-1/2"
                initial={{ rotate: -8 }}
                animate={{ rotate: [-8, 6, -3, 2, 0] }}
                transition={{ duration: 1.8, ease: "easeOut" }}
                style={{ width: 4, height: 80, transformOrigin: "top center" }}
              >
                <div style={{
                  position: "absolute", left: 0, right: 0, top: 0, height: 80,
                  background: "linear-gradient(180deg, #a07533, #6b4a1c)",
                }} />
                <div style={{
                  position: "absolute", left: -10, right: -10, top: 78, height: 18,
                  borderRadius: "0 0 50% 50%",
                  background:
                    "radial-gradient(ellipse at 50% 0%, #c89a4a 0%, #6b4a1c 100%)",
                  boxShadow: "0 4px 8px rgba(0,0,0,0.5)",
                }} />
              </m.div>
            )}
          </>
        )}
      </AnimatePresence>

      {/* ─── Drifting dust motes (continuous from `peek` onward) ─── */}
      {(phase === "peek" || phase === "open" || phase === "settle") &&
        dust.slice(0, phase === "peek" ? 14 : 28).map((d, i) => (
          <span
            key={`dust-${i}`}
            className="absolute rounded-full"
            style={{
              left: `${d.x}%`,
              top: 0,
              width: d.size,
              height: d.size,
              background: "rgba(240, 193, 74, 0.6)",
              boxShadow: "0 0 4px rgba(240, 193, 74, 0.55)",
              animation: `antreDustFall ${d.duration}s linear ${d.delay}s infinite`,
              willChange: "transform, opacity",
            }}
          />
        ))}
    </div>
  );
}
