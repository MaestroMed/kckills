"use client";

/**
 * VSStreamMode — the /vs/stream client. See app/vs/stream/page.tsx for the
 * concept ; this file is the whole show.
 *
 * Layout is a fixed overlay (site chrome stays mounted underneath, like
 * /chambre) : two 50vw video panes facing off across a central VS totem,
 * a countdown ring, and a bottom arbitration bar. Everything is sized in
 * viewport units so an OBS browser-source at 1920×1080 captures it clean.
 *
 * Host controls : ← vote gauche · → vote droite · ↓ égalité · Espace
 * relance · M bascule le son du côté survolé. Clicking a pane votes too.
 * Votes ride fn_record_vs_vote with the SAME session hash as /vs — the
 * host is one voter among the crowd, no special weight.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReducedMotion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { getVSSessionHash } from "@/lib/vs-roulette";
import { MatchupIntro } from "@/components/vs/MatchupIntro";

// ─── Types ────────────────────────────────────────────────────────────

interface StreamKill {
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
  multi_kill: string | null;
  is_first_blood: boolean | null;
  elo_rating: number | null;
  elo_battles: number | null;
  match_date: string | null;
  ai_description: string | null;
}

type Phase = "spinning" | "intro" | "duel" | "revealed" | "empty" | "error";

interface EloOutcome {
  aElo: number;
  bElo: number;
  aDelta: number;
  bDelta: number;
  winner: "a" | "b" | "tie";
}

const MULTI_LABEL: Record<string, string> = {
  penta: "PENTA",
  quadra: "QUADRA",
  triple: "TRIPLE",
  double: "DOUBLE",
};

const REVEAL_NEXT_MS = 6500;

// ─── Component ────────────────────────────────────────────────────────

export function VSStreamMode() {
  const reduce = useReducedMotion() ?? false;
  const params = useSearchParams();
  const pinLeft = params.get("left") ?? "";
  const pinRight = params.get("right") ?? "";
  const auto = params.get("auto") === "1";
  const duelSeconds = useMemo(() => {
    const raw = Number(params.get("t") ?? 25);
    return Number.isFinite(raw) ? Math.min(90, Math.max(10, raw)) : 25;
  }, [params]);

  const sb = useMemo(() => createClient(), []);
  const [phase, setPhase] = useState<Phase>("spinning");
  const [pair, setPair] = useState<{ a: StreamKill; b: StreamKill } | null>(null);
  const [outcome, setOutcome] = useState<EloOutcome | null>(null);
  const [duelNo, setDuelNo] = useState(0);
  const [remaining, setRemaining] = useState(duelSeconds);
  const [audioSide, setAudioSide] = useState<"a" | "b" | null>(null);
  const hoverSide = useRef<"a" | "b" | null>(null);
  const spinningRef = useRef(false);

  // ── Spin : pick a fresh pair ────────────────────────────────────────
  const spin = useCallback(async () => {
    if (spinningRef.current) return;
    spinningRef.current = true;
    setPhase("spinning");
    setOutcome(null);
    setAudioSide(null);
    try {
      const filters = (pin: string) => (pin ? { player_slug: pin } : {});
      const { data, error } = await sb.rpc("fn_pick_vs_pair", {
        left_filters: filters(pinLeft),
        right_filters: filters(pinRight),
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row?.kill_a || !row?.kill_b) {
        setPhase(error ? "error" : "empty");
        return;
      }
      setPair({ a: row.kill_a as StreamKill, b: row.kill_b as StreamKill });
      setDuelNo((n) => n + 1);
      setRemaining(duelSeconds);
      // Le matchup façon jeu de combat se joue d'abord ; le duel (et son
      // countdown) démarre à la résolution de l'intro.
      setPhase("intro");
    } catch {
      setPhase("error");
    } finally {
      spinningRef.current = false;
    }
  }, [sb, pinLeft, pinRight, duelSeconds]);

  useEffect(() => {
    void spin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Countdown ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "duel") return;
    if (remaining <= 0) {
      if (auto) void spin();
      return;
    }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, remaining, auto, spin]);

  // ── Vote ────────────────────────────────────────────────────────────
  const vote = useCallback(
    async (winner: "a" | "b" | "tie") => {
      if (phase !== "duel" || !pair) return;
      const preA = pair.a.elo_rating ?? 1500;
      const preB = pair.b.elo_rating ?? 1500;
      setPhase("revealed");
      try {
        const { data } = await sb.rpc("fn_record_vs_vote", {
          p_kill_a: pair.a.id,
          p_kill_b: pair.b.id,
          p_winner:
            winner === "tie" ? null : winner === "a" ? pair.a.id : pair.b.id,
          p_session_hash: getVSSessionHash(),
          p_filters: { pool_id: "stream-mode" },
        });
        const row = Array.isArray(data) ? data[0] : data;
        // The RPC normalises pair order — remap onto OUR a/b.
        let aElo = preA;
        let bElo = preB;
        if (row) {
          aElo = row.kill_a_id === pair.a.id ? row.kill_a_elo : row.kill_b_elo;
          bElo = row.kill_b_id === pair.b.id ? row.kill_b_elo : row.kill_a_elo;
        }
        setOutcome({
          aElo,
          bElo,
          aDelta: Math.round(aElo - preA),
          bDelta: Math.round(bElo - preB),
          winner,
        });
      } catch {
        setOutcome({ aElo: preA, bElo: preB, aDelta: 0, bDelta: 0, winner });
      }
    },
    [phase, pair, sb],
  );

  // ── Auto-next after reveal ──────────────────────────────────────────
  useEffect(() => {
    if (phase !== "revealed") return;
    const t = setTimeout(() => void spin(), REVEAL_NEXT_MS);
    return () => clearTimeout(t);
  }, [phase, spin]);

  // ── Keyboard arbitration ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          void vote("a");
          break;
        case "ArrowRight":
          e.preventDefault();
          void vote("b");
          break;
        case "ArrowDown":
          e.preventDefault();
          void vote("tie");
          break;
        case " ":
        case "Space":
        case "Spacebar":
          e.preventDefault();
          if (phase === "revealed" || phase === "duel" || phase === "empty") {
            void spin();
          }
          break;
        case "m":
        case "M":
          if (hoverSide.current) {
            setAudioSide((s) =>
              s === hoverSide.current ? null : hoverSide.current,
            );
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vote, spin, phase]);

  // ── Render ──────────────────────────────────────────────────────────

  if (phase === "empty" || phase === "error") {
    return (
      <div className="fixed inset-0 z-[60] grid place-items-center bg-[#03060c] px-6 text-center">
        <div>
          <p className="font-display text-3xl font-black text-[var(--gold-bright)]">
            {phase === "empty" ? "La roulette est à sec" : "La roulette a déraillé"}
          </p>
          <p className="mt-3 text-sm text-white/60">
            {phase === "empty"
              ? "Aucune paire ne correspond à ces filtres. Retire ?left / ?right ou élargis."
              : "Un problème réseau. Espace pour relancer."}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void spin()}
              style={{ background: "var(--gold-gradient)" }}
              className="rounded-full px-6 py-3 font-display text-sm font-bold uppercase tracking-[0.1em] text-[#1a1206]"
            >
              Relancer
            </button>
            <Link
              href="/vs"
              className="rounded-full border border-white/20 px-6 py-3 text-sm text-white/80 hover:border-[var(--gold)]"
            >
              Mode classique
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const pct = phase === "duel" ? remaining / duelSeconds : 0;

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-[#03060c] select-none">
      {/* ── The two panes ─────────────────────────────────────────── */}
      <div className="absolute inset-0 flex">
        <StreamPane
          side="a"
          kill={pair?.a ?? null}
          phase={phase}
          outcome={outcome}
          audioOn={audioSide === "a"}
          reduce={reduce}
          onVote={() => void vote("a")}
          onHover={(h) => {
            hoverSide.current = h ? "a" : hoverSide.current === "a" ? null : hoverSide.current;
          }}
        />
        <StreamPane
          side="b"
          kill={pair?.b ?? null}
          phase={phase}
          outcome={outcome}
          audioOn={audioSide === "b"}
          reduce={reduce}
          onVote={() => void vote("b")}
          onHover={(h) => {
            hoverSide.current = h ? "b" : hoverSide.current === "b" ? null : hoverSide.current;
          }}
        />
      </div>

      {/* ── Central totem : VS + countdown ring ───────────────────── */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-[70] -translate-x-1/2 -translate-y-1/2">
        <div className="relative grid place-items-center">
          <svg width="150" height="150" viewBox="0 0 150 150" aria-hidden>
            <circle
              cx="75"
              cy="75"
              r="66"
              fill="rgba(1,10,19,0.88)"
              stroke="rgba(200,170,110,0.25)"
              strokeWidth="2"
            />
            {phase === "duel" && (
              <circle
                cx="75"
                cy="75"
                r="66"
                fill="none"
                stroke={remaining <= 5 ? "var(--red)" : "var(--gold)"}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 66}
                strokeDashoffset={2 * Math.PI * 66 * (1 - pct)}
                transform="rotate(-90 75 75)"
                style={{
                  transition: reduce ? "none" : "stroke-dashoffset 1s linear, stroke 0.3s",
                }}
              />
            )}
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <p
                className="font-display text-5xl font-black italic leading-none"
                style={{
                  color: "var(--gold-bright)",
                  textShadow: "0 0 30px rgba(200,170,110,0.6)",
                }}
              >
                VS
              </p>
              {phase === "duel" && (
                <p
                  className="mt-1 font-data text-lg font-bold tabular-nums"
                  style={{ color: remaining <= 5 ? "var(--red)" : "rgba(255,255,255,0.8)" }}
                >
                  {remaining}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Matchup intro (Wave 36 — fighting-game VS screen) ─────── */}
      {phase === "intro" && pair && (
        <MatchupIntro
          left={{
            name: pair.a.killer_name ?? pair.a.killer_champion ?? "?",
            champion: pair.a.killer_champion,
            subtitle: pair.a.victim_champion
              ? `exécute ${pair.a.victim_champion}`
              : null,
          }}
          right={{
            name: pair.b.killer_name ?? pair.b.killer_champion ?? "?",
            champion: pair.b.killer_champion,
            subtitle: pair.b.victim_champion
              ? `exécute ${pair.b.victim_champion}`
              : null,
          }}
          reduce={reduce}
          onDone={() => {
            setRemaining(duelSeconds);
            setPhase("duel");
          }}
        />
      )}

      {/* ── Top strip : duel number ───────────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-0 top-4 z-[70] flex items-center justify-center">
        <p className="rounded-full border border-white/10 bg-black/55 px-4 py-1.5 font-data text-[11px] uppercase tracking-[0.35em] text-white/65 backdrop-blur-sm">
          VS Roulette · Duel #{duelNo}
          {auto ? " · autopilote" : ""}
        </p>
      </div>

      {/* ── Bottom arbitration bar ────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2">
        {phase === "duel" && remaining === 0 && !auto && (
          <p
            className="font-display text-xl font-black uppercase tracking-[0.2em] text-[var(--red)]"
            style={{ animation: reduce ? "none" : "vsStreamPulse 0.8s ease-in-out infinite" }}
          >
            Temps écoulé — tranche !
          </p>
        )}
        <p className="rounded-full bg-black/45 px-4 py-1.5 font-data text-[10px] uppercase tracking-[0.25em] text-white/45 backdrop-blur-sm">
          ← gauche · → droite · ↓ égalité · Espace relance · M son
        </p>
      </div>

      <style>{`
        @keyframes vsStreamPulse{0%,100%{opacity:1}50%{opacity:0.35}}
        @keyframes vsStreamFloat{0%{opacity:0;transform:translateY(12px) scale(0.9)}25%{opacity:1;transform:translateY(0) scale(1.08)}100%{opacity:1;transform:translateY(0) scale(1)}}
      `}</style>
    </div>
  );
}

// ─── One pane ─────────────────────────────────────────────────────────

function StreamPane({
  side,
  kill,
  phase,
  outcome,
  audioOn,
  reduce,
  onVote,
  onHover,
}: {
  side: "a" | "b";
  kill: StreamKill | null;
  phase: Phase;
  outcome: EloOutcome | null;
  audioOn: boolean;
  reduce: boolean;
  onVote: () => void;
  onHover: (hovering: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const src = kill
    ? (kill.clip_url_horizontal ?? kill.clip_url_vertical ?? undefined)
    : undefined;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !audioOn;
  }, [audioOn]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src) return;
    el.currentTime = 0;
    el.play().catch(() => {});
  }, [src]);

  const isWinner =
    phase === "revealed" && outcome && outcome.winner === side;
  const isLoser =
    phase === "revealed" &&
    outcome &&
    outcome.winner !== "tie" &&
    outcome.winner !== side;
  const delta = outcome ? (side === "a" ? outcome.aDelta : outcome.bDelta) : 0;
  const elo = outcome
    ? Math.round(side === "a" ? outcome.aElo : outcome.bElo)
    : Math.round(kill?.elo_rating ?? 1500);
  const badge = kill?.multi_kill
    ? MULTI_LABEL[kill.multi_kill]
    : kill?.is_first_blood
      ? "FIRST BLOOD"
      : null;

  return (
    <button
      type="button"
      disabled={phase !== "duel"}
      onClick={onVote}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      aria-label={`Voter pour le clip ${side === "a" ? "gauche" : "droit"}`}
      className="relative h-full w-1/2 cursor-pointer overflow-hidden border-0 bg-black p-0 text-left outline-none"
      style={{
        transition: reduce ? "none" : "filter 0.5s ease, opacity 0.5s ease",
        filter: isLoser ? "grayscale(0.9) brightness(0.45)" : "none",
        opacity: phase === "spinning" ? 0.35 : 1,
      }}
    >
      {src ? (
        <video
          ref={videoRef}
          src={src}
          poster={kill?.thumbnail_url ?? undefined}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center">
          <div className="kc-spinner" aria-hidden />
        </div>
      )}

      {/* side scrim */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            side === "a"
              ? "linear-gradient(90deg, rgba(1,10,19,0.55), transparent 40%)"
              : "linear-gradient(270deg, rgba(1,10,19,0.55), transparent 40%)",
        }}
      />

      {/* winner aura */}
      {isWinner && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            boxShadow: "inset 0 0 120px rgba(200,170,110,0.55)",
            border: "3px solid var(--gold)",
          }}
        />
      )}

      {/* audio indicator */}
      {audioOn && (
        <span className="absolute right-4 top-14 z-10 rounded-full border border-[var(--cyan)]/60 bg-black/60 px-3 py-1 font-data text-[10px] uppercase tracking-[0.2em] text-[var(--cyan)]">
          🔊 son
        </span>
      )}

      {/* meta plate */}
      {kill && (
        <div
          className={`absolute bottom-14 z-10 max-w-[42vw] ${side === "a" ? "left-5" : "right-5 text-right"}`}
        >
          {badge && (
            <span
              className="mb-2 inline-block rounded-sm px-2 py-0.5 font-data text-[11px] font-black uppercase tracking-[0.15em] text-white"
              style={{
                background:
                  kill.multi_kill === "penta"
                    ? "linear-gradient(135deg,#C89B3C,#785A28)"
                    : "rgba(232,64,87,0.85)",
              }}
            >
              {badge}
            </span>
          )}
          <p
            className="font-display text-3xl font-black leading-tight text-white"
            style={{ textShadow: "0 2px 18px rgba(0,0,0,0.9)" }}
          >
            {kill.killer_name ?? kill.killer_champion ?? "?"}
          </p>
          <p className="font-data text-sm text-white/75">
            {kill.killer_champion ?? "?"}
            <span className="text-white/40"> exécute </span>
            {kill.victim_champion ?? "?"}
            {kill.victim_name ? (
              <span className="text-white/40"> ({kill.victim_name})</span>
            ) : null}
          </p>
          <p className="mt-1 font-data text-[11px] uppercase tracking-[0.15em] text-[var(--gold)]/80">
            ELO {elo}
            {phase === "revealed" && delta !== 0 && (
              <span
                className="ml-2 inline-block font-black"
                style={{
                  color: delta > 0 ? "var(--green)" : "var(--red)",
                  animation: reduce ? "none" : "vsStreamFloat 0.7s ease-out both",
                }}
              >
                {delta > 0 ? `+${delta}` : delta}
              </span>
            )}
          </p>
        </div>
      )}

      {/* reveal verdict */}
      {isWinner && (
        <div className="pointer-events-none absolute inset-x-0 top-[16%] z-10 text-center">
          <p
            className="font-display text-5xl font-black uppercase italic tracking-tight"
            style={{
              color: "var(--gold-bright)",
              textShadow: "0 0 40px rgba(200,170,110,0.8), 0 4px 20px rgba(0,0,0,0.9)",
              animation: reduce ? "none" : "vsStreamFloat 0.5s ease-out both",
            }}
          >
            Vainqueur
          </p>
        </div>
      )}
      {phase === "revealed" && outcome?.winner === "tie" && (
        <div className="pointer-events-none absolute inset-x-0 top-[16%] z-10 text-center">
          <p className="font-display text-3xl font-black uppercase italic text-white/70">
            Égalité
          </p>
        </div>
      )}
    </button>
  );
}
