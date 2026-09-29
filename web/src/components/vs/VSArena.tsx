"use client";

/**
 * L'Arène VS — l'écran de sélection façon jeu de combat (29/09/2026).
 *
 * Mehdi : « l'écran de sélection en mode sélection dans les jeux VS avec
 * des cards des joueurs. Je clique, je sélectionne, quelques animations
 * sympa, puis les clips passent un par un, puis on vote. »
 *
 * Déroulé : sélection (joueur 1 en bleu à gauche, joueur 2 en rouge à
 * droite, verrouillage animé + son) → « MANCHE n » → l'écran VS
 * (MatchupIntro) → le clip bleu plein cadre, puis le rouge (VSShowcase) →
 * le vote (ELO communautaire, fn_record_vs_vote) → le score. Deux manches
 * gagnantes (cinq au plus si les égalités s'enchaînent), puis le vainqueur.
 *
 * La roulette tire un kill de chaque combattant (fn_pick_vs_pair avec
 * player_slug), sans resservir un clip déjà vu dans le combat tant que le
 * stock le permet. Clavier : Entrée pour lancer, ← / → pour voter, ↓ pour
 * l'égalité. Reduced-motion : pas de claquements ni de flashs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { championLoadingUrl } from "@/lib/constants";
import type { VSFighter } from "@/lib/supabase/vs-fighters";
import { formatEloDelta, getVSSessionHash, playLockInSfx, type VSKill, type VSVoteResult } from "@/lib/vs-roulette";
import { MatchupIntro } from "./MatchupIntro";
import { VSShowcase } from "./VSShowcase";

type Side = "a" | "b";
type Choice = Side | "tie";
type Phase =
  | { kind: "select" }
  | { kind: "banner"; round: number }
  | { kind: "intro"; a: VSKill; b: VSKill }
  | { kind: "showcase"; a: VSKill; b: VSKill; showing: Side }
  | { kind: "vote"; a: VSKill; b: VSKill }
  | { kind: "voting"; a: VSKill; b: VSKill; choice: Choice }
  | { kind: "round"; a: VSKill; b: VSKill; choice: Choice; deltaA: number; deltaB: number }
  | { kind: "final" }
  | { kind: "error"; message: string };

const EASE = [0.16, 1, 0.3, 1] as const;
const WINS_NEEDED = 2;
const MAX_ROUNDS = 5;
const BANNER_MS = 1100;
const AUTO_NEXT_S = 5;
const BLUE = "0,87,255";
const RED = "232,64,87";

const ROLE_LABEL: Record<string, string> = { top: "Top", jungle: "Jungle", mid: "Mid", bottom: "ADC", support: "Support" };

/**
 * Portrait d'un combattant : sa photo, sinon (absente ou refusée — les
 * photos wikia répondent 403 à l'optimiseur d'images) l'art de son
 * champion signature, sinon son initiale.
 */
function FighterArt({ f, sizes, zoom = false }: { f: VSFighter; sizes: string; zoom?: boolean }) {
  const [broken, setBroken] = useState(false);
  const usePhoto = !!f.photo && !broken;
  const src = usePhoto ? f.photo : f.champion ? championLoadingUrl(f.champion) : null;
  if (!src) {
    return (
      <span className="absolute inset-0 grid place-items-center font-display text-5xl font-black text-white/15">{f.ign.slice(0, 1)}</span>
    );
  }
  return (
    <Image
      src={src}
      alt=""
      fill
      sizes={sizes}
      onError={() => setBroken(true)}
      className={`object-cover ${usePhoto ? "object-top" : "object-center"} ${zoom ? "transition-transform duration-500 group-hover:scale-105" : ""}`}
    />
  );
}

