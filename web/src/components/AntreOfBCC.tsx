"use client";

/**
 * AntreOfBCC — the hidden fan cave (Wave 25.3 / V59).
 *
 * Unlocked by typing B-C-C on Bo's player page. Award-winning entry
 * animation grade : 5-phase ceremony (darken → audio → losange pulse →
 * fissure → shatter → cave reveal) running on motion/react timelines.
 *
 * Five rooms, single component, no separate routes :
 *   A) Coup de Poing    — global idle clicker, batched fn_bcc_punch RPC
 *   B) Scouting Lab     — live KR Challenger ladder (Riot API proxy)
 *   C) Stark Culture    — daily-rotating editorial quote (deterministic)
 *   D) Lance-tomates    — Zaboutine sticker with parabolic tomato arcs
 *   E) Mur des Ahou Ahou — Kyeahoo kill grid, hover plays the sample
 *
 * All audio gates on user interaction (Chrome autoplay policy). Web
 * Audio fallback synthesises a tone when the asset MP3 is missing
 * (so the cave works before Mehdi drops in the real samples).
 *
 * Performance :
 *   - LazyMotion + `m.` prefix from motion/react (configured globally
 *     in Providers.tsx, ~18 KB diff vs motion).
 *   - `will-change: transform, opacity` on the entry losange + tomatoes.
 *   - `prefers-reduced-motion: reduce` → skip the ceremony, snap into
 *     the cave with a 200ms cross-fade.
 *
 * Assets that the user will supply later (paths referenced, files TBD) :
 *   - /audio/ahou-ahou.mp3    (TODO: source from N'Seven7 "OTT" 0:00-0:03,
 *                              YouTube id YNzvHb92xqY)
 *   - /audio/thunk.mp3        (TODO: punch sound, fallback to Web Audio)
 *   - /audio/tomato-splat.mp3 (TODO: splat sound, fallback to Web Audio)
 *   - /images/zaboutine-sticker.png (TODO: portrait sticker, placeholder
 *                                    grey rect with text until provided)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { m, AnimatePresence, useReducedMotion } from "motion/react";

import { createClient } from "@/lib/supabase/client";
import { getBCCSessionHash } from "@/lib/bcc-state";
import {
  getTodaysStarkCultureEntry,
  type StarkCultureEntry,
} from "@/lib/stark-culture";
import { championIconUrl } from "@/lib/constants";
import type { BCCKrLadderResponse } from "@/app/api/bcc/kr-ladder/route";

interface AntreOfBCCProps {
  onClose: () => void;
}

// ════════════════════════════════════════════════════════════════════
// Entry ceremony — 5-phase timeline (~3 s total)
// ════════════════════════════════════════════════════════════════════

type EntryPhase =
  | "darken"      // 0 → 0.3s  (black curtain + background blur)
  | "audio"       // 0.3 → 0.7s (silence broken by ahou-ahou)
  | "pulse"       // 0.7 → 1.5s (golden hextech losange + blue/cyan glow)
  | "fissure"     // 1.5 → 2.5s (crack lines + gold sparks)
  | "shatter"     // 2.5 → 3.0s (losange explodes, cave revealed)
  | "cave";       // ≥ 3.0s     (cave fully visible, ceremony done)

const PHASE_TIMINGS: Record<EntryPhase, number> = {
  darken: 0,
  audio: 300,
  pulse: 700,
  fissure: 1500,
  shatter: 2500,
  cave: 3000,
};

// ════════════════════════════════════════════════════════════════════
// Audio helpers — Web Audio fallbacks when the MP3 asset is missing
// ════════════════════════════════════════════════════════════════════

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedAudioCtx && sharedAudioCtx.state !== "closed") return sharedAudioCtx;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    sharedAudioCtx = new Ctor();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/** Soft low-frequency thunk used for the "+1 coup de poing" feedback. */
function playThunkFallback() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, t0);
  osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.12);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.18);
}

/** Splat — short burst of pink noise then a low click. */
function playSplatFallback() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const t0 = ctx.currentTime;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * 0.12));
  const noise = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    // Decaying noise envelope = "ssspat".
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.4, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
  src.connect(gain).connect(ctx.destination);
  src.start(t0);
}

/** Plays an audio file if it exists ; falls back to the Web Audio
 *  synthesiser. Both gates on a recent user gesture (the caller must
 *  invoke this from a click/keydown handler). */
function playWithFallback(
  src: string,
  fallback: () => void,
  volume = 0.7,
): Promise<void> {
  return new Promise((resolve) => {
    try {
      const audio = new Audio(src);
      audio.volume = volume;
      audio.addEventListener(
        "error",
        () => {
          fallback();
          resolve();
        },
        { once: true },
      );
      audio.addEventListener("ended", () => resolve(), { once: true });
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.catch(() => {
          fallback();
          resolve();
        });
      }
    } catch {
      fallback();
      resolve();
    }
  });
}

// ════════════════════════════════════════════════════════════════════
// Kill type for the Kyeahoo wall
// ════════════════════════════════════════════════════════════════════

interface KyeahooKill {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  killer_name: string | null;
  victim_name: string | null;
  clip_url_vertical: string | null;
  clip_url_vertical_low: string | null;
  clip_url_horizontal: string | null;
  thumbnail_url: string | null;
  highlight_score: number | null;
  avg_rating: number | null;
  rating_count: number | null;
  ai_description: string | null;
  multi_kill: string | null;
  is_first_blood: boolean | null;
  created_at: string;
}

// ════════════════════════════════════════════════════════════════════
// Root component
// ════════════════════════════════════════════════════════════════════

