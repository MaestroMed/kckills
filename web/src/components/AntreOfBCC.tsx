"use client";

/**
 * AntreOfBCC — Wave 26 redesign (vintage gentlemen's club × Ali Baba cave).
 *
 * Unlocked by typing B-C-C on Bo's player page. Replaces the original
 * cold hextech-gold cave with a SECRET WORLD : warm mahogany wood, dark
 * burgundy velvet, tarnished brass, candle / oil-lamp glow, drifting
 * pipe smoke, antique parchment. Different design system altogether
 * (see `web/src/styles/antre.css`) — nothing in this file references
 * the main site's `--gold` / `--cyan` / `--blue-kc` tokens.
 *
 * Layout : a single vertical scroll through six rooms (no tabs). The user
 * enters at the top via the entry ceremony, then scrolls down through :
 *   I.   La Salle des Coups-de-Poing   (typewriter-key idle clicker)
 *   II.  Le Labo d'Observation         (KR Challenger ladder)
 *   III. Le Salon de Stark Culture     (editorial card + bibliothèque)
 *   IV.  Le Stand de Lancer-Tomates    (gilt-framed Zaboutine + tomatoes)
 *   V.   Le Mur des Ahou-Ahou           (Kyeahoo kill gallery wall)
 *   VI.  Le Registre des Membres       (guestbook with aristocratic aliases)
 *
 * Audio : on mount we hijack the global wolf player with the BCC playlist
 * (single-track loop of N'Seven7 "OTT") via setPlaylistOverride. On unmount
 * we release it. NO inline <audio src="/audio/ahou-ahou.mp3"> in the entry
 * ceremony — the wolf player carries the soundtrack. The hover sample on
 * Room V is a transient `new Audio()` so it doesn't fight the global player.
 *
 * Exit : brass door handle bottom-left, ESC, or typing "OUT" anywhere.
 *
 * Accessibility :
 *   • aria-label / aria-modal on the root dialog
 *   • aria-labelledby on every room section
 *   • aria-label on every interactive element
 *   • prefers-reduced-motion : ceremony collapses to a 400ms cross-fade,
 *     no ambience particles, no parallax. All keyframes pause.
 *   • visible focus rings (brass-flame color) on every focusable element
 *
 * Performance :
 *   • LazyMotion / `m.` prefix from motion/react (configured in Providers).
 *   • Particles are CSS-animated <span>s (no JS frame loop).
 *   • Tomato splats capped at 20 simultaneous.
 *   • Punch counter batches RPCs at 500ms cadence.
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
  STARK_CULTURE_ENTRIES,
  getTodaysStarkCultureEntry,
  type StarkCultureEntry,
} from "@/lib/stark-culture";
import { championIconUrl } from "@/lib/constants";
import { useFloatingPlayer } from "@/lib/audio/use-floating-player";
import type { BCCKrLadderResponse } from "@/app/api/bcc/kr-ladder/route";

import "@/styles/antre.css";

import { EntryCeremony } from "./bcc/EntryCeremony";
import { RoomFrame } from "./bcc/RoomFrame";
import { Ambience } from "./bcc/Ambience";
import {
  seedVisitors,
  visitorNameFromHash,
} from "./bcc/visitor-names";

interface AntreOfBCCProps {
  onClose: () => void;
}

// ════════════════════════════════════════════════════════════════════
// Kyeahoo kill shape — kept here so Room V doesn't need a separate file
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
// RPC refs shared across rooms
// ════════════════════════════════════════════════════════════════════

interface RpcRefs {
  sessionHashRef: React.MutableRefObject<string>;
  supabaseRef: React.MutableRefObject<ReturnType<typeof createClient> | null>;
}

// ════════════════════════════════════════════════════════════════════
// Root component
// ════════════════════════════════════════════════════════════════════

export function AntreOfBCC({ onClose }: AntreOfBCCProps) {
  const prefersReducedMotion = useReducedMotion();
  const wolf = useFloatingPlayer();
  const [ceremonyDone, setCeremonyDone] = useState(false);

  // ─── Wolf-player override on mount, release on unmount ──────────
  // The b-c-c ritual that opened the cave IS a user gesture so the YT
  // IFrame API is allowed to play() immediately. The provider queues the
  // play request via pendingPlayRef if the YT player isn't yet attached.
  useEffect(() => {
    wolf.setPlaylistOverride("bcc", { autoplay: true });
    return () => { wolf.setPlaylistOverride(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── ESC + typed "OUT" closes the cave ──────────────────────────
  useEffect(() => {
    const outBuffer: string[] = [];
    let bufferTimer: ReturnType<typeof setTimeout> | null = null;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k.length !== 1) return;
      outBuffer.push(k);
      while (outBuffer.length > 3) outBuffer.shift();
      if (bufferTimer) clearTimeout(bufferTimer);
      bufferTimer = setTimeout(() => { outBuffer.length = 0; }, 1800);
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

  // ─── Body scroll lock while the cave is mounted ──────────────────
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleCeremonyComplete = useCallback(() => setCeremonyDone(true), []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="L'Antre de la Bronze Consulting Company"
      className="fixed inset-0 z-[9999] antre-root"
    >
      <div className="antre-stage">
        <EntryCeremony onComplete={handleCeremonyComplete} />
        {(ceremonyDone || prefersReducedMotion) && (
          <CaveDashboard onClose={onClose} prefersReducedMotion={!!prefersReducedMotion} />
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// CaveDashboard — the six rooms + ambience + exit
// ════════════════════════════════════════════════════════════════════

function CaveDashboard({
  onClose,
  prefersReducedMotion,
}: {
  onClose: () => void;
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
      key="cave"
      className="absolute inset-0 overflow-y-auto"
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: prefersReducedMotion ? 0.2 : 0.9, ease: [0.16, 1, 0.3, 1] }}
    >
      <Ambience />

      {/* Brass plate descending on chains — the cave title */}
      <m.div
        className="relative z-10 pt-8 pb-4 flex flex-col items-center pointer-events-none select-none"
        initial={prefersReducedMotion ? false : { y: -180, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: prefersReducedMotion ? 0.2 : 1.1, delay: prefersReducedMotion ? 0 : 0.15, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* visible chains */}
        <div className="flex gap-[210px] mb-2">
          <span style={{ width: 2, height: 36, background: "linear-gradient(180deg, transparent, #6b4a1c, #a07533)" }} />
          <span style={{ width: 2, height: 36, background: "linear-gradient(180deg, transparent, #6b4a1c, #a07533)" }} />
        </div>
        <div className="antre-brass-plate" style={{ padding: "16px 44px", fontSize: "clamp(15px, 2.4vw, 19px)" }}>
          L&apos;Antre de la BCC
          <div style={{ marginTop: 4, fontSize: "0.55em", letterSpacing: "0.38em", opacity: 0.85 }}>
            Bronze Consulting Company
          </div>
        </div>
        <p
          className="mt-4 antre-quill"
          style={{
            color: "rgba(232, 178, 90, 0.75)",
            fontSize: "clamp(13px, 1.7vw, 16px)",
            letterSpacing: "0.04em",
          }}
        >
          Réunion en cours · n&apos;oubliez pas votre badge
        </p>
      </m.div>

      {/* Discreet exit nav (top-right kbd hint) */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-3">
        <span
          className="hidden md:inline antre-quill"
          style={{
            color: "rgba(232, 178, 90, 0.55)",
            fontSize: 12,
            letterSpacing: "0.18em",
          }}
        >
          Tapez <kbd style={{
            padding: "2px 6px",
            border: "1px solid rgba(184,133,42,0.4)",
            borderRadius: 3,
            color: "rgba(240,193,74,0.8)",
            background: "rgba(0,0,0,0.35)",
            fontFamily: "var(--antre-font-display)",
            fontSize: 11,
          }}>OUT</kbd> ou ESC
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Quitter l'Antre"
          className="rounded-full p-2"
          style={{
            border: "1px solid rgba(184,133,42,0.45)",
            background: "rgba(20,8,4,0.7)",
            color: "rgba(240,193,74,0.85)",
            transition: "background 200ms",
          }}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content — the six rooms */}
      <main
        className="relative z-10 max-w-5xl mx-auto px-5 py-6 space-y-16 pb-32 antre-rug"
        id="antre-main"
      >
        <CoupDePoingRoom sessionHashRef={sessionHashRef} supabaseRef={supabaseRef} />
        <ScoutingLabRoom />
        <StarkCultureRoom supabaseRef={supabaseRef} sessionHashRef={sessionHashRef} />
        <LanceTomatesRoom sessionHashRef={sessionHashRef} supabaseRef={supabaseRef} />
        <MurAhouAhouRoom sessionHashRef={sessionHashRef} supabaseRef={supabaseRef} />
        <RegistreMembresRoom sessionHashRef={sessionHashRef} />

        {/* Riot disclaimer + signature */}
        <div className="antre-divider mt-12" aria-hidden>
          <span className="antre-divider-ornament">❦</span>
        </div>
        <p
          aria-label="Riot Games disclaimer"
          className="text-center antre-quill"
          style={{
            color: "rgba(232,178,90,0.4)",
            fontSize: 11,
            letterSpacing: "0.25em",
          }}
        >
          Not endorsed by Riot Games. League of Legends © Riot Games.
        </p>
      </main>

      {/* Door handle (bottom-left exit) */}
      <m.div
        className="fixed bottom-6 left-6 z-30 flex items-center gap-3"
        initial={prefersReducedMotion ? false : { x: -40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.9, delay: prefersReducedMotion ? 0 : 0.6 }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Retour au monde profane"
          className="antre-door-handle"
        />
        <span
          className="hidden sm:inline antre-engraved"
          style={{
            fontSize: 10,
            color: "rgba(240,193,74,0.8)",
            letterSpacing: "0.35em",
          }}
        >
          Retour au monde profane
        </span>
      </m.div>
    </m.div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Room I — La Salle des Coups-de-Poing (typewriter idle clicker)
// ════════════════════════════════════════════════════════════════════

const PUNCH_FLUSH_DELAY_MS = 500;
const PUNCH_POLL_MS = 3000;
const PUNCH_BATCH_MAX = 100;

const PUNCHER_LEADERBOARD = [
  { name: "M. Mehdi", count: 421 },
  { name: "M. Eto", count: 318 },
  { name: "BCC #12", count: 289 },
  { name: "Le Comte de Wassuverre", count: 217 },
  { name: "Madame du 11ᵉ", count: 184 },
  { name: "Le Baron de Pizzaland", count: 152 },
  { name: "L'Officier de la BCC", count: 119 },
  { name: "Le Doyen de Bronze-sur-Lane", count: 89 },
];

function CoupDePoingRoom({ sessionHashRef, supabaseRef }: RpcRefs) {
  const [localCount, setLocalCount] = useState(0);
  const [globalCount, setGlobalCount] = useState<number | null>(null);
  const [pendingBatch, setPendingBatch] = useState(0);
  const flushTimerRef = useRef<number | null>(null);
  const pendingRef = useRef(0);
  const lastTickRef = useRef<{ key: number; value: number } | null>(null);
  const [tick, setTick] = useState<{ key: number; value: number } | null>(null);

  // Poll the global counter every 3s
  useEffect(() => {
    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;
    let cancelled = false;
    async function poll() {
      try {
        const { data } = await sb.from("bcc_punches").select("count").eq("id", "global").single();
        if (!cancelled && data && typeof data.count === "number") setGlobalCount(data.count);
        else if (!cancelled && data && typeof data.count === "string") {
          const n = Number(data.count); if (!Number.isNaN(n)) setGlobalCount(n);
        }
      } catch { /* network blip — keep last good value */ }
    }
    poll();
    const interval = window.setInterval(poll, PUNCH_POLL_MS);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [supabaseRef]);

  const flush = useCallback(async () => {
    const batch = pendingRef.current;
    if (batch <= 0) return;
    pendingRef.current = 0; setPendingBatch(0);
    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;
    const chunks: number[] = [];
    let remaining = batch;
    while (remaining > 0) {
      const take = Math.min(remaining, PUNCH_BATCH_MAX);
      chunks.push(take); remaining -= take;
    }
    for (const chunk of chunks) {
      try {
        const { data, error } = await sb.rpc("fn_bcc_punch", {
          p_session_hash: sessionHashRef.current, p_count: chunk,
        });
        if (!error && typeof data === "number") setGlobalCount(data);
        else if (!error && typeof data === "string") {
          const n = Number(data); if (!Number.isNaN(n)) setGlobalCount(n);
        }
      } catch { /* swallow — user's local counter keeps ticking */ }
    }
  }, [sessionHashRef, supabaseRef]);

  const handlePunch = useCallback(() => {
    setLocalCount((n) => n + 1);
    pendingRef.current += 1; setPendingBatch(pendingRef.current);
    lastTickRef.current = { key: Date.now() + Math.random(), value: 1 };
    setTick(lastTickRef.current);
    // typewriter "thunk" via Web Audio — short, dry
    try {
      const Ctor = window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        const t0 = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(180, t0);
        osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.07);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.10);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + 0.12);
        window.setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, 200);
      }
    } catch { /* silent */ }
    if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(flush, PUNCH_FLUSH_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current);
      flush().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <RoomFrame
      numeral="I"
      title="La Salle des Coups-de-Poing"
      tagline="Une seule touche d'Underwood Standard 5, frappée jusqu'à l'épuisement. Le registre, lui, ne dort jamais."
      surface="wood"
    >
      <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] items-center">
        {/* Typewriter key */}
        <div className="flex flex-col items-center justify-center min-h-[280px] relative">
          <button
            type="button"
            onClick={handlePunch}
            aria-label="Frapper le coup de poing"
            className="antre-typewriter-key"
          >
            <span
              className="antre-engraved"
              style={{
                color: "#2a1808",
                fontSize: 22,
                letterSpacing: "0.12em",
                textShadow: "0 1px 0 rgba(255, 220, 150, 0.7), 0 -1px 0 rgba(0,0,0,0.3)",
              }}
            >
              +1
            </span>
          </button>
          <AnimatePresence>
            {tick && (
              <m.span
                key={tick.key}
                initial={{ opacity: 0, y: 0, scale: 0.9 }}
                animate={{ opacity: 1, y: -50, scale: 1 }}
                exit={{ opacity: 0, y: -90 }}
                transition={{ duration: 1, ease: "easeOut" }}
                className="absolute pointer-events-none antre-engraved"
                style={{
                  top: "50%",
                  color: "var(--antre-flame)",
                  fontSize: 22,
                  textShadow: "0 0 12px rgba(240,193,74,0.7)",
                }}
                onAnimationComplete={() => setTick(null)}
              >
                +{tick.value}
              </m.span>
            )}
          </AnimatePresence>
          <p
            className="mt-6 antre-quill"
            style={{ color: "rgba(232,178,90,0.7)", fontSize: 14, letterSpacing: "0.05em" }}
          >
            Underwood Standard 5 · 1923
          </p>
        </div>

        {/* Parchment ledger */}
        <div
          className="antre-parchment antre-ledger-lines p-7"
          style={{ minHeight: 280, transform: "rotate(-0.4deg)" }}
        >
          <div className="flex items-baseline justify-between mb-5 pb-2 border-b border-[var(--antre-ink-soft)]/30">
            <h4 className="antre-engraved" style={{ fontSize: 13, color: "var(--antre-ink)" }}>
              Registre des Frappes
            </h4>
            <span className="antre-quill" style={{ color: "var(--antre-ink-soft)", fontSize: 13 }}>
              folio I
            </span>
          </div>
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="antre-quill" style={{ color: "var(--antre-ink)", fontSize: 16 }}>
                Coups portés ce soir
              </span>
              <span
                className="antre-handwriting"
                style={{
                  fontFamily: "var(--antre-font-quill)",
                  fontSize: 22,
                  color: "#2a1a4a",
                  fontWeight: 700,
                }}
              >
                {localCount.toLocaleString("fr-FR")}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="antre-quill" style={{ color: "var(--antre-ink)", fontSize: 16 }}>
                Au registre de la BCC
              </span>
              <span
                className="antre-handwriting"
                style={{
                  fontFamily: "var(--antre-font-quill)",
                  fontSize: 22,
                  color: "#2a1a4a",
                  fontWeight: 700,
                }}
              >
                {globalCount == null ? "…" : globalCount.toLocaleString("fr-FR")}
              </span>
            </div>
            {pendingBatch > 0 && (
              <p className="antre-quill text-right" style={{ color: "var(--antre-ink-faint)", fontSize: 12 }}>
                · {pendingBatch} en route vers la scribe
              </p>
            )}
          </div>

          <div className="mt-7 pt-4 border-t border-[var(--antre-ink-soft)]/30">
            <h5
              className="antre-engraved mb-3"
              style={{ fontSize: 11, color: "var(--antre-ink-soft)" }}
            >
              Top puncheurs de la session
            </h5>
            <ol className="space-y-2">
              {PUNCHER_LEADERBOARD.slice(0, 5).map((row, i) => (
                <li key={row.name} className="flex items-baseline justify-between">
                  <span
                    className="antre-quill"
                    style={{ color: "var(--antre-ink)", fontSize: 14 }}
                  >
                    <span style={{ color: "var(--antre-ink-faint)", marginRight: 8 }}>
                      {(["i", "ii", "iii", "iv", "v"] as const)[i]}.
                    </span>
                    {row.name}
                  </span>
                  <span
                    className="antre-handwriting"
                    style={{
                      fontFamily: "var(--antre-font-quill)",
                      fontSize: 15,
                      color: "#2a1a4a",
                    }}
                  >
                    {row.count} coups
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </RoomFrame>
  );
}

// ════════════════════════════════════════════════════════════════════
// Room II — Le Labo d'Observation (KR Challenger ladder)
// ════════════════════════════════════════════════════════════════════

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
        if (!cancelled) setData({
          entries: [],
          warning: `Le télégraphe est en dérangement : ${err instanceof Error ? err.message : "ligne brouillée"}`,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = window.setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  return (
    <RoomFrame
      numeral="II"
      title="Le Labo d'Observation"
      tagline="Espions de la BCC déployés en Corée du Sud — rapport en temps réel."
      surface="velvet"
    >
      <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
        {/* Old-world map of South Korea with brass tacks */}
        <div className="antre-old-map aspect-[3/4] rounded relative overflow-hidden">
          <svg viewBox="0 0 200 280" className="absolute inset-0 w-full h-full" aria-hidden>
            {/* Stylised SK silhouette */}
            <path
              d="M75 18 Q85 8 100 16 Q120 14 132 28 Q148 35 145 60 Q156 80 152 100 Q160 124 144 145 Q150 168 140 188 Q146 210 128 222 Q118 244 100 252 Q82 258 70 246 Q56 238 60 218 Q44 208 50 184 Q36 158 50 138 Q42 118 56 100 Q48 78 60 60 Q54 38 75 18 Z"
              fill="rgba(74, 46, 16, 0.18)"
              stroke="rgba(74, 46, 16, 0.55)"
              strokeWidth="1.2"
            />
            {/* Compass rose */}
            <g transform="translate(170 30)" opacity="0.6">
              <circle r="14" fill="none" stroke="#4a2e10" strokeWidth="0.8" />
              <path d="M0 -14 L3 0 L0 14 L-3 0 Z" fill="#6b1a26" />
              <path d="M-14 0 L0 -3 L14 0 L0 3 Z" fill="#4a2e10" />
              <text textAnchor="middle" y="-18" fontSize="6" fill="#4a2e10" fontFamily="serif">N</text>
            </g>
            {/* Brass tacks at the top-3 Challenger pins */}
            {data?.entries?.slice(0, 5).map((e, i) => {
              // arbitrary deterministic placement around the silhouette
              const xs = [100, 110, 92, 118, 86];
              const ys = [70, 110, 150, 92, 200];
              return (
                <g key={e.summonerName + i} transform={`translate(${xs[i]} ${ys[i]})`}>
                  <circle r="4" fill="url(#brassTack)" />
                  <circle r="4" fill="none" stroke="#4a2e08" strokeWidth="0.5" />
                  <text
                    y="-7" textAnchor="middle" fontSize="6"
                    fill="#2a1808" fontFamily="var(--antre-font-display), serif"
                    fontWeight="700"
                  >
                    {e.rank}
                  </text>
                </g>
              );
            })}
            <defs>
              <radialGradient id="brassTack" cx="35%" cy="35%" r="60%">
                <stop offset="0%" stopColor="#f0d488" />
                <stop offset="60%" stopColor="#a07533" />
                <stop offset="100%" stopColor="#4a2e08" />
              </radialGradient>
            </defs>
          </svg>
          <p
            className="absolute bottom-3 left-0 right-0 text-center antre-quill"
            style={{
              color: "rgba(42, 24, 8, 0.7)",
              fontSize: 12,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Carte du royaume coréen, 1893
          </p>
        </div>

        {/* Dossier — fountain-pen-on-parchment */}
        <div className="antre-parchment p-6">
          <div className="flex items-baseline justify-between mb-4 pb-2 border-b border-[var(--antre-ink-soft)]/30">
            <h4 className="antre-engraved" style={{ fontSize: 12, color: "var(--antre-ink)" }}>
              Dossier · Challenger Solo/Duo
            </h4>
            {data?.fetchedAt && (
              <span className="antre-quill" style={{ color: "var(--antre-ink-faint)", fontSize: 12 }}>
                {new Date(data.fetchedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>

          {loading && (
            <div className="py-10 text-center">
              <p className="antre-quill" style={{ color: "var(--antre-ink-soft)", fontSize: 14 }}>
                Le télégraphe transcrit le rapport…
              </p>
            </div>
          )}

          {!loading && data?.warning && (
            <div className="py-8 text-center">
              <RockingChair />
              <p className="mt-4 antre-quill italic" style={{ color: "var(--antre-ink)", fontSize: 15, maxWidth: 320, margin: "0 auto" }}>
                Le bureau du chef du renseignement est temporairement inoccupé.
              </p>
              <p className="mt-2 antre-quill" style={{ color: "var(--antre-ink-faint)", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase" }}>
                {data.warning}
              </p>
            </div>
          )}

          {!loading && !data?.warning && data && data.entries.length > 0 && (
            <ol className="space-y-2.5">
              {data.entries.map((e) => (
                <li
                  key={e.rank + e.summonerName}
                  className="grid grid-cols-[24px_1fr_auto] gap-3 items-baseline"
                >
                  <span
                    className="antre-engraved"
                    style={{
                      fontSize: 14, color: e.rank === 1 ? "#6b1a26" : "var(--antre-ink-soft)",
                    }}
                  >
                    {e.rank}.
                  </span>
                  <div className="min-w-0">
                    <p
                      className="antre-handwriting truncate"
                      style={{
                        fontFamily: "var(--antre-font-quill)",
                        fontSize: 16,
                        color: "var(--antre-ink)",
                        fontWeight: 600,
                        fontStyle: "italic",
                      }}
                    >
                      {e.summonerName}
                    </p>
                    <p className="antre-quill" style={{ color: "var(--antre-ink-faint)", fontSize: 11 }}>
                      {e.wins} V · {e.losses} D · {e.winrate}% WR
                      {e.hotStreak ? " · en feu" : ""}
                      {e.freshBlood ? " · sang neuf" : ""}
                      {e.veteran ? " · vétéran" : ""}
                    </p>
                  </div>
                  <span
                    className="antre-engraved"
                    style={{ fontSize: 13, color: "#6b1a26" }}
                  >
                    {e.leaguePoints} <span style={{ fontSize: 9, opacity: 0.6 }}>LP</span>
                  </span>
                </li>
              ))}
            </ol>
          )}

          {!loading && !data?.warning && data?.entries.length === 0 && (
            <p className="py-8 text-center antre-quill italic" style={{ color: "var(--antre-ink-soft)", fontSize: 14 }}>
              Le ladder est vide. Nos agents attendent en silence.
            </p>
          )}
        </div>
      </div>
    </RoomFrame>
  );
}

function RockingChair() {
  // Tiny SVG of an empty rocking chair, sketched line-art on parchment.
  return (
    <svg viewBox="0 0 80 80" width="64" height="64" className="mx-auto antre-candle-light" aria-hidden>
      <g fill="none" stroke="#4a2e10" strokeWidth="1.4" strokeLinecap="round">
        <path d="M22 22 L22 50 M22 50 L42 50 M42 22 L42 50" />
        <path d="M22 22 Q32 18 42 22" />
        <path d="M22 28 L42 28" />
        <path d="M18 50 Q40 64 64 50" />
        <path d="M16 56 Q40 70 66 56" />
        <path d="M42 28 L52 38 L52 50" />
      </g>
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════
// Room III — Le Salon de Stark Culture (magazine card + bibliothèque)
// ════════════════════════════════════════════════════════════════════

function StarkCultureRoom({ supabaseRef }: Pick<RpcRefs, "supabaseRef"> & Partial<RpcRefs>) {
  const todays = useMemo<StarkCultureEntry>(() => getTodaysStarkCultureEntry(), []);
  const [active, setActive] = useState<StarkCultureEntry>(todays);
  const [thematicKill, setThematicKill] = useState<KyeahooKill | null>(null);

  // Best-effort fetch a thematic kill matching today's entry.
  useEffect(() => {
    if (!active.thematicKill) { setThematicKill(null); return; }
    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;
    let cancelled = false;
    async function fetchThematic() {
      try {
        let q = sb
          .from("kills")
          .select(
            "id, killer_champion, victim_champion, clip_url_vertical, clip_url_vertical_low, thumbnail_url, highlight_score, avg_rating, rating_count, ai_description, multi_kill, is_first_blood, created_at, players!kills_killer_player_id_fkey(ign)",
          )
          .eq("status", "published")
          .order("highlight_score", { ascending: false, nullsFirst: false })
          .limit(1);
        const t = active.thematicKill!;
        if (t.champion) q = q.eq("killer_champion", t.champion);
        if (t.minHighlight) q = q.gte("highlight_score", t.minHighlight);
        if (t.multiKill) q = q.eq("multi_kill", t.multiKill);
        if (t.firstBlood) q = q.eq("is_first_blood", true);
        const { data } = await q;
        if (cancelled) return;
        const candidate = (data ?? []).find((row) => {
          if (!t.playerIgn) return true;
          const playerRow = (row as { players?: { ign?: string } | { ign?: string }[] }).players;
          const ign = Array.isArray(playerRow) ? playerRow[0]?.ign : playerRow?.ign;
          return ign?.toLowerCase() === t.playerIgn.toLowerCase();
        });
        if (candidate) {
          const playerRow = (candidate as { players?: { ign?: string } | { ign?: string }[] }).players;
          const killerName = Array.isArray(playerRow) ? playerRow[0]?.ign ?? null : playerRow?.ign ?? null;
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
        } else {
          setThematicKill(null);
        }
      } catch { setThematicKill(null); }
    }
    fetchThematic();
    return () => { cancelled = true; };
  }, [active, supabaseRef]);

  // Pick 8 deterministic spines for the bibliothèque (mix of the 30 entries)
  const shelf = useMemo(() => {
    // Take entries 0..29 and stride by 4 to get 8 distinct, varied authors
    const out: { entry: StarkCultureEntry; color: "burgundy" | "green" | "blue" | "cream" | "black" }[] = [];
    const colors = ["burgundy", "green", "blue", "cream", "black", "burgundy", "green", "blue"] as const;
    for (let i = 0; i < 8; i += 1) {
      const idx = (i * 4) % STARK_CULTURE_ENTRIES.length;
      out.push({ entry: STARK_CULTURE_ENTRIES[idx], color: colors[i] });
    }
    return out;
  }, []);

  return (
    <RoomFrame
      numeral="III"
      title="Le Salon de Stark Culture"
      tagline="Vingt-deux heures. M. Eto ouvre un livre. La BCC écoute en silence."
      surface="wood"
    >
      <div className="grid gap-7 lg:grid-cols-[1.4fr_1fr]">
        {/* Magazine quote — parchment */}
        <article className="antre-parchment p-8" style={{ transform: "rotate(-0.3deg)" }}>
          <div className="flex items-baseline justify-between mb-5 pb-2 border-b border-[var(--antre-ink-soft)]/35">
            <p className="antre-engraved" style={{ fontSize: 11, color: "#6b1a26", letterSpacing: "0.4em" }}>
              Stark Culture · 22h
            </p>
            <p className="antre-quill" style={{ color: "var(--antre-ink-faint)", fontSize: 12 }}>
              {new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
          <p
            className="antre-engraved mb-3"
            style={{ fontSize: 10, color: "#a07533", letterSpacing: "0.4em" }}
          >
            Thème · {active.theme}
          </p>
          <blockquote
            className="antre-dropcap"
            style={{
              fontFamily: "var(--antre-font-quill)",
              fontStyle: "italic",
              fontSize: "clamp(20px, 2.6vw, 28px)",
              lineHeight: 1.4,
              color: "var(--antre-ink)",
              marginBottom: 24,
            }}
          >
            <span aria-hidden style={{ color: "#a07533", marginRight: 2 }}>«</span>
            {active.quote}
            <span aria-hidden style={{ color: "#a07533", marginLeft: 2 }}>»</span>
          </blockquote>
          <footer className="border-l-2 border-[#a07533] pl-4">
            <p className="antre-engraved" style={{ fontSize: 14, color: "var(--antre-ink)" }}>
              {active.author}
            </p>
            <p className="antre-quill" style={{ fontSize: 12, color: "var(--antre-ink-soft)", marginTop: 4, letterSpacing: "0.15em", textTransform: "uppercase" }}>
              {active.attribution}
            </p>
          </footer>

          {active !== todays && (
            <button
              type="button"
              onClick={() => setActive(todays)}
              className="mt-6 antre-quill"
              style={{
                color: "#6b1a26",
                fontStyle: "italic",
                fontSize: 13,
                textDecoration: "underline",
                textUnderlineOffset: 3,
                textDecorationStyle: "dotted",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
              aria-label="Revenir à la citation du jour"
            >
              ← Revenir à la citation d&apos;aujourd&apos;hui
            </button>
          )}
        </article>

        {/* Découpe de presse (kill du jour) */}
        <div className="space-y-5">
          {thematicKill && thematicKill.thumbnail_url ? (
            <Link
              href={`/kill/${thematicKill.id}`}
              className="block"
              aria-label={`Kill du jour : ${thematicKill.killer_champion} face à ${thematicKill.victim_champion}`}
            >
              <NewspaperClipping
                thumbnail={thematicKill.thumbnail_url}
                title={`${thematicKill.killer_champion} → ${thematicKill.victim_champion}`}
                caption={active.killCaption}
              />
            </Link>
          ) : (
            <NewspaperClipping
              title="Aucun kill thématique"
              caption={active.killCaption}
            />
          )}
        </div>
      </div>

      {/* Bibliothèque — 8 book spines on a shelf */}
      <div className="mt-10">
        <p className="antre-engraved mb-4" style={{ fontSize: 11, color: "var(--antre-flame-amber)", letterSpacing: "0.4em" }}>
          La Bibliothèque de la BCC
        </p>
        <div
          className="relative pt-3 pb-4"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, transparent 90%, #3a1f0e 90%, #2a1408 100%)",
          }}
        >
          <div
            className="flex items-end gap-2 px-3"
            style={{
              borderTop: "2px solid rgba(184, 133, 42, 0.5)",
              paddingTop: 14,
            }}
          >
            {shelf.map((s, i) => (
              <button
                key={s.entry.author + i}
                type="button"
                onClick={() => setActive(s.entry)}
                className={`antre-book-spine antre-book-${s.color}`}
                aria-label={`Lire la citation : ${s.entry.author} — ${s.entry.attribution}`}
                title={`${s.entry.author} — ${s.entry.theme}`}
              >
                <span className="antre-book-label">
                  {s.entry.author.split(" ")[0]} · {s.entry.theme}
                </span>
              </button>
            ))}
          </div>
          {/* shelf shadow */}
          <div
            className="absolute left-0 right-0 h-3"
            style={{
              bottom: 0,
              background:
                "linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 100%)",
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
    </RoomFrame>
  );
}

function NewspaperClipping({
  thumbnail,
  title,
  caption,
}: {
  thumbnail?: string;
  title: string;
  caption: string;
}) {
  return (
    <div
      className="antre-parchment relative"
      style={{
        padding: 14,
        transform: "rotate(1.2deg)",
        clipPath:
          "polygon(0 1%, 4% 0, 12% 2%, 22% 0, 35% 2%, 50% 0, 65% 1%, 78% 0, 90% 2%, 100% 0, 100% 100%, 92% 99%, 78% 100%, 64% 98%, 50% 100%, 36% 98%, 22% 100%, 8% 98%, 0 100%)",
      }}
    >
      <p
        className="antre-engraved"
        style={{
          fontSize: 9,
          color: "#6b1a26",
          letterSpacing: "0.4em",
          marginBottom: 8,
        }}
      >
        Le Petit Journal de la BCC · n° {Math.floor(Math.random() * 900) + 100}
      </p>
      {thumbnail && (
        <div
          className="relative w-full aspect-[3/4] overflow-hidden mb-3"
          style={{
            filter: "sepia(0.45) contrast(0.95) brightness(0.95) grayscale(0.25)",
            border: "1px solid rgba(74, 46, 16, 0.4)",
            boxShadow: "inset 0 0 15px rgba(74, 46, 16, 0.25)",
          }}
        >
          <Image
            src={thumbnail}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 300px"
            className="object-cover"
          />
        </div>
      )}
      <p
        className="antre-engraved leading-tight mb-2"
        style={{
          fontSize: 14,
          color: "var(--antre-ink)",
          letterSpacing: "0.05em",
        }}
      >
        {title}
      </p>
      <p
        className="antre-quill italic"
        style={{ fontSize: 13, color: "var(--antre-ink-soft)", lineHeight: 1.5 }}
      >
        {caption}
      </p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Room IV — Le Stand de Lancer-Tomates (gilt-framed Zaboutine)
// ════════════════════════════════════════════════════════════════════

interface TomatoSplat { id: number; x: number; y: number; }

function LanceTomatesRoom({ sessionHashRef, supabaseRef }: RpcRefs) {
  const [tomatoCount, setTomatoCount] = useState<number | null>(null);
  const [sessionThrows, setSessionThrows] = useState(0);
  const [splats, setSplats] = useState<TomatoSplat[]>([]);
  const [flying, setFlying] = useState<
    { id: number; startX: number; startY: number; targetX: number; targetY: number }[]
  >([]);
  const [secretShown, setSecretShown] = useState(false);
  const [armed, setArmed] = useState(false);     // user grabbed a tomato from the bucket
  const stickerRef = useRef<HTMLDivElement>(null);
  const tomatoIdRef = useRef(0);

  useEffect(() => {
    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;
    let cancelled = false;
    async function poll() {
      try {
        const { data } = await sb.from("bcc_tomatoes").select("count").eq("id", "global").single();
        if (!cancelled && data) {
          const n = typeof data.count === "string" ? Number(data.count) : data.count;
          if (typeof n === "number" && !Number.isNaN(n)) setTomatoCount(n);
        }
      } catch { /* ignore */ }
    }
    poll();
    const t = window.setInterval(poll, 4000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [supabaseRef]);

  useEffect(() => {
    if (sessionThrows >= 10 || (tomatoCount != null && tomatoCount >= 100)) {
      setSecretShown(true);
    }
  }, [sessionThrows, tomatoCount]);

  const playSplat = useCallback(() => {
    try {
      const Ctor = window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const t0 = ctx.currentTime;
      const bufferSize = Math.floor(ctx.sampleRate * 0.12);
      const noise = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.32, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
      src.connect(gain).connect(ctx.destination);
      src.start(t0);
      window.setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, 300);
    } catch { /* silent */ }
  }, []);

  const fire = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!armed) return; // must grab a tomato first
    const sticker = stickerRef.current;
    if (!sticker) return;
    const rect = sticker.getBoundingClientRect();
    const targetX = ((e.clientX - rect.left) / rect.width) * 100;
    const targetY = ((e.clientY - rect.top) / rect.height) * 100;
    const id = ++tomatoIdRef.current;
    setFlying((p) => [...p, { id, startX: 50, startY: 110, targetX, targetY }]);
    window.setTimeout(() => {
      setFlying((p) => p.filter((t) => t.id !== id));
      setSplats((p) => {
        const next = [...p, { id, x: targetX, y: targetY }];
        return next.length > 20 ? next.slice(-20) : next;
      });
      playSplat();
      window.setTimeout(() => {
        setSplats((p) => p.filter((s) => s.id !== id));
      }, 5000);
    }, 650);
    setSessionThrows((n) => n + 1);
    setArmed(false);
    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;
    void Promise.resolve(
      sb.rpc("fn_bcc_tomato", { p_session_hash: sessionHashRef.current }),
    ).then(({ data }) => {
      if (typeof data === "number") setTomatoCount(data);
      else if (typeof data === "string") {
        const n = Number(data); if (!Number.isNaN(n)) setTomatoCount(n);
      }
    }).catch(() => {});
  }, [armed, playSplat, sessionHashRef, supabaseRef]);

  return (
    <RoomFrame
      numeral="IV"
      title="Le Stand de Lancer-Tomates"
      tagline="Saisissez une tomate dans le seau. Visez le portrait. Le club garde le compte."
      surface="wood"
    >
      <div className="grid gap-8 md:grid-cols-[1.4fr_1fr] items-start">
        {/* Brick wall + gilt-framed Zaboutine portrait */}
        <div
          className="antre-brick-wall relative p-6 rounded"
          style={{ minHeight: 380 }}
        >
          <div
            ref={stickerRef}
            onClick={fire}
            role="button"
            tabIndex={0}
            aria-label={armed ? "Lancer une tomate sur le portrait" : "Saisir une tomate dans le seau d'abord"}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && armed) {
                e.preventDefault();
                const rect = stickerRef.current?.getBoundingClientRect();
                if (!rect) return;
                fire({
                  clientX: rect.left + rect.width / 2 + (Math.random() - 0.5) * 80,
                  clientY: rect.top + rect.height / 2 + (Math.random() - 0.5) * 80,
                } as React.MouseEvent<HTMLDivElement>);
              }
            }}
            className="antre-gilt-frame relative mx-auto"
            style={{
              width: "min(280px, 80%)",
              cursor: armed ? "crosshair" : "default",
            }}
          >
            <div className="aspect-[3/4] relative overflow-hidden bg-[#0a0606]">
              <Image
                src="/images/zaboutine-sticker.png"
                alt="M. Thomas Si-Hassen, l'analyste préféré de la BCC"
                fill
                sizes="280px"
                className="object-cover"
                style={{ filter: "sepia(0.25) contrast(1.05) brightness(0.92)" }}
              />
              {/* Active flying tomatoes */}
              {flying.map((t) => (
                <m.div
                  key={`flying-${t.id}`}
                  className="absolute pointer-events-none"
                  style={{
                    width: 28, height: 28,
                    left: `${t.startX}%`, top: `${t.startY}%`,
                    marginLeft: -14, marginTop: -14,
                    willChange: "transform, opacity",
                  }}
                  initial={{ x: 0, y: 0, rotate: 0, scale: 0.5, opacity: 1 }}
                  animate={{
                    x: [
                      0,
                      ((t.targetX - t.startX) / 100) * (stickerRef.current?.offsetWidth ?? 320) * 0.5,
                      ((t.targetX - t.startX) / 100) * (stickerRef.current?.offsetWidth ?? 320),
                    ],
                    y: [
                      0, -180,
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
              {/* Splats (wet paint on canvas) */}
              {splats.map((s) => (
                <m.div
                  key={`splat-${s.id}`}
                  className="absolute pointer-events-none"
                  style={{ left: `${s.x}%`, top: `${s.y}%`, marginLeft: -32, marginTop: -32 }}
                  initial={{ scale: 0, opacity: 1 }}
                  animate={{ scale: [0, 1.3, 1], opacity: [1, 1, 1, 0] }}
                  transition={{ duration: 5, times: [0, 0.06, 0.12, 1] }}
                >
                  <SplatIcon />
                </m.div>
              ))}
            </div>
          </div>

          {/* Brass nameplate below the frame */}
          <div className="flex justify-center mt-4">
            <div
              className="antre-brass-plate"
              style={{ fontSize: 11, padding: "10px 24px", letterSpacing: "0.22em" }}
            >
              M. Thomas Si-Hassen
              <div style={{ marginTop: 4, fontSize: "0.8em", fontWeight: 400, fontStyle: "italic", letterSpacing: "0.06em", textTransform: "none" }}>
                analyste préféré de la BCC
              </div>
            </div>
          </div>

          {/* Bucket of tomatoes — click to arm */}
          <button
            type="button"
            onClick={() => setArmed(true)}
            disabled={armed}
            aria-label={armed ? "Tomate en main" : "Prendre une tomate du seau"}
            className="absolute"
            style={{
              bottom: 12, right: 14,
              background: "transparent",
              border: "none",
              cursor: armed ? "default" : "pointer",
              filter: armed ? "brightness(0.85)" : "drop-shadow(0 0 12px rgba(240,193,74,0.4))",
              transition: "filter 200ms",
            }}
          >
            <div className="antre-bucket relative">
              <div className="antre-bucket-rim" />
              {/* tomatoes stacked in the bucket */}
              <div
                style={{
                  position: "absolute", top: 18, left: "50%",
                  transform: "translateX(-50%)", display: "flex",
                  gap: 2,
                }}
              >
                <BucketTomato />
                <BucketTomato />
                <BucketTomato small />
              </div>
            </div>
            <p
              className="antre-quill mt-1 text-center"
              style={{ fontSize: 10, color: "rgba(240,193,74,0.85)", letterSpacing: "0.1em" }}
            >
              {armed ? "en main" : "seau"}
            </p>
          </button>
        </div>

        {/* Chalkboard tally */}
        <div className="space-y-5">
          <div className="antre-chalkboard rounded p-6" style={{ minHeight: 220 }}>
            <p className="text-center mb-4" style={{ fontSize: 26, lineHeight: 1.1, transform: "rotate(-1deg)" }}>
              Tomates lancées
            </p>
            <p className="text-center mb-1" style={{ fontSize: 14, opacity: 0.85, transform: "rotate(-0.5deg)" }}>
              ce soir
            </p>
            <p className="text-center" style={{ fontSize: 52, fontWeight: 700, color: "#f0c14a", textShadow: "0 0 12px rgba(240,193,74,0.5)" }}>
              {sessionThrows}
            </p>
            <div
              style={{
                margin: "16px auto 8px",
                width: "60%",
                borderTop: "1px dashed rgba(240,232,210,0.4)",
              }}
            />
            <p className="text-center" style={{ fontSize: 12, opacity: 0.7 }}>
              Total du club
            </p>
            <p className="text-center" style={{ fontSize: 22, fontWeight: 600 }}>
              {tomatoCount == null ? "…" : tomatoCount.toLocaleString("fr-FR")}
            </p>
          </div>

          <AnimatePresence>
            {secretShown && (
              <m.div
                key="secret"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="antre-parchment p-4 text-center"
                style={{ transform: "rotate(0.6deg)" }}
              >
                <p
                  className="antre-engraved mb-2"
                  style={{ fontSize: 10, color: "#6b1a26", letterSpacing: "0.4em" }}
                >
                  Message scellé
                </p>
                <p
                  className="antre-quill italic"
                  style={{ color: "var(--antre-ink)", fontSize: 14, lineHeight: 1.5 }}
                >
                  &laquo; M. Si-Hassen vous regarde dans le blanc des yeux. Il reviendra
                  demain, et il aura tout noté. &raquo;
                </p>
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </RoomFrame>
  );
}

function TomatoIcon() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
      <ellipse cx="16" cy="18" rx="11" ry="10" fill="#a8233a" />
      <ellipse cx="13" cy="15" rx="3" ry="2" fill="#c83a52" opacity="0.65" />
      <path d="M16 8 L13 4 L19 4 Z M16 8 L11 5 M16 8 L21 5 M16 8 L16 3" stroke="#3a5a1c" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <ellipse cx="16" cy="8" rx="2" ry="1" fill="#5a8224" />
    </svg>
  );
}

function SplatIcon() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden>
      <defs>
        <radialGradient id="bccSplatGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#c83a52" />
          <stop offset="55%" stopColor="#8b1f30" />
          <stop offset="100%" stopColor="#3a0612" />
        </radialGradient>
      </defs>
      <g fill="url(#bccSplatGrad)" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}>
        <ellipse cx="32" cy="32" rx="14" ry="13" />
        <ellipse cx="14" cy="22" rx="6" ry="4" />
        <ellipse cx="50" cy="40" rx="7" ry="5" />
        <ellipse cx="20" cy="48" rx="5" ry="3" />
        <ellipse cx="48" cy="14" rx="4" ry="3" />
        <ellipse cx="10" cy="36" rx="3" ry="2" />
        <ellipse cx="54" cy="26" rx="3" ry="2" />
        <ellipse cx="34" cy="54" rx="4" ry="2" />
      </g>
      <g fill="#e8a0b0" opacity="0.4">
        <ellipse cx="28" cy="28" rx="3" ry="2" />
      </g>
    </svg>
  );
}

function BucketTomato({ small }: { small?: boolean }) {
  const r = small ? 8 : 10;
  return (
    <svg width={r * 2.2} height={r * 2.2} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="13" r={r} fill="#a8233a" />
      <ellipse cx="9" cy="10" rx="2" ry="1.4" fill="#c83a52" opacity="0.7" />
      <path d="M12 7 L10 4 L14 4 Z" fill="#3a5a1c" />
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════
// Room V — Le Mur des Ahou-Ahou (Kyeahoo kill gallery wall)
// ════════════════════════════════════════════════════════════════════

const FRENCH_MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function vintageDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "date oubliée";
  const days = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const day = days[d.getDay()];
  const num = d.getDate();
  const month = FRENCH_MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const hour = d.getHours();
  const hr = hour === 0 ? "minuit" :
    hour <= 12 ? `${hour}h du matin` :
    `${hour - 12}h du soir`;
  // "Mardi, le 11 mai 2026, onze heures du soir"
  return `${day.charAt(0).toUpperCase() + day.slice(1)}, le ${num} ${month} ${year}, ${hr}`;
}

function MurAhouAhouRoom({ sessionHashRef, supabaseRef }: RpcRefs) {
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
        if (!cancelled && !error && Array.isArray(data)) setKills(data as KyeahooKill[]);
        else if (!cancelled) setKills([]);
      } catch { if (!cancelled) setKills([]); }
    }
    load();
    return () => { cancelled = true; };
  }, [supabaseRef]);

  const handleHover = useCallback((killId: string) => {
    if (hoveredRef.current.has(killId)) return;
    hoveredRef.current.add(killId);
    // Transient 4s ahou-ahou sample — `new Audio()`, NOT routed via the wolf
    // player so it doesn't interrupt the looping OTT.
    try {
      const a = new Audio("/audio/ahou-ahou.mp3");
      a.volume = 0.5;
      a.play().catch(() => {/* silent — file may not be deployed yet */});
    } catch { /* ignore */ }
    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;
    void Promise.resolve(
      sb.rpc("fn_bcc_ahou_played", { p_session_hash: sessionHashRef.current }),
    ).catch(() => {});
  }, [sessionHashRef, supabaseRef]);

  return (
    <RoomFrame
      numeral="V"
      title="Le Mur des Ahou-Ahou"
      tagline="Galerie privée de M. Kyeahoo. Passez la main au-dessus d'un cadre pour qu'il chante."
      surface="velvet"
    >
      {kills === null && (
        <div className="py-10 text-center">
          <p className="antre-quill italic" style={{ color: "var(--antre-flame-amber)", fontSize: 15 }}>
            Le concierge accroche les cadres…
          </p>
        </div>
      )}
      {kills !== null && kills.length === 0 && (
        <div className="text-center py-10">
          <p
            className="antre-engraved mb-2"
            style={{ color: "var(--antre-flame-bright)", fontSize: 14, letterSpacing: "0.3em" }}
          >
            Le mur attend.
          </p>
          <p className="antre-quill" style={{ color: "rgba(240,232,210,0.6)", fontSize: 14, maxWidth: 420, margin: "0 auto" }}>
            Aucune exécution de M. Kyeahoo n&apos;a encore été archivée par le club.
          </p>
        </div>
      )}
      {kills !== null && kills.length > 0 && (
        <div
          className="grid gap-5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
        >
          {kills.map((kill) => (
            <button
              key={kill.id}
              type="button"
              onMouseEnter={() => handleHover(kill.id)}
              onFocus={() => handleHover(kill.id)}
              onClick={() => setOpenKill(kill)}
              className="group block text-left antre-gilt-frame transition-transform"
              aria-label={`Kill de Kyeahoo : ${kill.killer_champion} face à ${kill.victim_champion}`}
              style={{ padding: 12 }}
            >
              <div className="relative aspect-[3/4] overflow-hidden bg-[#0a0606]">
                {kill.thumbnail_url ? (
                  <Image
                    src={kill.thumbnail_url}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                    style={{ filter: "sepia(0.3) contrast(1.05) brightness(0.92)" }}
                  />
                ) : (
                  <div className="absolute inset-0" style={{ background: "#1a0808" }} />
                )}
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.7) 100%)",
                  }}
                />
                {/* Top-left badges */}
                <div className="absolute top-2 left-2 z-10 flex flex-wrap gap-1">
                  {kill.is_first_blood && (
                    <span
                      className="antre-engraved"
                      style={{
                        padding: "2px 6px",
                        background: "rgba(74, 14, 26, 0.85)",
                        border: "1px solid rgba(232, 178, 90, 0.4)",
                        color: "#f0c14a",
                        fontSize: 9,
                        letterSpacing: "0.15em",
                      }}
                    >
                      First Blood
                    </span>
                  )}
                  {kill.multi_kill && (
                    <span
                      className="antre-engraved"
                      style={{
                        padding: "2px 6px",
                        background: "rgba(42, 24, 8, 0.85)",
                        border: "1px solid rgba(232, 178, 90, 0.55)",
                        color: "#f0d488",
                        fontSize: 9,
                        letterSpacing: "0.15em",
                      }}
                    >
                      {kill.multi_kill}
                    </span>
                  )}
                </div>
                {/* Bottom-left champion match-up */}
                <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
                  {kill.killer_champion && (
                    <Image
                      src={championIconUrl(kill.killer_champion)}
                      alt={kill.killer_champion}
                      width={20} height={20}
                      className="rounded-full"
                      style={{ border: "1px solid rgba(232,178,90,0.7)" }}
                    />
                  )}
                  <span
                    className="antre-engraved truncate"
                    style={{
                      fontSize: 10,
                      color: "var(--antre-flame-bright)",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {kill.killer_champion} → {kill.victim_champion}
                  </span>
                </div>
              </div>
              {/* Brass plaque under the photo */}
              <div className="pt-3 pb-1 text-center">
                <p
                  className="antre-quill italic"
                  style={{
                    color: "var(--antre-flame-amber)",
                    fontSize: 11,
                    lineHeight: 1.3,
                  }}
                >
                  {vintageDateLabel(kill.created_at)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Modal — kill clip player (kept simple, on burgundy backdrop) */}
      <AnimatePresence>
        {openKill && (
          <m.div
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
            style={{ background: "rgba(8, 4, 2, 0.92)", backdropFilter: "blur(4px)" }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setOpenKill(null)}
            role="dialog" aria-modal="true" aria-label="Lecture du kill"
          >
            <m.div
              className="antre-gilt-frame relative w-full max-w-md"
              initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              style={{ padding: 18 }}
            >
              <div className="aspect-[9/16] bg-black overflow-hidden">
                {openKill.clip_url_vertical ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    src={openKill.clip_url_vertical}
                    poster={openKill.thumbnail_url ?? undefined}
                    autoPlay controls loop playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full antre-quill" style={{ color: "rgba(240,232,210,0.6)" }}>
                    Clip indisponible.
                  </div>
                )}
              </div>
              <div className="absolute top-3 right-3 z-10">
                <button
                  type="button"
                  onClick={() => setOpenKill(null)}
                  aria-label="Fermer"
                  className="rounded-full p-2"
                  style={{
                    background: "rgba(20,8,4,0.85)",
                    border: "1px solid rgba(232,178,90,0.55)",
                    color: "var(--antre-flame-bright)",
                  }}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="mt-3 text-center">
                <p
                  className="antre-engraved"
                  style={{
                    fontSize: 13,
                    color: "var(--antre-flame-bright)",
                    letterSpacing: "0.15em",
                  }}
                >
                  {openKill.killer_champion} → {openKill.victim_champion}
                </p>
                {openKill.ai_description && (
                  <p
                    className="antre-quill italic mt-2"
                    style={{ color: "rgba(240,232,210,0.78)", fontSize: 12 }}
                  >
                    « {openKill.ai_description} »
                  </p>
                )}
                <Link
                  href={`/kill/${openKill.id}`}
                  onClick={() => setOpenKill(null)}
                  className="antre-engraved mt-3 inline-block"
                  style={{
                    fontSize: 10,
                    color: "var(--antre-flame)",
                    letterSpacing: "0.3em",
                  }}
                >
                  Page complète →
                </Link>
              </div>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </RoomFrame>
  );
}

// ════════════════════════════════════════════════════════════════════
// Room VI — Le Registre des Membres (guestbook + new entry)
// ════════════════════════════════════════════════════════════════════

function RegistreMembresRoom({ sessionHashRef }: Pick<RpcRefs, "sessionHashRef">) {
  const past = useMemo(() => seedVisitors(18), []);
  const [myName, setMyName] = useState<string>("Visiteur masqué");
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    // Read the real session hash after mount and derive the alias.
    const name = visitorNameFromHash(sessionHashRef.current || "bcc-anon");
    setMyName(name);
    // Pause briefly to let the room render, then "write" the entry.
    const t = window.setTimeout(() => setReveal(true), 600);
    return () => window.clearTimeout(t);
  }, [sessionHashRef]);

  const todayLabel = useMemo(() => {
    const d = new Date();
    return `${d.getDate()} ${FRENCH_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }, []);

  return (
    <RoomFrame
      numeral="VI"
      title="Le Registre des Membres"
      tagline="Le portier vous prie d'inscrire votre nom — la plume est trempée, le sous-main préparé."
      surface="wood"
    >
      <div className="antre-guestbook p-6 sm:p-10 mx-auto" style={{ maxWidth: 880 }}>
        <div className="text-center mb-6 pb-4 border-b border-[var(--antre-ink-soft)]/30">
          <p className="antre-engraved" style={{ fontSize: 11, color: "#6b1a26", letterSpacing: "0.4em" }}>
            Registre des Initiés
          </p>
          <p className="antre-quill italic mt-2" style={{ color: "var(--antre-ink-soft)", fontSize: 13 }}>
            tenu par le concierge depuis le premier soir
          </p>
        </div>

        <ol className="grid gap-y-2 gap-x-10 sm:grid-cols-2 mb-6">
          {past.map((v, i) => (
            <li
              key={v.key}
              className="flex items-baseline justify-between gap-3"
              style={{ paddingBottom: 2, borderBottom: "1px dotted rgba(74, 46, 16, 0.18)" }}
            >
              <span
                className="antre-handwriting truncate"
                style={{
                  fontFamily: "var(--antre-font-quill)",
                  fontStyle: "italic",
                  fontSize: 16,
                  color: "#2a1a4a",
                }}
              >
                <span style={{ color: "var(--antre-ink-faint)", marginRight: 8, fontStyle: "normal" }}>
                  {i + 1}.
                </span>
                {v.name}
              </span>
            </li>
          ))}
        </ol>

        {/* The new entry — quill writes it in */}
        <div
          className="mt-8 pt-4"
          style={{ borderTop: "2px solid rgba(74, 46, 16, 0.35)" }}
        >
          <div className="flex items-baseline justify-between">
            <span
              className={`antre-handwriting ${reveal ? "antre-quill-anim" : ""}`}
              style={{
                fontFamily: "var(--antre-font-quill)",
                fontStyle: "italic",
                fontSize: 22,
                color: "#1a0a3a",
                fontWeight: 600,
                visibility: reveal ? "visible" : "hidden",
              }}
            >
              {past.length + 1}. {myName}
            </span>
            <span
              className="antre-quill"
              style={{
                color: "var(--antre-ink-soft)",
                fontSize: 13,
                fontStyle: "italic",
              }}
            >
              le {todayLabel}
            </span>
          </div>
          <p
            className="antre-quill italic mt-3"
            style={{ color: "var(--antre-ink-faint)", fontSize: 12 }}
          >
            ↑ vous venez d&apos;être inscrit · le concierge a pris note
          </p>
        </div>
      </div>
    </RoomFrame>
  );
}