export function VSArena({ fighters }: { fighters: VSFighter[] }) {
  const reduce = useReducedMotion() ?? false;
  const [p1, setP1] = useState<VSFighter | null>(null);
  const [p2, setP2] = useState<VSFighter | null>(null);
  const [picking, setPicking] = useState<Side>("a");
  const [phase, setPhase] = useState<Phase>({ kind: "select" });
  const [round, setRound] = useState(1);
  const [score, setScore] = useState({ a: 0, b: 0 });
  const [autoNext, setAutoNext] = useState<number | null>(null);
  const usedRef = useRef(new Set<string>());
  const sbRef = useRef<ReturnType<typeof createClient> | null>(null);
  const sessionRef = useRef("vs-ssr-placeholder-hash");
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionRef.current = getVSSessionHash();
    sbRef.current = createClient();
  }, []);

  const toTop = useCallback(
    () => topRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }),
    [reduce],
  );

  // ── sélection ──
  const pick = (f: VSFighter) => {
    if (!reduce) playLockInSfx();
    if (picking === "a") {
      setP1(f);
      setPicking(p2 ? "a" : "b");
    } else {
      setP2(f);
      setPicking(p1 ? "b" : "a");
    }
  };
  const randomPick = () => {
    if (fighters.length === 0) return;
    const r = () => fighters[Math.floor(Math.random() * fighters.length)];
    const a = r();
    let b = r();
    for (let i = 0; i < 6 && b.ign === a.ign && fighters.length > 1; i++) b = r();
    if (!reduce) playLockInSfx();
    setP1(a);
    setP2(b);
  };

  // ── une manche : tirage d'une paire inédite ──
  const drawPair = useCallback(async (): Promise<{ a: VSKill; b: VSKill } | string> => {
    if (!p1 || !p2) return "Choisis deux combattants.";
    const sb = sbRef.current ?? createClient();
    sbRef.current = sb;
    let fallback: { a: VSKill; b: VSKill } | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data, error } = await sb.rpc("fn_pick_vs_pair", {
        left_filters: { player_slug: p1.ign },
        right_filters: { player_slug: p2.ign },
      });
      if (error) return `La roulette a calé : ${error.message}`;
      const row = (Array.isArray(data) ? data[0] : null) as { kill_a: VSKill | null; kill_b: VSKill | null } | null;
      const a = row?.kill_a;
      const b = row?.kill_b;
      // kills DE la KC uniquement (garde doublée côté client, cf. VSRoulette)
      if (!a || !b || a.tracked_team_involvement !== "team_killer" || b.tracked_team_involvement !== "team_killer") continue;
      fallback ??= { a, b };
      if (usedRef.current.has(a.id) || usedRef.current.has(b.id)) continue;
      usedRef.current.add(a.id);
      usedRef.current.add(b.id);
      return { a, b };
    }
    return fallback ?? "Pas assez de clips pour ce duel. Change de combattant.";
  }, [p1, p2]);

  const playRound = useCallback(
    async (n: number) => {
      setRound(n);
      setPhase({ kind: "banner", round: n });
      toTop();
      const started = Date.now();
      const res = await drawPair();
      const wait = Math.max(0, (reduce ? 300 : BANNER_MS) - (Date.now() - started));
      window.setTimeout(() => {
        if (typeof res === "string") setPhase({ kind: "error", message: res });
        else setPhase({ kind: "intro", a: res.a, b: res.b });
      }, wait);
    },
    [drawPair, reduce, toTop],
  );

  const startFight = () => {
    if (!p1 || !p2) return;
    usedRef.current.clear();
    setScore({ a: 0, b: 0 });
    void playRound(1);
  };

  // ── vote ──
  const vote = useCallback(
    async (choice: Choice) => {
      if (phase.kind !== "vote" || !p1 || !p2) return;
      const { a, b } = phase;
      setPhase({ kind: "voting", a, b, choice });
      const sb = sbRef.current ?? createClient();
      let deltaA = 0;
      let deltaB = 0;
      try {
        const { data, error } = await sb.rpc("fn_record_vs_vote", {
          p_kill_a: a.id,
          p_kill_b: b.id,
          p_winner: choice === "a" ? a.id : choice === "b" ? b.id : null,
          p_session_hash: sessionRef.current,
          p_filters: { left: { player_slug: p1.ign }, right: { player_slug: p2.ign }, mode: "select" },
        });
        const row = (Array.isArray(data) ? data[0] : null) as VSVoteResult | null;
        if (!error && row) {
          const aIsRowA = row.kill_a_id === a.id;
          deltaA = (aIsRowA ? row.kill_a_elo : row.kill_b_elo) - (a.elo_rating ?? 1500);
          deltaB = (aIsRowA ? row.kill_b_elo : row.kill_a_elo) - (b.elo_rating ?? 1500);
        }
      } catch {
        /* le vote local compte même si l'ELO n'a pas pu être écrit */
      }
      setScore((s) => ({ a: s.a + (choice === "a" ? 1 : 0), b: s.b + (choice === "b" ? 1 : 0) }));
      setPhase({ kind: "round", a, b, choice, deltaA, deltaB });
    },
    [phase, p1, p2],
  );

  const fightOver = score.a >= WINS_NEEDED || score.b >= WINS_NEEDED || round >= MAX_ROUNDS;

  const next = useCallback(() => {
    setAutoNext(null);
    if (fightOver) {
      setPhase({ kind: "final" });
      toTop();
    } else void playRound(round + 1);
  }, [fightOver, playRound, round, toTop]);

  // compte à rebours après chaque manche
  useEffect(() => {
    if (phase.kind !== "round") return;
    setAutoNext(AUTO_NEXT_S);
    const iv = window.setInterval(() => setAutoNext((s) => (s == null ? null : Math.max(0, s - 1))), 1000);
    return () => window.clearInterval(iv);
  }, [phase.kind]);
  useEffect(() => {
    if (autoNext === 0) next();
  }, [autoNext, next]);

  // clavier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (phase.kind === "vote") {
        if (e.key === "ArrowLeft") void vote("a");
        else if (e.key === "ArrowRight") void vote("b");
        else if (e.key === "ArrowDown") void vote("tie");
      } else if (phase.kind === "select" && e.key === "Enter" && p1 && p2) {
        startFight();
      } else if (phase.kind === "round" && e.key === "Enter") {
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const inFight = phase.kind !== "select";

  return (
    <div ref={topRef} className="relative scroll-mt-20">
      <ArenaBackdrop />
      <div className="relative z-10 mx-auto max-w-7xl px-3 pb-16 pt-6 md:px-6 md:pt-10">
        {inFight && p1 && p2 && phase.kind !== "final" && (
          <FightHud p1={p1} p2={p2} score={score} round={round} onQuit={() => setPhase({ kind: "select" })} />
        )}

        <AnimatePresence mode="wait">
          {phase.kind === "select" && (
            <m.div key="select" exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.3, ease: EASE }}>
              <SelectScreen
                fighters={fighters}
                p1={p1}
                p2={p2}
                picking={picking}
                setPicking={setPicking}
                onPick={pick}
                onRandom={randomPick}
                onStart={startFight}
                reduce={reduce}
              />
            </m.div>
          )}

          {phase.kind === "showcase" && p1 && p2 && (
            <m.div key={`show-${phase.showing}`} className="mx-auto mt-6 max-w-5xl">
              <VSShowcase
                kill={phase.showing === "a" ? phase.a : phase.b}
                side={phase.showing === "a" ? "blue" : "red"}
                stepLabel={`Manche ${round} · clip ${phase.showing === "a" ? 1 : 2}/2 · ${phase.showing === "a" ? p1.ign : p2.ign}`}
                ctaLabel={phase.showing === "a" ? `Au tour de ${p2.ign} →` : "Voter →"}
                onNext={() =>
                  setPhase((s) =>
                    s.kind !== "showcase" ? s : s.showing === "a" ? { ...s, showing: "b" } : { kind: "vote", a: s.a, b: s.b },
                  )
                }
                reduce={reduce}
              />
            </m.div>
          )}

          {(phase.kind === "vote" || phase.kind === "voting" || phase.kind === "round") && p1 && p2 && (
            <m.div
              key="vote"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              <VoteScreen
                phase={phase}
                p1={p1}
                p2={p2}
                onVote={(c) => void vote(c)}
                autoNext={autoNext}
                fightOver={fightOver}
                onNext={next}
              />
            </m.div>
          )}

          {phase.kind === "final" && p1 && p2 && (
            <m.div key="final" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
              <FinalScreen
                p1={p1}
                p2={p2}
                score={score}
                reduce={reduce}
                onRematch={startFight}
                onNewFighters={() => { setPhase({ kind: "select" }); toTop(); }}
              />
            </m.div>
          )}

          {phase.kind === "error" && (
            <m.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto mt-16 max-w-md text-center">
              <p className="font-display text-2xl text-[var(--red)]">Combat interrompu</p>
              <p className="mt-3 text-sm text-white/65">{phase.message}</p>
              <div className="mt-6 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => void playRound(round)}
                  className="rounded-lg border border-[var(--gold)]/50 px-4 py-2 font-display text-xs uppercase tracking-widest text-[var(--gold)]"
                >
                  Réessayer
                </button>
                <button
                  type="button"
                  onClick={() => setPhase({ kind: "select" })}
                  className="rounded-lg border border-white/20 px-4 py-2 font-display text-xs uppercase tracking-widest text-white/75"
                >
                  Changer de combattants
                </button>
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </div>

      {phase.kind === "banner" && <RoundBanner round={phase.round} reduce={reduce} />}
      {phase.kind === "intro" && p1 && p2 && (
        <MatchupIntro
          left={{
            name: p1.ign,
            champion: phase.a.killer_champion,
            subtitle: phase.a.victim_champion ? `${phase.a.killer_champion ?? "?"} exécute ${phase.a.victim_champion}` : null,
          }}
          right={{
            name: p2.ign,
            champion: phase.b.killer_champion,
            subtitle: phase.b.victim_champion ? `${phase.b.killer_champion ?? "?"} exécute ${phase.b.victim_champion}` : null,
          }}
          reduce={reduce}
          onDone={() => setPhase((s) => (s.kind === "intro" ? { kind: "showcase", a: s.a, b: s.b, showing: "a" } : s))}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Décor : l'arène (bleu à gauche, rouge à droite, or au centre)
// ════════════════════════════════════════════════════════════════════

function ArenaBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(60% 70% at 0% 40%, rgba(${BLUE},0.22), transparent 60%), radial-gradient(60% 70% at 100% 40%, rgba(${RED},0.2), transparent 60%), radial-gradient(40% 40% at 50% 0%, rgba(200,170,110,0.14), transparent 70%), linear-gradient(180deg, #030814, #010A13)`,
        }}
      />
      {/* faisceaux diagonaux */}
      <div
        className="absolute -left-1/4 top-0 h-full w-1/2 opacity-40"
        style={{ background: `linear-gradient(100deg, transparent 40%, rgba(${BLUE},0.18) 50%, transparent 60%)` }}
      />
      <div
        className="absolute -right-1/4 top-0 h-full w-1/2 opacity-40"
        style={{ background: `linear-gradient(80deg, transparent 40%, rgba(${RED},0.16) 50%, transparent 60%)` }}
      />
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: "repeating-linear-gradient(180deg, transparent 0 2px, rgba(255,255,255,0.5) 3px, transparent 4px)" }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Écran de sélection
// ════════════════════════════════════════════════════════════════════

function SelectScreen({
  fighters,
  p1,
  p2,
  picking,
  setPicking,
  onPick,
  onRandom,
  onStart,
  reduce,
}: {
  fighters: VSFighter[];
  p1: VSFighter | null;
  p2: VSFighter | null;
  picking: Side;
  setPicking: (s: Side) => void;
  onPick: (f: VSFighter) => void;
  onRandom: () => void;
  onStart: () => void;
  reduce: boolean;
}) {
  const ready = !!p1 && !!p2;
  const current = fighters.filter((f) => f.current);
  const alumni = fighters.filter((f) => !f.current);
  return (
    <section aria-label="Sélection des combattants">
      <header className="text-center">
        <p className="font-data text-[11px] uppercase tracking-[0.45em] text-[var(--gold)]/75">VS · Arène des kills</p>
        <h1 className="mt-2 font-display text-4xl font-black leading-none text-white md:text-6xl" style={{ textShadow: "0 0 40px rgba(200,170,110,0.35)" }}>
          Choisis tes combattants
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-white/65 md:text-base">
          Deux joueurs, deux kills à chaque manche, un vote. Le premier à deux manches remporte le duel.
        </p>
      </header>

      <div className="mt-8 grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)_260px]">
        <SidePanel side="a" fighter={p1} active={picking === "a"} onFocus={() => setPicking("a")} reduce={reduce} />

        <div className="order-first lg:order-none">
          <div className="space-y-6">
            <FighterGrid title="Roster 2026" fighters={current} p1={p1} p2={p2} picking={picking} onPick={onPick} reduce={reduce} />
            {alumni.length > 0 && (
              <FighterGrid title="Les anciens" fighters={alumni} p1={p1} p2={p2} picking={picking} onPick={onPick} reduce={reduce} />
            )}
          </div>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onRandom}
              className="rounded-xl border border-white/20 bg-black/35 px-5 py-3 font-display text-xs font-bold uppercase tracking-[0.25em] text-white/80 backdrop-blur-sm transition-colors hover:border-[var(--gold)]/60 hover:text-[var(--gold)]"
            >
              🎲 Aléatoire
            </button>
            <m.button
              type="button"
              onClick={onStart}
              disabled={!ready}
              animate={ready && !reduce ? { boxShadow: ["0 0 0px rgba(200,170,110,0.0)", "0 0 36px rgba(200,170,110,0.55)", "0 0 0px rgba(200,170,110,0.0)"] } : {}}
              transition={{ duration: 1.6, repeat: Infinity }}
              className="rounded-xl px-9 py-3.5 font-display text-base font-black uppercase tracking-[0.3em] text-[#1a1206] transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
              style={{ background: "var(--gold-gradient)" }}
              aria-label={ready ? `Lancer le duel ${p1?.ign} contre ${p2?.ign}` : "Choisis deux combattants"}
            >
              Combat !
            </m.button>
          </div>
          <p className="mt-3 text-center font-data text-[10px] uppercase tracking-[0.25em] text-white/35">
            {ready ? "Entrée pour lancer" : picking === "a" ? "Choisis le combattant bleu" : "Choisis le combattant rouge"}
          </p>
        </div>

        <SidePanel side="b" fighter={p2} active={picking === "b"} onFocus={() => setPicking("b")} reduce={reduce} />
      </div>

      {/* Mobile : les panneaux latéraux cèdent la place à une barre collante. */}
      <div className="h-20 lg:hidden" aria-hidden />
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-white/10 bg-black/85 px-3 py-2.5 backdrop-blur-md lg:hidden">
        <MiniSlot f={p1} rgb={BLUE} label="Bleu" active={picking === "a"} onClick={() => setPicking("a")} />
        <span className="font-display text-sm font-black text-[var(--gold)]">VS</span>
        <MiniSlot f={p2} rgb={RED} label="Rouge" active={picking === "b"} onClick={() => setPicking("b")} />
        <button
          type="button"
          onClick={onStart}
          disabled={!ready}
          className="ml-auto rounded-lg px-4 py-2.5 font-display text-xs font-black uppercase tracking-[0.2em] text-[#1a1206] disabled:opacity-35"
          style={{ background: "var(--gold-gradient)" }}
        >
          Combat !
        </button>
      </div>
    </section>
  );
}

function MiniSlot({
  f,
  rgb,
  label,
  active,
  onClick,
}: {
  f: VSFighter | null;
  rgb: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label} : ${f ? f.ign : "à choisir"}`}
      className="flex min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-1"
      style={{ borderColor: `rgba(${rgb},${active ? 0.95 : 0.35})` }}
    >
      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded">
        {f ? <FighterArt f={f} sizes="32px" /> : <span className="grid h-full w-full place-items-center text-white/30">?</span>}
      </span>
      <span className="max-w-[4.5rem] truncate font-display text-xs font-black uppercase text-white">{f?.ign ?? label}</span>
    </button>
  );
}

function FighterGrid({
  title,
  fighters,
  p1,
  p2,
  picking,
  onPick,
  reduce,
}: {
  title: string;
  fighters: VSFighter[];
  p1: VSFighter | null;
  p2: VSFighter | null;
  picking: Side;
  onPick: (f: VSFighter) => void;
  reduce: boolean;
}) {
  const rgb = picking === "a" ? BLUE : RED;
  return (
    <div>
      <p className="mb-2 font-data text-[10px] uppercase tracking-[0.35em] text-white/45">{title}</p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {fighters.map((f, i) => {
          const isP1 = p1?.ign === f.ign;
          const isP2 = p2?.ign === f.ign;
          return (
            <li key={f.ign}>
              <m.button
                type="button"
                onClick={() => onPick(f)}
                initial={reduce ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: reduce ? 0 : i * 0.035, ease: EASE }}
                whileHover={reduce ? undefined : { y: -4, scale: 1.03 }}
                whileTap={reduce ? undefined : { scale: 0.96 }}
                aria-pressed={isP1 || isP2}
                aria-label={`${f.ign}, ${f.role ? ROLE_LABEL[f.role] : ""}, ${f.clips} clips`}
                className="group relative block aspect-[3/4] w-full overflow-hidden rounded-lg border bg-[#07101f] text-left"
                style={{
                  borderColor: isP1 ? `rgba(${BLUE},0.95)` : isP2 ? `rgba(${RED},0.95)` : "rgba(255,255,255,0.1)",
                  boxShadow: isP1 ? `0 0 22px rgba(${BLUE},0.55)` : isP2 ? `0 0 22px rgba(${RED},0.5)` : "none",
                }}
              >
                <FighterArt f={f} sizes="(max-width: 768px) 30vw, 160px" zoom />
                <span
                  aria-hidden
                  className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ boxShadow: `inset 0 0 0 2px rgba(${rgb},0.9), inset 0 -40px 60px rgba(${rgb},0.25)` }}
                />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-2 pb-1.5 pt-6">
                  <span className="block truncate font-display text-sm font-black uppercase leading-none text-white md:text-base">{f.ign}</span>
                  <span className="mt-0.5 block font-data text-[9px] uppercase tracking-[0.15em] text-white/55">
                    {f.role ? ROLE_LABEL[f.role] : "—"} · {f.clips} clips
                  </span>
                </span>
                {(isP1 || isP2) && (
                  <span
                    className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 font-data text-[10px] font-black text-white"
                    style={{ background: isP1 ? `rgb(${BLUE})` : `rgb(${RED})` }}
                  >
                    {isP1 && isP2 ? "1P·2P" : isP1 ? "1P" : "2P"}
                  </span>
                )}
              </m.button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SidePanel({
  side,
  fighter,
  active,
  onFocus,
  reduce,
}: {
  side: Side;
  fighter: VSFighter | null;
  active: boolean;
  onFocus: () => void;
  reduce: boolean;
}) {
  const rgb = side === "a" ? BLUE : RED;
  const label = side === "a" ? "Joueur 1 · Bleu" : "Joueur 2 · Rouge";
  return (
    <button
      type="button"
      onClick={onFocus}
      aria-pressed={active}
      aria-label={`${label} : ${fighter ? fighter.ign : "à choisir"}${active ? " (sélection en cours)" : ""}`}
      className="relative block aspect-[3/4] w-full overflow-hidden rounded-2xl border-2 bg-black/50 text-left max-lg:hidden"
      style={{
        borderColor: `rgba(${rgb},${active ? 0.95 : 0.35})`,
        boxShadow: active ? `0 0 40px rgba(${rgb},0.35)` : "none",
      }}
    >
      <AnimatePresence mode="wait">
        {fighter ? (
          <m.div
            key={fighter.ign}
            className="absolute inset-0"
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: side === "a" ? -60 : 60, scale: 1.08 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <FighterArt f={fighter} sizes="260px" />
            {!reduce && (
              <m.span
                aria-hidden
                className="absolute inset-0"
                style={{ background: `rgba(${rgb},0.5)` }}
                initial={{ opacity: 1 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
              />
            )}
          </m.div>
        ) : (
          <m.div key="empty" className="absolute inset-0 grid place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <span className="font-display text-7xl font-black" style={{ color: `rgba(${rgb},0.35)` }}>
              ?
            </span>
          </m.div>
        )}
      </AnimatePresence>
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-4 pb-4 pt-16">
        <span className="block font-data text-[10px] uppercase tracking-[0.3em]" style={{ color: `rgb(${rgb})` }}>
          {label}
        </span>
        <span className="mt-1 block font-display text-3xl font-black uppercase leading-none text-white">{fighter?.ign ?? "—"}</span>
        {fighter && (
          <span className="mt-1.5 block font-data text-[10px] uppercase tracking-[0.18em] text-white/55">
            {fighter.role ? ROLE_LABEL[fighter.role] : ""} · {fighter.period} · {fighter.clips} clips
          </span>
        )}
      </span>
      {active && !reduce && (
        <m.span
          aria-hidden
          className="absolute right-3 top-3 font-data text-[10px] font-black uppercase tracking-[0.2em]"
          style={{ color: `rgb(${rgb})` }}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        >
          ● choix
        </m.span>
      )}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════
// Pendant le combat
// ════════════════════════════════════════════════════════════════════

function Pips({ n, rgb }: { n: number; rgb: string }) {
  return (
    <span className="flex gap-1" aria-hidden>
      {Array.from({ length: WINS_NEEDED }, (_, i) => (
        <span
          key={i}
          className="h-2.5 w-2.5 rotate-45 border"
          style={{ borderColor: `rgb(${rgb})`, background: i < n ? `rgb(${rgb})` : "transparent", boxShadow: i < n ? `0 0 8px rgb(${rgb})` : "none" }}
        />
      ))}
    </span>
  );
}

function FightHud({
  p1,
  p2,
  score,
  round,
  onQuit,
}: {
  p1: VSFighter;
  p2: VSFighter;
  score: { a: number; b: number };
  round: number;
  onQuit: () => void;
}) {
  const chip = (f: VSFighter, rgb: string, align: "left" | "right") => {
    return (
      <div className={`flex min-w-0 items-center gap-2.5 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border-2" style={{ borderColor: `rgb(${rgb})` }}>
          <FighterArt f={f} sizes="40px" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-lg font-black uppercase leading-none text-white">{f.ign}</span>
          <span className={`mt-1 flex ${align === "right" ? "justify-end" : ""}`}>
            <Pips n={align === "left" ? score.a : score.b} rgb={rgb} />
          </span>
        </span>
      </div>
    );
  };
  return (
    <div
      className="sticky top-16 z-20 mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl border border-white/10 bg-black/60 px-3 py-2 backdrop-blur-md"
      role="status"
      aria-label={`Manche ${round}. ${p1.ign} ${score.a}, ${p2.ign} ${score.b}`}
    >
      {chip(p1, BLUE, "left")}
      <div className="text-center">
        <p className="font-data text-[9px] uppercase tracking-[0.3em] text-white/45">Manche {round}</p>
        <p className="font-display text-2xl font-black leading-none text-[var(--gold)]">
          {score.a} <span className="text-white/30">—</span> {score.b}
        </p>
        <button type="button" onClick={onQuit} className="mt-0.5 font-data text-[9px] uppercase tracking-[0.2em] text-white/35 hover:text-white/70">
          Abandonner
        </button>
      </div>
      {chip(p2, RED, "right")}
    </div>
  );
}