export function AntreOfBCC({ onClose }: AntreOfBCCProps) {
  const prefersReducedMotion = useReducedMotion();

  // ─── Entry phase state machine ────────────────────────────────────
  const [phase, setPhase] = useState<EntryPhase>("darken");

  useEffect(() => {
    if (prefersReducedMotion) {
      // Skip the ceremony entirely. The fade-in for the cave is handled
      // by the cave's own AnimatePresence.
      setPhase("cave");
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    (Object.keys(PHASE_TIMINGS) as EntryPhase[]).forEach((p) => {
      const delay = PHASE_TIMINGS[p];
      if (delay === 0) return;
      timers.push(setTimeout(() => setPhase(p), delay));
    });

    // Fire the ahou-ahou sample at phase "audio" start. It MUST run
    // here (inside a user-triggered effect chain) for Chrome autoplay
    // policy : the keydown → setState → effect chain still counts as a
    // user-gesture-originated activation.
    const ahouTimer = setTimeout(() => {
      // TODO: source from N'Seven7 "OTT" 0:00-0:03 (YouTube id YNzvHb92xqY)
      playWithFallback("/audio/ahou-ahou.mp3", playThunkFallback, 0.85)
        .catch(() => {});
    }, PHASE_TIMINGS.audio);
    timers.push(ahouTimer);

    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, [prefersReducedMotion]);

  // ─── ESC + "OUT" keyboard close ───────────────────────────────────
  useEffect(() => {
    const outBuffer: string[] = [];
    let bufferTimer: ReturnType<typeof setTimeout> | null = null;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k.length !== 1) return;
      outBuffer.push(k);
      while (outBuffer.length > 3) outBuffer.shift();
      if (bufferTimer) clearTimeout(bufferTimer);
      bufferTimer = setTimeout(() => {
        outBuffer.length = 0;
      }, 1800);
      if (outBuffer.join("") === "out") {
        outBuffer.length = 0;
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (bufferTimer) clearTimeout(bufferTimer);
    };
  }, [onClose]);

  // Body-scroll lock while the cave is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const showCave = phase === "cave" || phase === "shatter";

  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden" role="dialog" aria-modal="true" aria-label="Antre de la BCC">
      <EntryCeremony phase={phase} prefersReducedMotion={!!prefersReducedMotion} />
      {showCave && (
        <CaveDashboard
          onClose={onClose}
          shouldFadeIn={phase === "cave"}
          prefersReducedMotion={!!prefersReducedMotion}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// EntryCeremony — the award-winning 5-phase animation
// ════════════════════════════════════════════════════════════════════

function EntryCeremony({
  phase,
  prefersReducedMotion,
}: {
  phase: EntryPhase;
  prefersReducedMotion: boolean;
}) {
  // After "shatter" the cave takes over the foreground ; the ceremony
  // layer keeps drawing the receding sparks behind.
  const showLosange = phase !== "darken" && phase !== "cave";
  const cracked = phase === "fissure" || phase === "shatter";
  const shattered = phase === "shatter";

  // Generate spark particle positions ONCE per render so the random()
  // doesn't re-roll between phases. 24 sparks fan out from the centre.
  const sparks = useMemo(() => {
    const out: { angle: number; distance: number; delay: number; size: number }[] = [];
    for (let i = 0; i < 24; i += 1) {
      out.push({
        angle: (i / 24) * Math.PI * 2 + Math.random() * 0.2,
        distance: 220 + Math.random() * 180,
        delay: Math.random() * 0.25,
        size: 4 + Math.random() * 6,
      });
    }
    return out;
  }, []);

  if (prefersReducedMotion) {
    return (
      <m.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-[var(--bg-primary)]"
      />
    );
  }

  return (
    <>
      {/* ─── Phase 1 : darken curtain (always present) ──────────────── */}
      <m.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, #050b18 0%, #010A13 60%, #000000 100%)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      />

      {/* ─── Phase 3-5 : losange + glow + cracks ─────────────────────── */}
      <AnimatePresence>
        {showLosange && !shattered && (
          <m.div
            key="losange-wrap"
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
          >
            {/* Outer cyan/blue rays — concentric expanding rings */}
            {[1, 2, 3, 4].map((i) => (
              <m.div
                key={`ring-${i}`}
                className="absolute"
                style={{
                  width: `${i * 110}px`,
                  height: `${i * 110}px`,
                  border: "2px solid",
                  borderColor:
                    i % 2 === 0
                      ? "rgba(0, 87, 255, 0.35)"
                      : "rgba(10, 200, 185, 0.3)",
                  transform: "rotate(45deg)",
                  borderRadius: "8px",
                  willChange: "transform, opacity",
                }}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{
                  scale: [0.4, 1.6, 2.4],
                  opacity: [0, 0.7, 0],
                }}
                transition={{
                  duration: 1.8,
                  delay: i * 0.15,
                  repeat: cracked ? 0 : Infinity,
                  ease: "easeOut",
                }}
              />
            ))}

            {/* Inner golden losange — the centerpiece */}
            <m.div
              className="relative"
              style={{
                width: 120,
                height: 120,
                transform: "rotate(45deg)",
                background:
                  "linear-gradient(135deg, #F0E6D2 0%, #C8AA6E 50%, #785A28 100%)",
                boxShadow:
                  "0 0 60px rgba(200,170,110,0.7), 0 0 120px rgba(200,170,110,0.4), 0 0 200px rgba(0,87,255,0.3)",
                borderRadius: "8px",
                willChange: "transform, box-shadow",
              }}
              initial={{ scale: 0, rotate: 45 }}
              animate={{
                scale: cracked ? [1, 1.15, 1.05] : [0, 1, 1.05, 1],
                boxShadow: cracked
                  ? [
                      "0 0 60px rgba(200,170,110,0.7), 0 0 120px rgba(200,170,110,0.4), 0 0 200px rgba(0,87,255,0.3)",
                      "0 0 90px rgba(232,64,87,0.6), 0 0 160px rgba(200,170,110,0.5), 0 0 240px rgba(10,200,185,0.4)",
                      "0 0 120px rgba(200,170,110,0.9), 0 0 200px rgba(0,87,255,0.4), 0 0 280px rgba(10,200,185,0.5)",
                    ]
                  : undefined,
              }}
              transition={{
                duration: cracked ? 0.8 : 0.6,
                ease: cracked
                  ? [0.16, 1, 0.3, 1]
                  : [0.34, 1.56, 0.64, 1],
              }}
            >
              {/* Fissure cracks — SVG lines stroked white-gold,
                  animated drawing via strokeDashoffset. */}
              {cracked && (
                <svg
                  viewBox="0 0 120 120"
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{ overflow: "visible" }}
                >
                  {[
                    "M60 60 L20 25 L10 5",
                    "M60 60 L100 35 L115 10",
                    "M60 60 L95 95 L120 110",
                    "M60 60 L25 100 L5 115",
                    "M60 60 L60 10 L55 0",
                    "M60 60 L110 60 L120 65",
                    "M60 60 L60 110 L65 120",
                    "M60 60 L10 60 L0 55",
                  ].map((d, i) => (
                    <m.path
                      key={`crack-${i}`}
                      d={d}
                      stroke="#F0E6D2"
                      strokeWidth="1.5"
                      fill="none"
                      strokeLinecap="round"
                      style={{ filter: "drop-shadow(0 0 4px #F0E6D2)" }}
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{
                        duration: 0.6,
                        delay: 0.05 * i,
                        ease: "easeOut",
                      }}
                    />
                  ))}
                </svg>
              )}

              {/* "BCC" sigil inside the losange — counter-rotated so it
                  reads upright even though the parent is at 45°. */}
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ transform: "rotate(-45deg)" }}
              >
                <span
                  className="font-display font-black text-2xl"
                  style={{
                    color: "rgba(1,10,19,0.85)",
                    letterSpacing: "0.05em",
                    textShadow: "0 1px 0 rgba(240,230,210,0.5)",
                  }}
                >
                  BCC
                </span>
              </div>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>

      {/* ─── Phase 5 : shatter sparks ───────────────────────────────── */}
      <AnimatePresence>
        {shattered && (
          <m.div
            key="sparks"
            className="absolute inset-0 pointer-events-none flex items-center justify-center"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {sparks.map((s, i) => {
              const tx = Math.cos(s.angle) * s.distance;
              const ty = Math.sin(s.angle) * s.distance;
              return (
                <m.div
                  key={`spark-${i}`}
                  className="absolute"
                  style={{
                    width: s.size,
                    height: s.size,
                    background:
                      "radial-gradient(circle, #F0E6D2 0%, #C8AA6E 60%, transparent 100%)",
                    borderRadius: "50%",
                    boxShadow: "0 0 12px rgba(240,230,210,0.9)",
                    willChange: "transform, opacity",
                  }}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                  animate={{
                    x: tx,
                    y: ty,
                    opacity: 0,
                    scale: 0.3,
                  }}
                  transition={{
                    duration: 0.9,
                    delay: s.delay,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                />
              );
            })}
            {/* Whoosh sweep — radial light flash centered on the losange */}
            <m.div
              className="absolute inset-0 pointer-events-none"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: [0, 0.75, 0], scale: [0.5, 2.5, 3.2] }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              style={{
                background:
                  "radial-gradient(circle, rgba(240,230,210,0.85) 0%, rgba(200,170,110,0.4) 30%, transparent 60%)",
              }}
            />
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// CaveDashboard — the 5 rooms once the ceremony is done
// ════════════════════════════════════════════════════════════════════

function CaveDashboard({
  onClose,
  shouldFadeIn,
  prefersReducedMotion,
}: {
  onClose: () => void;
  shouldFadeIn: boolean;
  prefersReducedMotion: boolean;
}) {
  const sessionHashRef = useRef<string>("bcc-ssr-placeholder-hash");
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  useEffect(() => {
    sessionHashRef.current = getBCCSessionHash();
    supabaseRef.current = createClient();
  }, []);

  return (
    <m.div
      className="absolute inset-0 overflow-y-auto"
      initial={shouldFadeIn ? { opacity: 0 } : { opacity: 1 }}
      animate={{ opacity: 1 }}
      transition={{
        duration: prefersReducedMotion ? 0.2 : 0.6,
        ease: [0.16, 1, 0.3, 1],
      }}
      style={{
        background: "var(--bg-primary)",
        // Subtle hextech losange pattern via inline SVG. Very low
        // opacity so it doesn't compete with the rooms.
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23C8AA6E' stroke-width='0.6' stroke-opacity='0.06'%3E%3Cpath d='M40 8 L72 40 L40 72 L8 40 Z'/%3E%3Cpath d='M40 28 L52 40 L40 52 L28 40 Z'/%3E%3C/g%3E%3C/svg%3E")`,
      }}
    >
      {/* ─── Header ───────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 backdrop-blur-md border-b border-[var(--border-gold)]"
        style={{
          background:
            "linear-gradient(180deg, rgba(1,10,19,0.95) 0%, rgba(1,10,19,0.75) 100%)",
        }}
      >
        <div className="max-w-7xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="hidden sm:inline-block"
              style={{
                width: 12,
                height: 12,
                transform: "rotate(45deg)",
                background:
                  "linear-gradient(135deg, var(--gold), var(--gold-dark))",
                boxShadow: "0 0 12px rgba(200,170,110,0.55)",
              }}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="font-data text-[9px] uppercase tracking-[0.4em] text-[var(--gold)]/70">
                Bronze Consulting Company
              </p>
              <h1
                className="font-display font-black text-xl sm:text-2xl truncate"
                style={{
                  background:
                    "linear-gradient(135deg, #F0E6D2 0%, #C8AA6E 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  letterSpacing: "0.02em",
                }}
              >
                L&apos;Antre de la BCC
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden md:inline font-data text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
              Tape <kbd className="px-1.5 py-0.5 rounded border border-[var(--border-gold)] text-[var(--gold)]">OUT</kbd> ou ESC
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Quitter l'Antre"
              className="rounded-full p-2 border border-[var(--border-gold)] bg-black/40 hover:bg-[var(--gold)]/10 hover:border-[var(--gold)]/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
            >
              <svg className="h-4 w-4 text-[var(--gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {/* Gold ribbon under the header — Hextech accent. */}
        <div className="h-px w-full" style={{ background: "linear-gradient(90deg, transparent, var(--gold), transparent)" }} />
      </header>

      <main className="max-w-7xl mx-auto px-5 py-10 space-y-14">
        <Intro />
        <CoupDePoingRoom
          sessionHashRef={sessionHashRef}
          supabaseRef={supabaseRef}
        />
        <ScoutingLabRoom />
        <StarkCultureRoom
          sessionHashRef={sessionHashRef}
          supabaseRef={supabaseRef}
        />
        <LanceTomatesRoom
          sessionHashRef={sessionHashRef}
          supabaseRef={supabaseRef}
        />
        <MurDesAhouRoom
          sessionHashRef={sessionHashRef}
          supabaseRef={supabaseRef}
        />

        {/* Disclaimer Riot — required on every public page */}
        <p
          aria-label="Riot Games disclaimer"
          className="pt-6 text-center text-[9px] uppercase tracking-widest text-white/30 border-t border-[var(--border-subtle)]"
        >
          Not endorsed by Riot Games. League of Legends © Riot Games.
        </p>
      </main>
    </m.div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Intro card — explains the cave, sets the tone
// ════════════════════════════════════════════════════════════════════

function Intro() {
  return (
    <section className="text-center pt-2">
      <p className="font-data text-[10px] uppercase tracking-[0.4em] text-[var(--gold)]/70 mb-3">
        Entrée par invitation · Wave 25.3
      </p>
      <h2
        className="font-display font-black text-3xl sm:text-5xl leading-[0.95] mb-4"
        style={{
          color: "var(--text-primary)",
          textShadow:
            "0 0 40px rgba(200,170,110,0.25), 0 4px 30px rgba(0,0,0,0.6)",
        }}
      >
        Bienvenue dans l&apos;Antre.
      </h2>
      <p className="mx-auto max-w-2xl text-base text-white/75 leading-relaxed">
        Salle privée de la <strong className="text-[var(--gold)]">Bronze Consulting Company</strong> &mdash;
        la communauté d&apos;EtoStark. Cinq pièces, un seul mantra : <em>ahou ahou ahou</em>.
      </p>
      <p className="mx-auto max-w-xl mt-3 text-xs text-[var(--text-muted)]">
        Tout ce que tu fais ici (coups, tomates, hover sur les ahou-ahou) est compté
        en temps réel à l&apos;échelle de la BCC entière.
      </p>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Room A — Coup de Poing
// ════════════════════════════════════════════════════════════════════

const PUNCH_FLUSH_DELAY_MS = 500;
const PUNCH_POLL_MS = 3000;
const PUNCH_BATCH_MAX = 100; // RPC accepts 1..100 per call

interface RpcRefs {
  sessionHashRef: React.MutableRefObject<string>;
  supabaseRef: React.MutableRefObject<ReturnType<typeof createClient> | null>;
}

function CoupDePoingRoom({ sessionHashRef, supabaseRef }: RpcRefs) {
  const [localCount, setLocalCount] = useState(0);
  const [globalCount, setGlobalCount] = useState<number | null>(null);
  const [pendingBatch, setPendingBatch] = useState(0);
  // Last RPC-confirmed batch — used to animate a "+N" floater on success.
  const [lastFloater, setLastFloater] = useState<{ key: number; value: number } | null>(null);

  const flushTimerRef = useRef<number | null>(null);
  const pendingRef = useRef(0);
  const recentClicksRef = useRef<number[]>([]);

  // ─── Poll the global counter every 3 s ──────────────────────────
  useEffect(() => {
    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;
    let cancelled = false;

    async function poll() {
      try {
        const { data } = await sb
          .from("bcc_punches")
          .select("count")
          .eq("id", "global")
          .single();
        if (!cancelled && data && typeof data.count === "number") {
          setGlobalCount(data.count);
        } else if (!cancelled && data && typeof data.count === "string") {
          // Postgres BIGINT can serialize as string when very large.
          const parsed = Number(data.count);
          if (!Number.isNaN(parsed)) setGlobalCount(parsed);
        }
      } catch {
        // network blip — keep the last good value
      }
    }
    poll();
    const interval = window.setInterval(poll, PUNCH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [supabaseRef]);

  // ─── Flush pending punches every 500 ms ─────────────────────────
  const flush = useCallback(async () => {
    const batch = pendingRef.current;
    if (batch <= 0) return;
    pendingRef.current = 0;
    setPendingBatch(0);

    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;

    // Cap each individual RPC at PUNCH_BATCH_MAX. If the user clicks
    // > 100 times in a single 500 ms window (impressive — auto-clicker
    // territory), we'd split into multiple calls. Realistically the
    // SQL rate-limit caps the user at 100/10s anyway, so one call is
    // almost always enough.
    const chunks: number[] = [];
    let remaining = batch;
    while (remaining > 0) {
      const take = Math.min(remaining, PUNCH_BATCH_MAX);
      chunks.push(take);
      remaining -= take;
    }

    for (const chunk of chunks) {
      try {
        const { data, error } = await sb.rpc("fn_bcc_punch", {
          p_session_hash: sessionHashRef.current,
          p_count: chunk,
        });
        if (!error && typeof data === "number") {
          setGlobalCount(data);
          setLastFloater({ key: Date.now(), value: chunk });
        } else if (!error && typeof data === "string") {
          const parsed = Number(data);
          if (!Number.isNaN(parsed)) setGlobalCount(parsed);
          setLastFloater({ key: Date.now(), value: chunk });
        }
      } catch {
        // Swallow — the user's local counter still ticks, we just
        // don't pollute the UI with errors during an idle-clicker.
      }
    }
  }, [sessionHashRef, supabaseRef]);

  const handlePunch = useCallback(() => {
    setLocalCount((n) => n + 1);
    pendingRef.current += 1;
    setPendingBatch(pendingRef.current);
    recentClicksRef.current.push(Date.now());
    // Trim to last 10 clicks for the "Top puncheurs" mini-leaderboard.
    if (recentClicksRef.current.length > 50) {
      recentClicksRef.current = recentClicksRef.current.slice(-50);
    }
    playWithFallback("/audio/thunk.mp3", playThunkFallback, 0.4).catch(() => {});

    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = window.setTimeout(flush, PUNCH_FLUSH_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    return () => {
      // On unmount, do one last sync flush so the user's last clicks
      // don't get lost.
      if (flushTimerRef.current != null) {
        window.clearTimeout(flushTimerRef.current);
      }
      flush().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute a rolling "punches per minute" gauge from the recent clicks
  // ref — gives the user a sense of pace.
  const ppm = useMemo(() => {
    const now = Date.now();
    const recent = recentClicksRef.current.filter((t) => now - t < 60_000);
    return recent.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localCount]);

  return (
    <RoomShell
      icon="punch"
      kicker="Salle A"
      title="Coup de Poing"
      subtitle="Chaque clic est compté à l'échelle de la BCC. Frappe pour ahou ahou ahou."
      accentColor="var(--red)"
    >
      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        {/* Big +1 button */}
        <div className="relative flex flex-col items-center justify-center rounded-3xl border border-[var(--border-gold)] bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)] p-8 min-h-[280px]">
          <button
            type="button"
            onClick={handlePunch}
            aria-label="Coup de poing +1"
            className="relative flex items-center justify-center group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--bg-primary)] rounded-full"
            style={{
              width: 160,
              height: 160,
              background:
                "radial-gradient(circle, rgba(232,64,87,0.4) 0%, rgba(232,64,87,0.15) 60%, transparent 100%)",
            }}
          >
            <m.div
              key={localCount}
              initial={{ scale: 0.85 }}
              animate={{ scale: [0.85, 1.1, 1] }}
              transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
              className="absolute inset-4 rounded-full flex items-center justify-center"
              style={{
                background:
                  "radial-gradient(circle at 35% 30%, #FF4D6D 0%, #B5172B 50%, #6B0E1B 100%)",
                boxShadow:
                  "inset 0 -8px 24px rgba(0,0,0,0.4), 0 12px 40px rgba(232,64,87,0.45), 0 0 60px rgba(232,64,87,0.25)",
              }}
            >
              <span className="font-display font-black text-5xl text-white drop-shadow-lg select-none">
                +1
              </span>
            </m.div>
          </button>

          {/* +N RPC-confirmed floater */}
          <AnimatePresence>
            {lastFloater && (
              <m.div
                key={lastFloater.key}
                initial={{ opacity: 0, y: 20, scale: 0.8 }}
                animate={{ opacity: 1, y: -60, scale: 1 }}
                exit={{ opacity: 0, y: -100 }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 pointer-events-none font-display font-black text-2xl text-[var(--gold)]"
                style={{ textShadow: "0 0 12px rgba(200,170,110,0.6)" }}
                onAnimationComplete={() => setLastFloater(null)}
              >
                +{lastFloater.value}
              </m.div>
            )}
          </AnimatePresence>

          <p className="mt-6 font-data text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
            ahou ahou ahou
          </p>
        </div>

        {/* Stats panel */}
        <div className="rounded-3xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 flex flex-col gap-5 justify-center">
          <div>
            <p className="font-data text-[9px] uppercase tracking-[0.3em] text-[var(--text-muted)] mb-1">
              Ta session
            </p>
            <p className="font-data text-4xl font-black text-[var(--gold)] leading-none">
              {localCount.toLocaleString("fr-FR")}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              coup{localCount > 1 ? "s" : ""} de poing
              {pendingBatch > 0 ? ` · sync ${pendingBatch}` : ""}
            </p>
          </div>
          <div className="h-px bg-[var(--border-subtle)]" />
          <div>
            <p className="font-data text-[9px] uppercase tracking-[0.3em] text-[var(--text-muted)] mb-1">
              BCC globale
            </p>
            <p className="font-data text-3xl font-black text-white leading-none">
              {globalCount == null
                ? "…"
                : globalCount.toLocaleString("fr-FR")}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              total cumulé · tous les BCC confondus
            </p>
          </div>
          <div className="h-px bg-[var(--border-subtle)]" />
          <div>
            <p className="font-data text-[9px] uppercase tracking-[0.3em] text-[var(--text-muted)] mb-1">
              Cadence
            </p>
            <p className="font-data text-xl font-bold text-[var(--cyan)] leading-none">
              {ppm} <span className="text-xs text-[var(--text-muted)]">/ min</span>
            </p>
          </div>
        </div>
      </div>
    </RoomShell>
  );
}

// ════════════════════════════════════════════════════════════════════
// Room B — Scouting Lab (real KR Challenger ladder)
// ════════════════════════════════════════════════════════════════════

const BCC_ESPORT_ROSTER = ["Ares", "Calcifer", "TJoon", "Hound", "Saver", "Loopy"];

function ScoutingLabRoom() {
  const [data, setData] = useState<BCCKrLadderResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/bcc/kr-ladder", { cache: "no-store" });
        const body = (await res.json()) as BCCKrLadderResponse;
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled)
          setData({
            entries: [],
            warning: `Impossible de joindre le proxy KR : ${err instanceof Error ? err.message : "erreur réseau"}`,
          });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = window.setInterval(load, 5 * 60 * 1000); // 5 min
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <RoomShell
      icon="scout"
      kicker="Salle B"
      title="Scouting Lab"
      subtitle="Le ladder Challenger coréen en direct. La BCC scoute les solos queue."
      accentColor="var(--cyan)"
    >
      {/* Marquee — BCC Esport roster scrolls horizontally. */}
      <div className="mb-5 overflow-hidden rounded-xl border border-[var(--border-gold)] bg-black/30">
        <div className="relative">
          <div
            className="flex gap-8 py-2 px-4 whitespace-nowrap"
            style={{
              animation: "bccScrollMarquee 22s linear infinite",
              willChange: "transform",
            }}
          >
            {[...Array(2)].flatMap((_, dup) =>
              BCC_ESPORT_ROSTER.map((name) => (
                <span
                  key={`${dup}-${name}`}
                  className="font-data text-[11px] uppercase tracking-[0.3em] text-[var(--cyan)]/80"
                >
                  BCC Esport · {name}
                </span>
              )),
            )}
          </div>
        </div>
      </div>

      {/* Ladder card */}
      <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-subtle)]">
          <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]">
            KR · Challenger · Solo/Duo
          </p>
          {data?.fetchedAt && (
            <p className="font-data text-[10px] text-[var(--text-muted)]">
              {new Date(data.fetchedAt).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>

        {loading && (
          <div className="px-5 py-12 text-center">
            <span className="kc-spinner" />
            <p className="mt-4 font-data text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
              Chargement du ladder…
            </p>
          </div>
        )}

        {!loading && data?.warning && (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-[var(--text-secondary)] mb-2">
              Le ladder coréen sera affiché ici.
            </p>
            <p className="font-data text-[10px] uppercase tracking-[0.25em] text-[var(--text-muted)]">
              {data.warning}
            </p>
          </div>
        )}

        {!loading && !data?.warning && data?.entries.length === 0 && (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              Le ladder est vide pour l&apos;instant. La BCC attend.
            </p>
          </div>
        )}

        {!loading && data && data.entries.length > 0 && (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {data.entries.map((entry) => (
              <li
                key={`${entry.rank}-${entry.summonerName}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--bg-elevated)]/40 transition-colors"
              >
                <span
                  className="font-display font-black text-lg flex-shrink-0 w-8 text-center"
                  style={{
                    color:
                      entry.rank === 1
                        ? "var(--gold)"
                        : entry.rank <= 3
                          ? "var(--gold-bright)"
                          : "var(--text-muted)",
                  }}
                >
                  {entry.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-display text-sm font-bold text-white truncate">
                    {entry.summonerName}
                  </p>
                  <p className="font-data text-[10px] text-[var(--text-muted)]">
                    {entry.wins}V · {entry.losses}D · {entry.winrate}% WR
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {entry.hotStreak && (
                    <span
                      className="text-[10px]"
                      title="Hot streak — 3 victoires d'affilée"
                      aria-label="Hot streak"
                    >
                      🔥
                    </span>
                  )}
                  {entry.freshBlood && (
                    <span
                      className="font-data text-[9px] uppercase tracking-widest text-[var(--cyan)]"
                      title="Nouveau venu en Challenger"
                    >
                      NEW
                    </span>
                  )}
                  {entry.veteran && (
                    <span
                      className="font-data text-[9px] uppercase tracking-widest text-[var(--gold)]"
                      title="Vétéran Challenger"
                    >
                      VET
                    </span>
                  )}
                  <span
                    className="font-data text-sm font-black flex-shrink-0"
                    style={{ color: "var(--gold)" }}
                  >
                    {entry.leaguePoints} <span className="text-[10px] text-[var(--text-muted)]">LP</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <style jsx>{`
        @keyframes bccScrollMarquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes bccScrollMarquee {
            from { transform: translateX(0); }
            to   { transform: translateX(0); }
          }
        }
      `}</style>
    </RoomShell>
  );
}

// ════════════════════════════════════════════════════════════════════
// Room C — Stark Culture (daily editorial card)
// ════════════════════════════════════════════════════════════════════

function StarkCultureRoom({
  supabaseRef,
}: RpcRefs) {
  const entry = useMemo<StarkCultureEntry>(() => getTodaysStarkCultureEntry(), []);
  const [thematicKill, setThematicKill] = useState<KyeahooKill | null>(null);

  // Best-effort fetch of a thematic kill matching the editorial entry.
  // We deliberately don't show a loader — if no kill matches, the card
  // just renders without it.
  useEffect(() => {
    if (!entry.thematicKill) return;
    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;
    let cancelled = false;

    async function fetchThematic() {
      try {
        // Build a chain of filters off `kills`. We DON'T go through a
        // dedicated RPC — this is a best-effort enrichment, not a
        // critical path. Standard Supabase query w/ RLS = `Public kills`.
        let q = sb
          .from("kills")
          .select(
            "id, killer_champion, victim_champion, clip_url_vertical, clip_url_vertical_low, thumbnail_url, highlight_score, avg_rating, rating_count, ai_description, multi_kill, is_first_blood, created_at, players!kills_killer_player_id_fkey(ign)",
          )
          .eq("status", "published")
          .order("highlight_score", { ascending: false, nullsFirst: false })
          .limit(1);

        const t = entry.thematicKill!;
        if (t.champion) q = q.eq("killer_champion", t.champion);
        if (t.minHighlight) q = q.gte("highlight_score", t.minHighlight);
        if (t.multiKill) q = q.eq("multi_kill", t.multiKill);
        if (t.firstBlood) q = q.eq("is_first_blood", true);

        const { data } = await q;
        if (cancelled) return;

        // playerIgn filter is applied client-side on the joined row.
        const candidate = (data ?? []).find((row) => {
          if (!t.playerIgn) return true;
          const playerRow = (row as { players?: { ign?: string } | { ign?: string }[] }).players;
          const ign = Array.isArray(playerRow)
            ? playerRow[0]?.ign
            : playerRow?.ign;
          return ign?.toLowerCase() === t.playerIgn.toLowerCase();
        });

        if (candidate) {
          // Shape the row into KyeahooKill (we reuse the same UI primitives).
          const playerRow = (candidate as { players?: { ign?: string } | { ign?: string }[] }).players;
          const killerName = Array.isArray(playerRow)
            ? playerRow[0]?.ign ?? null
            : playerRow?.ign ?? null;
          setThematicKill({
            id: candidate.id,
            killer_champion: candidate.killer_champion ?? null,
            victim_champion: candidate.victim_champion ?? null,
            killer_name: killerName,
            victim_name: null,
            clip_url_vertical: candidate.clip_url_vertical ?? null,
            clip_url_vertical_low: candidate.clip_url_vertical_low ?? null,
            clip_url_horizontal: null,
            thumbnail_url: candidate.thumbnail_url ?? null,
            highlight_score: candidate.highlight_score ?? null,
            avg_rating: candidate.avg_rating ?? null,
            rating_count: candidate.rating_count ?? null,
            ai_description: candidate.ai_description ?? null,
            multi_kill: candidate.multi_kill ?? null,
            is_first_blood: candidate.is_first_blood ?? null,
            created_at: candidate.created_at,
          });
        }
      } catch {
        // Editorial card still renders without the kill — graceful fallback.
      }
    }
    fetchThematic();
    return () => {
      cancelled = true;
    };
  }, [entry, supabaseRef]);

  return (
    <RoomShell
      icon="culture"
      kicker="Salle C"
      title="Stark Culture"
      subtitle="22h. Eto lit. La BCC écoute. Une citation par jour, choisie au calendrier."
      accentColor="var(--gold-bright)"
    >
      <article
        className="relative rounded-3xl border border-[var(--gold)]/20 overflow-hidden"
        style={{
          background:
            "linear-gradient(180deg, #f8f1e0 0%, #f0e6d2 100%)",
          color: "#2a1f0e",
        }}
      >
        {/* Magazine top rule */}
        <div className="flex items-center justify-between px-7 pt-6 pb-3 border-b border-[#2a1f0e]/15">
          <p className="font-data text-[10px] uppercase tracking-[0.4em] text-[#8b6914]">
            Stark Culture · 22h
          </p>
          <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[#8b6914]">
            {new Date().toLocaleDateString("fr-FR", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-[1.4fr_1fr] p-7 pt-6">
          <div>
            <p className="font-data text-[10px] uppercase tracking-[0.35em] text-[#8b6914]/80 mb-3">
              Thème · {entry.theme}
            </p>
            <blockquote
              className="font-display text-2xl md:text-3xl leading-[1.18] mb-5"
              style={{
                fontFamily:
                  'var(--font-cinzel), Cinzel, "Georgia", "Times New Roman", serif',
                fontWeight: 600,
                letterSpacing: "-0.005em",
                color: "#1a1208",
                fontStyle: "italic",
                textTransform: "none",
              }}
            >
              <span aria-hidden style={{ color: "#a8843f" }}>«&nbsp;</span>
              {entry.quote}
              <span aria-hidden style={{ color: "#a8843f" }}>&nbsp;»</span>
            </blockquote>
            <footer className="border-l-2 border-[#a8843f] pl-3">
              <p className="font-display font-black text-sm uppercase tracking-wider text-[#1a1208]">
                {entry.author}
              </p>
              <p className="font-data text-[10px] uppercase tracking-[0.25em] text-[#5a4019] mt-1">
                {entry.attribution}
              </p>
            </footer>
          </div>

          {/* Thematic kill — or a CSS-drawn ornament when no kill matches */}
          {thematicKill && thematicKill.thumbnail_url ? (
            <Link
              href={`/kill/${thematicKill.id}`}
              className="relative block overflow-hidden rounded-2xl border border-[#1a1208]/15 bg-black aspect-[3/4] group"
              aria-label={`Kill thématique : ${thematicKill.ai_description ?? entry.theme}`}
            >
              <Image
                src={thematicKill.thumbnail_url}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 300px"
                className="object-cover group-hover:scale-105 transition-transform duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
                <p className="font-data text-[9px] uppercase tracking-[0.3em] text-[var(--gold)] mb-1">
                  Kill thématique du jour
                </p>
                <p className="font-display text-sm font-bold leading-tight mb-1">
                  {thematicKill.killer_champion} → {thematicKill.victim_champion}
                </p>
                <p className="text-[11px] italic text-white/75 line-clamp-3">
                  {entry.killCaption}
                </p>
              </div>
            </Link>
          ) : (
            <div
              className="relative rounded-2xl border border-[#1a1208]/15 aspect-[3/4] overflow-hidden flex flex-col items-center justify-center text-center px-5"
              style={{
                background:
                  "linear-gradient(135deg, #faf3e2 0%, #e8dcbf 100%)",
              }}
            >
              {/* CSS-drawn Hextech ornament */}
              <div className="relative w-24 h-24 mb-4">
                <div
                  className="absolute inset-0"
                  style={{
                    transform: "rotate(45deg)",
                    background:
                      "linear-gradient(135deg, #c89b3c, #785a28)",
                    borderRadius: "8px",
                    boxShadow: "0 10px 30px rgba(120,90,40,0.25)",
                  }}
                />
                <div
                  className="absolute inset-4"
                  style={{
                    transform: "rotate(45deg)",
                    border: "2px solid rgba(248,241,224,0.7)",
                    borderRadius: "4px",
                  }}
                />
              </div>
              <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[#8b6914] mb-2">
                Kill thématique
              </p>
              <p className="text-[12px] italic text-[#5a4019] leading-snug">
                {entry.killCaption}
              </p>
            </div>
          )}
        </div>

        {/* TODO: source magazine-style thematic images when the user
            supplies them. For now the ornament + thumbnail composition
            carries the visual. */}
      </article>
    </RoomShell>
  );
}

// ════════════════════════════════════════════════════════════════════
// Room D — Lance-tomates (Zaboutine)
// ════════════════════════════════════════════════════════════════════

interface TomatoSplat {
  id: number;
  x: number; // percent within the sticker container
  y: number;
}

function LanceTomatesRoom({ sessionHashRef, supabaseRef }: RpcRefs) {
  const [tomatoCount, setTomatoCount] = useState<number | null>(null);
  const [sessionThrows, setSessionThrows] = useState(0);
  const [splats, setSplats] = useState<TomatoSplat[]>([]);
  // Tomato animation queue — multiple can fly at once.
  const [flying, setFlying] = useState<
    {
      id: number;
      startX: number;
      startY: number;
      targetX: number;
      targetY: number;
    }[]
  >([]);
  const [secretShown, setSecretShown] = useState(false);

  const stickerRef = useRef<HTMLDivElement>(null);
  const tomatoIdRef = useRef(0);

  // Poll global tomato counter
  useEffect(() => {
    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;
    let cancelled = false;
    async function poll() {
      try {
        const { data } = await sb
          .from("bcc_tomatoes")
          .select("count")
          .eq("id", "global")
          .single();
        if (!cancelled && data) {
          const n = typeof data.count === "string" ? Number(data.count) : data.count;
          if (typeof n === "number" && !Number.isNaN(n)) setTomatoCount(n);
        }
      } catch {
        // ignore
      }
    }
    poll();
    const t = window.setInterval(poll, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [supabaseRef]);

  // Unlock the secret message at 100 global OR 10 session.
  useEffect(() => {
    if (sessionThrows >= 10 || (tomatoCount != null && tomatoCount >= 100)) {
      setSecretShown(true);
    }
  }, [sessionThrows, tomatoCount]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const sticker = stickerRef.current;
      if (!sticker) return;

      const rect = sticker.getBoundingClientRect();
      const targetX = ((e.clientX - rect.left) / rect.width) * 100;
      const targetY = ((e.clientY - rect.top) / rect.height) * 100;
      // Tomato starts from the bottom of the sticker container.
      const startX = 50;
      const startY = 110;

      const id = ++tomatoIdRef.current;
      setFlying((prev) => [...prev, { id, startX, startY, targetX, targetY }]);

      // After the parabolic arc (650 ms), promote the tomato to a splat.
      window.setTimeout(() => {
        setFlying((prev) => prev.filter((t) => t.id !== id));
        setSplats((prev) => {
          const next = [...prev, { id, x: targetX, y: targetY }];
          // Cap at 20 splats simultaneously to keep the DOM light.
          return next.length > 20 ? next.slice(-20) : next;
        });
        playWithFallback("/audio/tomato-splat.mp3", playSplatFallback, 0.55).catch(
          () => {},
        );
        // Auto-fade after 5 seconds.
        window.setTimeout(() => {
          setSplats((prev) => prev.filter((s) => s.id !== id));
        }, 5000);
      }, 650);

      setSessionThrows((n) => n + 1);

      // Fire-and-forget RPC. Optimistically bump the local global counter.
      // We wrap in Promise.resolve() because Supabase's rpc() returns a
      // thenable (not a real Promise), so chaining .catch directly fails
      // TS. Server-side rate-limit (30/10s) errors are swallowed silently
      // — the user still gets the splat animation locally.
      const sb = supabaseRef.current ?? createClient();
      supabaseRef.current = sb;
      void Promise.resolve(
        sb.rpc("fn_bcc_tomato", { p_session_hash: sessionHashRef.current }),
      )
        .then(({ data }) => {
          if (typeof data === "number") setTomatoCount(data);
          else if (typeof data === "string") {
            const n = Number(data);
            if (!Number.isNaN(n)) setTomatoCount(n);
          }
        })
        .catch(() => {});
    },
    [sessionHashRef, supabaseRef],
  );

  return (
    <RoomShell
      icon="tomato"
      kicker="Salle D"
      title="Lance-tomates"
      subtitle="Zaboutine te regarde. Cliquez. Bombardez. Le compteur tourne."
      accentColor="var(--orange)"
    >
      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        {/* Sticker — placeholder grey rect with Zaboutine text */}
        <div
          ref={stickerRef}
          onClick={handleClick}
          role="button"
          tabIndex={0}
          aria-label="Lancer une tomate sur Zaboutine"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              const rect = stickerRef.current?.getBoundingClientRect();
              if (!rect) return;
              const fakeEvent = {
                clientX: rect.left + rect.width / 2 + (Math.random() - 0.5) * 80,
                clientY: rect.top + rect.height / 2 + (Math.random() - 0.5) * 80,
              } as React.MouseEvent<HTMLDivElement>;
              handleClick(fakeEvent);
            }
          }}
          className="relative aspect-[3/4] rounded-3xl overflow-hidden cursor-crosshair select-none border-2 border-[var(--gold)]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--bg-primary)]"
          style={{
            background:
              "linear-gradient(180deg, #4a4a4a 0%, #2a2a2a 100%)",
            // Hatched repeating pattern so the placeholder reads as
            // intentional, not broken.
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent, transparent 16px, rgba(255,255,255,0.04) 16px, rgba(255,255,255,0.04) 17px)",
          }}
        >
          {/* TODO: replace with /images/zaboutine-sticker.png when the
              user provides the cropped portrait sticker. */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-none">
            <span
              className="font-data text-[10px] uppercase tracking-[0.4em] text-[var(--text-muted)] mb-3"
              style={{ textShadow: "0 1px 0 rgba(0,0,0,0.5)" }}
            >
              Photo à venir
            </span>
            <p
              className="font-display font-black text-5xl md:text-6xl text-white/40"
              style={{ letterSpacing: "0.02em" }}
            >
              ZABOUTINE
            </p>
            <p className="mt-4 font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70">
              Clique pour lancer
            </p>
          </div>

          {/* Active flying tomatoes — parabolic arc */}
          {flying.map((t) => (
            <m.div
              key={`flying-${t.id}`}
              className="absolute pointer-events-none"
              style={{
                width: 28,
                height: 28,
                left: `${t.startX}%`,
                top: `${t.startY}%`,
                marginLeft: -14,
                marginTop: -14,
                willChange: "transform, opacity",
              }}
              initial={{
                x: 0,
                y: 0,
                rotate: 0,
                scale: 0.5,
                opacity: 1,
              }}
              animate={{
                x: [
                  0,
                  ((t.targetX - t.startX) / 100) * (stickerRef.current?.offsetWidth ?? 320) * 0.5,
                  ((t.targetX - t.startX) / 100) * (stickerRef.current?.offsetWidth ?? 320),
                ],
                y: [
                  0,
                  -180,
                  ((t.targetY - t.startY) / 100) * (stickerRef.current?.offsetHeight ?? 400),
                ],
                rotate: [0, 360, 720],
                scale: [0.5, 1.1, 1],
              }}
              transition={{ duration: 0.65, ease: "easeOut" }}
            >
              <TomatoIcon />
            </m.div>
          ))}

          {/* Persistent splats */}
          {splats.map((s) => (
            <m.div
              key={`splat-${s.id}`}
              className="absolute pointer-events-none"
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                marginLeft: -32,
                marginTop: -32,
              }}
              initial={{ scale: 0, opacity: 1 }}
              animate={{ scale: [0, 1.3, 1], opacity: [1, 1, 1, 0] }}
              transition={{ duration: 5, times: [0, 0.06, 0.12, 1] }}
            >
              <SplatIcon />
            </m.div>
          ))}
        </div>

        {/* Counters + secret message */}
        <div className="rounded-3xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 flex flex-col gap-5 justify-center">
          <div>
            <p className="font-data text-[9px] uppercase tracking-[0.3em] text-[var(--text-muted)] mb-1">
              Tes tomates
            </p>
            <p className="font-data text-4xl font-black text-[var(--orange)] leading-none">
              {sessionThrows}
            </p>
          </div>
          <div className="h-px bg-[var(--border-subtle)]" />
          <div>
            <p className="font-data text-[9px] uppercase tracking-[0.3em] text-[var(--text-muted)] mb-1">
              BCC totale
            </p>
            <p className="font-data text-3xl font-black text-white leading-none">
              {tomatoCount == null ? "…" : tomatoCount.toLocaleString("fr-FR")}
            </p>
          </div>

          <AnimatePresence>
            {secretShown && (
              <m.div
                key="secret"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="mt-2 rounded-xl border border-[var(--gold)]/40 bg-[var(--gold)]/10 p-4"
              >
                <p className="font-data text-[9px] uppercase tracking-[0.3em] text-[var(--gold)] mb-2">
                  Message scellé
                </p>
                <p className="text-sm italic text-[var(--text-primary)] leading-relaxed">
                  Zaboutine vous regarde dans le blanc des yeux. Il revient demain.
                </p>
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </RoomShell>
  );
}

function TomatoIcon() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28">
      <ellipse cx="16" cy="18" rx="11" ry="10" fill="#E84057" />
      <ellipse cx="13" cy="15" rx="3" ry="2" fill="#FF6B7C" opacity="0.65" />
      <path
        d="M16 8 L13 4 L19 4 Z M16 8 L11 5 M16 8 L21 5 M16 8 L16 3"
        stroke="#2d6e2d"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse cx="16" cy="8" rx="2" ry="1" fill="#3d8a3d" />
    </svg>
  );
}

function SplatIcon() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden>
      <defs>
        <radialGradient id="splatGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FF4D6D" />
          <stop offset="55%" stopColor="#C8324B" />
          <stop offset="100%" stopColor="#8B0E1F" />
        </radialGradient>
      </defs>
      <g fill="url(#splatGrad)" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))" }}>
        <ellipse cx="32" cy="32" rx="14" ry="13" />
        <ellipse cx="14" cy="22" rx="6" ry="4" />
        <ellipse cx="50" cy="40" rx="7" ry="5" />
        <ellipse cx="20" cy="48" rx="5" ry="3" />
        <ellipse cx="48" cy="14" rx="4" ry="3" />
        <ellipse cx="10" cy="36" rx="3" ry="2" />
        <ellipse cx="54" cy="26" rx="3" ry="2" />
        <ellipse cx="34" cy="54" rx="4" ry="2" />
      </g>
      <g fill="#FFB1C0" opacity="0.5">
        <ellipse cx="28" cy="28" rx="3" ry="2" />
      </g>
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════
// Room E — Mur des Ahou Ahou (Kyeahoo kills)
// ════════════════════════════════════════════════════════════════════

function MurDesAhouRoom({ sessionHashRef, supabaseRef }: RpcRefs) {
  const [kills, setKills] = useState<KyeahooKill[] | null>(null);
  const [openKill, setOpenKill] = useState<KyeahooKill | null>(null);
  const hoveredRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;
    let cancelled = false;
    async function load() {
      try {
        const { data, error } = await sb.rpc("fn_bcc_kyeahoo_kills");
        if (!cancelled && !error && Array.isArray(data)) {
          setKills(data as KyeahooKill[]);
        } else if (!cancelled) {
          setKills([]);
        }
      } catch {
        if (!cancelled) setKills([]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [supabaseRef]);

  const handleHover = useCallback(
    (killId: string) => {
      if (hoveredRef.current.has(killId)) return;
      hoveredRef.current.add(killId);

      // TODO: source from N'Seven7 "OTT" 0:00-0:03 (YouTube id YNzvHb92xqY)
      playWithFallback("/audio/ahou-ahou.mp3", playThunkFallback, 0.5).catch(
        () => {},
      );

      const sb = supabaseRef.current ?? createClient();
      supabaseRef.current = sb;
      // Wrap in Promise.resolve() — Supabase rpc() returns a thenable, not
      // a real Promise. Fire-and-forget : we don't care if the increment
      // fails (no rate-limit on this RPC, but defensive).
      void Promise.resolve(
        sb.rpc("fn_bcc_ahou_played", { p_session_hash: sessionHashRef.current }),
      ).catch(() => {});
    },
    [sessionHashRef, supabaseRef],
  );

  return (
    <RoomShell
      icon="ahou"
      kicker="Salle E"
      title="Mur des Ahou Ahou"
      subtitle="Le wall of fame de Kyeahoo. Survole pour entendre le sample, clique pour le clip."
      accentColor="var(--blue-kc)"
    >
      {kills === null && (
        <div className="px-5 py-12 text-center">
          <span className="kc-spinner" />
          <p className="mt-4 font-data text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
            Préparation du mur…
          </p>
        </div>
      )}

      {kills !== null && kills.length === 0 && (
        <div className="rounded-3xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-10 text-center">
          <p className="font-display text-xl font-black text-[var(--gold)] mb-2">
            Le mur attend.
          </p>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
            Le mur attend les premières exécutions de Kyeahoo &mdash; la BCC veille.
          </p>
        </div>
      )}

      {kills !== null && kills.length > 0 && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {kills.map((kill) => {
            const thumb = kill.thumbnail_url;
            return (
              <button
                key={kill.id}
                type="button"
                onMouseEnter={() => handleHover(kill.id)}
                onFocus={() => handleHover(kill.id)}
                onClick={() => setOpenKill(kill)}
                className="group relative aspect-[3/4] rounded-xl overflow-hidden border border-[var(--border-gold)] bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] transition-all hover:border-[var(--gold)]/60 hover:scale-[1.03]"
                aria-label={`Kill de Kyeahoo : ${kill.killer_champion} vs ${kill.victim_champion}`}
              >
                {thumb ? (
                  <Image
                    src={thumb}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                ) : (
                  <div className="absolute inset-0 bg-[var(--bg-elevated)]" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />

                {/* Top-left badges */}
                <div className="absolute top-2 left-2 z-10 flex flex-wrap gap-1">
                  {kill.highlight_score != null && (
                    <span className="rounded-md bg-[var(--gold)]/20 backdrop-blur-sm border border-[var(--gold)]/40 px-1.5 py-0.5 text-[9px] font-data font-bold text-[var(--gold)]">
                      {kill.highlight_score.toFixed(1)}
                    </span>
                  )}
                  {kill.is_first_blood && (
                    <span className="rounded-md bg-[var(--red)]/20 border border-[var(--red)]/40 px-1.5 py-0.5 text-[9px] font-black text-[var(--red)]">
                      FB
                    </span>
                  )}
                  {kill.multi_kill && (
                    <span className="rounded-md bg-[var(--gold)]/20 border border-[var(--gold)]/40 px-1.5 py-0.5 text-[9px] font-black text-[var(--gold)] uppercase">
                      {kill.multi_kill}
                    </span>
                  )}
                </div>

                {/* Bottom info */}
                <div className="absolute bottom-0 left-0 right-0 p-3 z-10 text-left">
                  <div className="flex items-center gap-1 mb-1">
                    {kill.killer_champion && (
                      <Image
                        src={championIconUrl(kill.killer_champion)}
                        alt={kill.killer_champion}
                        width={20}
                        height={20}
                        className="rounded-full border border-[var(--gold)]/40"
                      />
                    )}
                    <span className="text-[10px] text-[var(--gold)] font-bold truncate">
                      {kill.killer_champion}
                    </span>
                    <span className="text-[10px] text-[var(--gold)]/40">→</span>
                    <span className="text-[10px] text-white/70 truncate">
                      {kill.victim_champion}
                    </span>
                  </div>
                  <p className="text-[9px] text-white/50">
                    {new Date(kill.created_at).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "short",
                      year: "2-digit",
                    })}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Modal — kill clip player */}
      <AnimatePresence>
        {openKill && (
          <m.div
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4 backdrop-blur-md"
            style={{ background: "rgba(1,10,19,0.85)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpenKill(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Lecteur de kill Kyeahoo"
          >
            <m.div
              className="relative w-full max-w-md aspect-[9/16] rounded-2xl overflow-hidden border border-[var(--gold)]/40 bg-black"
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              {openKill.clip_url_vertical ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  src={openKill.clip_url_vertical}
                  poster={openKill.thumbnail_url ?? undefined}
                  autoPlay
                  controls
                  loop
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-sm text-[var(--text-muted)]">Clip indisponible.</p>
                </div>
              )}
              <div className="absolute top-3 right-3 z-10">
                <button
                  type="button"
                  onClick={() => setOpenKill(null)}
                  aria-label="Fermer"
                  className="rounded-full p-2 bg-black/60 border border-[var(--gold)]/40 hover:bg-[var(--gold)]/20"
                >
                  <svg className="h-4 w-4 text-[var(--gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-4 z-10 bg-gradient-to-t from-black/85 to-transparent">
                <p className="font-display font-black text-lg text-[var(--gold)]">
                  {openKill.killer_champion} → {openKill.victim_champion}
                </p>
                {openKill.ai_description && (
                  <p className="text-xs text-white/80 italic mt-1 line-clamp-2">
                    « {openKill.ai_description} »
                  </p>
                )}
                <Link
                  href={`/kill/${openKill.id}`}
                  className="mt-3 inline-flex items-center gap-1 font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)] hover:text-[var(--gold-bright)]"
                  onClick={() => setOpenKill(null)}
                >
                  Page complète →
                </Link>
              </div>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </RoomShell>
  );
}

// ════════════════════════════════════════════════════════════════════
// RoomShell — shared room frame
// ════════════════════════════════════════════════════════════════════

type RoomIcon = "punch" | "scout" | "culture" | "tomato" | "ahou";

function RoomShell({
  icon,
  kicker,
  title,
  subtitle,
  accentColor,
  children,
}: {
  icon: RoomIcon;
  kicker: string;
  title: string;
  subtitle: string;
  accentColor: string;
  children: React.ReactNode;
}) {
  return (
    <section className="relative">
      <header className="mb-5">
        <div className="flex items-center gap-3 mb-2">
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border"
            style={{
              background: "var(--bg-elevated)",
              borderColor: `${accentColor}55`,
              boxShadow: `0 0 14px ${accentColor}33`,
            }}
            aria-hidden
          >
            <RoomGlyph icon={icon} color={accentColor} />
          </span>
          <span
            className="font-data text-[10px] uppercase tracking-[0.4em]"
            style={{ color: accentColor }}
          >
            {kicker}
          </span>
          <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${accentColor}55, transparent)` }} />
        </div>
        <h3
          className="font-display font-black text-2xl sm:text-3xl mb-1"
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </h3>
        <p className="text-sm text-[var(--text-muted)] max-w-2xl">{subtitle}</p>
      </header>
      {children}
    </section>
  );
}

function RoomGlyph({ icon, color }: { icon: RoomIcon; color: string }) {
  switch (icon) {
    case "punch":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={color} strokeWidth="2">
          <path d="M6 12 L12 6 L18 12 L12 18 Z" />
          <circle cx="12" cy="12" r="3" fill={color} />
        </svg>
      );
    case "scout":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={color} strokeWidth="2">
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20 L15.5 15.5" strokeLinecap="round" />
        </svg>
      );
    case "culture":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={color} strokeWidth="2">
          <path d="M4 5 L4 19 L11 17 L20 19 L20 5 L11 7 Z" />
          <path d="M11 7 L11 17" />
        </svg>
      );
    case "tomato":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill={color}>
          <circle cx="12" cy="13" r="7" />
          <path d="M12 6 L9 3 L15 3 Z" fill="#3d8a3d" />
        </svg>
      );
    case "ahou":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={color} strokeWidth="2">
          <path d="M4 12 Q8 6 12 12 T20 12" strokeLinecap="round" />
          <circle cx="12" cy="12" r="1.5" fill={color} />
        </svg>
      );
  }
}