function RoundBanner({ round, reduce }: { round: number; reduce: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[80] grid place-items-center bg-black/70 backdrop-blur-sm" aria-live="assertive">
      <m.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 2.2, letterSpacing: "0.6em" }}
        animate={{ opacity: 1, scale: 1, letterSpacing: "0.12em" }}
        transition={{ duration: reduce ? 0.2 : 0.55, ease: EASE }}
        className="text-center"
      >
        <p className="font-data text-[12px] uppercase tracking-[0.5em] text-[var(--gold)]/80">Deux manches gagnantes</p>
        <p className="font-display text-7xl font-black uppercase text-white md:text-9xl" style={{ textShadow: "0 0 50px rgba(200,170,110,0.55)" }}>
          Manche {round}
        </p>
      </m.div>
    </div>
  );
}

function VoteScreen({
  phase,
  p1,
  p2,
  onVote,
  autoNext,
  fightOver,
  onNext,
}: {
  phase: Extract<Phase, { kind: "vote" | "voting" | "round" }>;
  p1: VSFighter;
  p2: VSFighter;
  onVote: (c: Choice) => void;
  autoNext: number | null;
  fightOver: boolean;
  onNext: () => void;
}) {
  const decided = phase.kind === "round" ? phase.choice : phase.kind === "voting" ? phase.choice : null;
  const card = (kill: VSKill, f: VSFighter, side: Side) => {
    const rgb = side === "a" ? BLUE : RED;
    const won = decided === side;
    const lost = decided && decided !== side && decided !== "tie";
    const delta = phase.kind === "round" ? (side === "a" ? phase.deltaA : phase.deltaB) : null;
    return (
      <m.div
        animate={{ scale: won ? 1.03 : lost ? 0.97 : 1, opacity: lost ? 0.55 : 1 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="relative overflow-hidden rounded-2xl border-2 bg-black"
        style={{ borderColor: `rgba(${rgb},${won ? 1 : 0.45})`, boxShadow: won ? `0 0 48px rgba(${rgb},0.5)` : "none" }}
      >
        <div className="relative aspect-[9/16] max-h-[56vh] w-full">
          {kill.thumbnail_url && <Image src={kill.thumbnail_url} alt="" fill sizes="(max-width: 768px) 45vw, 360px" className="object-cover" />}
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-3 pt-16">
            <span className="block font-data text-[10px] uppercase tracking-[0.25em]" style={{ color: `rgb(${rgb})` }}>
              {side === "a" ? "Bleu" : "Rouge"} · {f.ign}
            </span>
            <span className="mt-1 block font-display text-xl font-black uppercase leading-tight text-white">
              {kill.killer_champion ?? "?"} <span className="text-white/45">→</span> {kill.victim_champion ?? "?"}
            </span>
            {kill.multi_kill && (
              <span className="mt-1 inline-block rounded-sm bg-[var(--gold)] px-1.5 py-0.5 font-data text-[9px] font-black uppercase text-[#1a1206]">
                {kill.multi_kill}
              </span>
            )}
            {delta != null && delta !== 0 && (
              <span className="mt-1 block font-data text-sm font-black" style={{ color: delta > 0 ? "var(--green)" : "var(--red)" }}>
                {formatEloDelta(delta)} ELO
              </span>
            )}
          </span>
          {won && (
            <m.span
              initial={{ opacity: 0, scale: 1.6, rotate: -8 }}
              animate={{ opacity: 1, scale: 1, rotate: -8 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="absolute left-1/2 top-6 -translate-x-1/2 rounded-md border-2 border-white/80 px-3 py-1 font-display text-2xl font-black uppercase text-white"
              style={{ background: `rgba(${rgb},0.85)` }}
            >
              Manche !
            </m.span>
          )}
        </div>
      </m.div>
    );
  };
  return (
    <section aria-label="Vote de la manche" className="mx-auto max-w-4xl">
      <h2 className="text-center font-display text-3xl font-black text-white md:text-4xl">
        {phase.kind === "round" ? (phase.choice === "tie" ? "Égalité, personne ne marque" : "Le point est attribué") : "Qui a fait le plus beau kill ?"}
      </h2>
      <div className="mt-6 grid grid-cols-2 gap-3 md:gap-6">
        {card(phase.a, p1, "a")}
        {card(phase.b, p2, "b")}
      </div>
      {phase.kind !== "round" ? (
        <div className="mt-6 grid grid-cols-[1fr_auto_1fr] gap-3">
          <button
            type="button"
            disabled={phase.kind === "voting"}
            onClick={() => onVote("a")}
            className="rounded-xl py-4 font-display text-base font-black uppercase tracking-[0.2em] text-white transition-transform hover:scale-[1.02] disabled:opacity-50"
            style={{ background: `rgb(${BLUE})`, boxShadow: `0 0 24px rgba(${BLUE},0.45)` }}
          >
            ← {p1.ign}
          </button>
          <button
            type="button"
            disabled={phase.kind === "voting"}
            onClick={() => onVote("tie")}
            className="rounded-xl border border-white/20 px-4 font-display text-xs font-bold uppercase tracking-[0.2em] text-white/70 hover:text-white disabled:opacity-50"
          >
            ↓ Égalité
          </button>
          <button
            type="button"
            disabled={phase.kind === "voting"}
            onClick={() => onVote("b")}
            className="rounded-xl py-4 font-display text-base font-black uppercase tracking-[0.2em] text-white transition-transform hover:scale-[1.02] disabled:opacity-50"
            style={{ background: `rgb(${RED})`, boxShadow: `0 0 24px rgba(${RED},0.45)` }}
          >
            {p2.ign} →
          </button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onNext}
            className="rounded-xl px-8 py-3.5 font-display text-sm font-black uppercase tracking-[0.25em] text-[#1a1206]"
            style={{ background: "var(--gold-gradient)" }}
          >
            {fightOver ? "Le verdict →" : "Manche suivante →"}
          </button>
          {autoNext != null && (
            <p className="font-data text-[10px] uppercase tracking-[0.25em] text-white/40">Suite dans {autoNext} s · Entrée</p>
          )}
        </div>
      )}
    </section>
  );
}

function FinalScreen({
  p1,
  p2,
  score,
  reduce,
  onRematch,
  onNewFighters,
}: {
  p1: VSFighter;
  p2: VSFighter;
  score: { a: number; b: number };
  reduce: boolean;
  onRematch: () => void;
  onNewFighters: () => void;
}) {
  const tie = score.a === score.b;
  const winner = score.a > score.b ? p1 : p2;
  const rgb = tie ? "200,170,110" : score.a > score.b ? BLUE : RED;
  return (
    <section className="relative mx-auto mt-4 max-w-3xl text-center" aria-label="Vainqueur du duel">
      {!reduce && (
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          {Array.from({ length: 26 }, (_, i) => (
            <m.span
              key={i}
              className="absolute h-2 w-2 rotate-45"
              style={{ left: `${(i * 37) % 100}%`, top: "40%", background: i % 3 === 0 ? `rgb(${rgb})` : "var(--gold)" }}
              initial={{ opacity: 0, y: 0 }}
              animate={{ opacity: [0, 1, 0], y: [-10, -220 - (i % 5) * 40], x: [0, ((i % 7) - 3) * 24] }}
              transition={{ duration: 2.2 + (i % 4) * 0.3, delay: (i % 6) * 0.12, repeat: Infinity, repeatDelay: 0.8 }}
            />
          ))}
        </div>
      )}
      <p className="font-data text-[11px] uppercase tracking-[0.5em] text-[var(--gold)]/80">{tie ? "Match nul" : "Vainqueur"}</p>
      {!tie && (
        <m.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="relative mx-auto mt-4 aspect-[3/4] w-56 overflow-hidden rounded-2xl border-2 md:w-72"
          style={{ borderColor: `rgb(${rgb})`, boxShadow: `0 0 70px rgba(${rgb},0.55)` }}
        >
          <FighterArt f={winner} sizes="288px" />
        </m.div>
      )}
      <h2 className="mt-5 font-display text-5xl font-black uppercase text-white md:text-7xl" style={{ textShadow: `0 0 40px rgba(${rgb},0.5)` }}>
        {tie ? `${p1.ign} = ${p2.ign}` : winner.ign}
      </h2>
      <p className="mt-2 font-display text-3xl font-black text-[var(--gold)]">
        {score.a} — {score.b}
      </p>
      <p className="mt-1 font-data text-[11px] uppercase tracking-[0.25em] text-white/50">
        {p1.ign} vs {p2.ign}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={onRematch}
          className="rounded-xl px-7 py-3.5 font-display text-sm font-black uppercase tracking-[0.25em] text-[#1a1206]"
          style={{ background: "var(--gold-gradient)" }}
        >
          Revanche
        </button>
        <button
          type="button"
          onClick={onNewFighters}
          className="rounded-xl border border-white/20 px-6 py-3.5 font-display text-sm font-bold uppercase tracking-[0.2em] text-white/80 hover:border-[var(--gold)]/60 hover:text-[var(--gold)]"
        >
          Nouveaux combattants
        </button>
      </div>
    </section>
  );
}
