"use client";

/**
 * VSRoulette — Wave 25.3 / V59 client surface for /vs.
 *
 * Two-column kill-vs-kill voting game wired to migration 059's RPCs :
 *
 *   - fn_pick_vs_pair(left_filters, right_filters) → spin
 *   - fn_record_vs_vote(...)                       → cast vote
 *
 * Visual language : KC hextech. Gold-on-deep-navy, losanges dorés,
 * blue-cyan glow pulse. The slot-machine animation cycles through
 * pre-loaded thumbnails for ~2 s before locking the real pair in
 * place. A synthesised Web Audio "tchhhk" punctuates the lock-in.
 *
 * Mobile : columns stack vertically below md. Filters collapse into
 * an accordion to keep the SPIN button above the fold.
 *
 * Accessibility :
 *   - All buttons have aria-label.
 *   - prefers-reduced-motion : we skip the slot-machine cycle and
 *     snap-cut to the result.
 *   - Reveal animations gated on the same media query.
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
import {
  cleanFiltersSide,
  formatEloDelta,
  getVSSessionHash,
  playLockInSfx,
  VS_MULTIKILL_OPTIONS,
  VS_ROLES,
  winRatePct,
  type VSEraOption,
  type VSFiltersSide,
  type VSKill,
  type VSPlayerOption,
  type VSVoteResult,
} from "@/lib/vs-roulette";

interface VSRouletteProps {
  players: VSPlayerOption[];
  champions: string[];
  eras: VSEraOption[];
  rouletteThumbnails: string[];
}

type SpinState =
  | { kind: "idle" }
  | { kind: "spinning" }
  | { kind: "loaded"; a: VSKill; b: VSKill }
  | { kind: "voting"; a: VSKill; b: VSKill; voted: "a" | "b" | "tie" }
  | {
      kind: "voted";
      a: VSKill;
      b: VSKill;
      result: VSVoteResult;
      voted: "a" | "b" | "tie";
      deltaA: number;
      deltaB: number;
    }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string };

const SPIN_DURATION_MS = 2100;

// ════════════════════════════════════════════════════════════════════
// Root component
// ════════════════════════════════════════════════════════════════════

export function VSRoulette({
  players,
  champions,
  eras,
  rouletteThumbnails,
}: VSRouletteProps) {
  const prefersReducedMotion = useReducedMotion();

  // ─── Filter state (per side) ────────────────────────────────────
  const [leftFilters, setLeftFilters] = useState<VSFiltersSide>({});
  const [rightFilters, setRightFilters] = useState<VSFiltersSide>({});

  // ─── Mobile filter accordion ────────────────────────────────────
  const [filtersOpen, setFiltersOpen] = useState(true);

  // ─── Roulette state ─────────────────────────────────────────────
  const [state, setState] = useState<SpinState>({ kind: "idle" });
  const sessionHashRef = useRef<string>("vs-ssr-placeholder-hash");
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const spinTimerRef = useRef<number | null>(null);

  // Stable supabase client + session hash on first client render.
  useEffect(() => {
    sessionHashRef.current = getVSSessionHash();
    supabaseRef.current = createClient();
    return () => {
      if (spinTimerRef.current != null) {
        window.clearTimeout(spinTimerRef.current);
      }
    };
  }, []);

  // ─── Spin action ────────────────────────────────────────────────
  const spin = useCallback(async () => {
    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;

    const cleanedLeft = cleanFiltersSide(leftFilters);
    const cleanedRight = cleanFiltersSide(rightFilters);

    // Kick the visual roulette immediately — the RPC race runs in
    // parallel underneath so the user perceives the spin as instant.
    setState({ kind: "spinning" });

    const spinStarted = Date.now();
    let resultData: { kill_a: VSKill | null; kill_b: VSKill | null } | null = null;
    let rpcError: string | null = null;

    try {
      const { data, error } = await sb.rpc("fn_pick_vs_pair", {
        left_filters: cleanedLeft,
        right_filters: cleanedRight,
      });
      if (error) {
        rpcError = error.message;
      } else {
        // The RPC returns a TABLE → supabase-js gives us an array of
        // exactly one row (or empty on failure). The row shape mirrors
        // the SQL projection : { kill_a, kill_b }.
        const rows = Array.isArray(data) ? data : [];
        const row = rows[0] as
          | { kill_a: VSKill | null; kill_b: VSKill | null }
          | undefined;
        resultData = row
          ? { kill_a: row.kill_a ?? null, kill_b: row.kill_b ?? null }
          : { kill_a: null, kill_b: null };
      }
    } catch (err) {
      rpcError = err instanceof Error ? err.message : "Erreur réseau";
    }

    // Hold the spin until the visual finishes (unless reduced motion).
    const elapsed = Date.now() - spinStarted;
    const minHold = prefersReducedMotion ? 0 : SPIN_DURATION_MS;
    const remaining = Math.max(0, minHold - elapsed);
    spinTimerRef.current = window.setTimeout(() => {
      if (rpcError) {
        setState({
          kind: "error",
          message: `Impossible de tirer une paire : ${rpcError}`,
        });
        return;
      }
      if (!resultData?.kill_a || !resultData?.kill_b) {
        setState({
          kind: "empty",
          message:
            "Aucune paire ne correspond à ces filtres. Élargis les critères de l'un des côtés.",
        });
        return;
      }
      if (!prefersReducedMotion) playLockInSfx();
      setState({
        kind: "loaded",
        a: resultData.kill_a,
        b: resultData.kill_b,
      });
    }, remaining);
  }, [leftFilters, rightFilters, prefersReducedMotion]);

  // ─── Vote action ────────────────────────────────────────────────
  const castVote = useCallback(
    async (choice: "a" | "b" | "tie") => {
      if (state.kind !== "loaded") return;
      const { a, b } = state;
      setState({ kind: "voting", a, b, voted: choice });

      const sb = supabaseRef.current ?? createClient();
      supabaseRef.current = sb;
      const winner =
        choice === "a" ? a.id : choice === "b" ? b.id : null;

      const eloABefore = a.elo_rating ?? 1500;
      const eloBBefore = b.elo_rating ?? 1500;

      try {
        const { data, error } = await sb.rpc("fn_record_vs_vote", {
          p_kill_a: a.id,
          p_kill_b: b.id,
          p_winner: winner,
          p_session_hash: sessionHashRef.current,
          p_filters: {
            left: cleanFiltersSide(leftFilters),
            right: cleanFiltersSide(rightFilters),
          },
        });
        if (error) {
          setState({
            kind: "error",
            message: `Vote non enregistré : ${error.message}`,
          });
          return;
        }
        const rows = Array.isArray(data) ? data : [];
        const row = rows[0] as VSVoteResult | undefined;
        if (!row) {
          setState({ kind: "error", message: "Vote non enregistré" });
          return;
        }

        // The RPC normalises pair ordering (a,b) so the row's
        // `kill_a_id` may be either of our local ids. Match them up.
        const aIsRowA = row.kill_a_id === a.id;
        const newEloA = aIsRowA ? row.kill_a_elo : row.kill_b_elo;
        const newEloB = aIsRowA ? row.kill_b_elo : row.kill_a_elo;

        setState({
          kind: "voted",
          a,
          b,
          result: row,
          voted: choice,
          deltaA: newEloA - eloABefore,
          deltaB: newEloB - eloBBefore,
        });
      } catch (err) {
        setState({
          kind: "error",
          message:
            err instanceof Error ? err.message : "Erreur réseau pendant le vote",
        });
      }
    },
    [state, leftFilters, rightFilters],
  );

  const spinAgain = useCallback(() => {
    setState({ kind: "idle" });
    void spin();
  }, [spin]);

  const resetFilters = useCallback(() => {
    setLeftFilters({});
    setRightFilters({});
    setState({ kind: "idle" });
  }, []);

  // ────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────
  return (
    <div className="relative mx-auto max-w-6xl px-3 md:px-6 pt-6 md:pt-10 pb-16">
      {/* ─── Filters ─────────────────────────────────────────────── */}
      <FiltersAccordion
        open={filtersOpen}
        onToggle={() => setFiltersOpen((o) => !o)}
      >
        <div className="grid gap-5 md:grid-cols-2 md:gap-8">
          <FilterColumn
            sideLabel="Côté gauche"
            accent="var(--cyan)"
            value={leftFilters}
            onChange={setLeftFilters}
            players={players}
            champions={champions}
            eras={eras}
          />
          <FilterColumn
            sideLabel="Côté droit"
            accent="var(--gold)"
            value={rightFilters}
            onChange={setRightFilters}
            players={players}
            champions={champions}
            eras={eras}
          />
        </div>
      </FiltersAccordion>

      {/* ─── SPIN button ─────────────────────────────────────────── */}
      <div className="mt-7 md:mt-9 flex items-center justify-center gap-3">
        <SpinButton
          onClick={() => void spin()}
          disabled={state.kind === "spinning" || state.kind === "voting"}
          state={state.kind}
        />
      </div>

      {/* ─── Arena (clips + roulette animation) ──────────────────── */}
      <div className="mt-8 md:mt-12">
        <Arena
          state={state}
          thumbnails={rouletteThumbnails}
          prefersReducedMotion={prefersReducedMotion ?? false}
          onVote={(choice) => void castVote(choice)}
          onSpinAgain={spinAgain}
          onResetFilters={resetFilters}
        />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Filters accordion (mobile collapse, desktop static)
// ════════════════════════════════════════════════════════════════════

function FiltersAccordion({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label="Filtres de la roulette"
      className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/70 backdrop-blur-md overflow-hidden"
      style={{
        boxShadow:
          "0 18px 40px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(200,170,110,0.05)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full md:cursor-default flex items-center justify-between gap-3 px-5 py-4 md:py-5"
        aria-expanded={open}
        aria-controls="vs-filters-body"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-block"
            style={{
              width: 9,
              height: 9,
              transform: "rotate(45deg)",
              background:
                "linear-gradient(135deg, var(--gold), var(--gold-dark))",
              boxShadow: "0 0 10px rgba(200,170,110,0.5)",
            }}
          />
          <span className="font-data text-[11px] uppercase tracking-[0.3em] text-[var(--gold)]/80">
            Filtres
          </span>
        </div>
        <span className="text-[11px] uppercase tracking-widest text-white/40 md:hidden">
          {open ? "Réduire" : "Déployer"}
        </span>
      </button>
      <div
        id="vs-filters-body"
        className={`${open ? "block" : "hidden"} md:block px-5 pb-5 md:pt-1`}
      >
        {children}
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// One column of cascaded filters
// ════════════════════════════════════════════════════════════════════

function FilterColumn({
  sideLabel,
  accent,
  value,
  onChange,
  players,
  champions,
  eras,
}: {
  sideLabel: string;
  accent: string;
  value: VSFiltersSide;
  onChange: (next: VSFiltersSide) => void;
  players: VSPlayerOption[];
  champions: string[];
  eras: VSEraOption[];
}) {
  // Champions filtered by player : if a player is picked, narrow the
  // champion list to the champions actually played by that ign (we
  // can't know that without a DB hit, so we just show all and let the
  // RPC filter — this is the lightest cost path).
  const championOptions = useMemo(() => champions, [champions]);
  const roleSelected = value.role ?? "";
  const playerSelected = value.player_slug ?? "";
  const championSelected = value.champion ?? "";
  const eraSelected = value.era_slug ?? "";
  const multiSelected = value.multi_kill_min ?? "";

  const set = useCallback(
    (patch: Partial<VSFiltersSide>) => onChange({ ...value, ...patch }),
    [onChange, value],
  );

  return (
    <div
      className="rounded-xl border bg-[var(--bg-elevated)]/60 p-4 space-y-3"
      style={{
        borderColor: `${accent}33`,
        boxShadow: `0 0 0 1px ${accent}10, inset 0 0 24px ${accent}08`,
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="font-data text-[10px] uppercase tracking-[0.3em]"
          style={{ color: accent }}
        >
          {sideLabel}
        </span>
        <button
          type="button"
          onClick={() => onChange({})}
          className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white/80 transition-colors"
          aria-label={`Réinitialiser les filtres ${sideLabel}`}
        >
          Reset
        </button>
      </div>

      {/* Player */}
      <Field label="Joueur">
        <select
          value={playerSelected}
          onChange={(e) => set({ player_slug: e.target.value || undefined })}
          className="vs-select"
          aria-label={`Joueur ${sideLabel}`}
        >
          <option value="">Tous</option>
          {players.map((p) => (
            <option key={p.ign} value={p.ign}>
              {p.ign}
              {p.role ? ` · ${roleAbbr(p.role)}` : ""}
            </option>
          ))}
        </select>
      </Field>

      {/* Role */}
      <Field label="Rôle">
        <select
          value={roleSelected}
          onChange={(e) =>
            set({
              role: (e.target.value || undefined) as VSFiltersSide["role"],
            })
          }
          className="vs-select"
          aria-label={`Rôle ${sideLabel}`}
        >
          <option value="">Tous</option>
          {VS_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      {/* Champion */}
      <Field label="Champion">
        <select
          value={championSelected}
          onChange={(e) => set({ champion: e.target.value || undefined })}
          className="vs-select"
          aria-label={`Champion ${sideLabel}`}
        >
          <option value="">Tous</option>
          {championOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      {/* Era */}
      <Field label="Époque">
        <select
          value={eraSelected}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) {
              const next = { ...value };
              delete next.era_slug;
              delete next.era_date_start;
              delete next.era_date_end;
              onChange(next);
              return;
            }
            const era = eras.find((er) => er.id === id);
            if (!era) {
              set({ era_slug: id });
              return;
            }
            onChange({
              ...value,
              era_slug: era.id,
              era_date_start: era.dateStart,
              era_date_end: era.dateEnd,
            });
          }}
          className="vs-select"
          aria-label={`Époque ${sideLabel}`}
        >
          <option value="">Toutes</option>
          {eras.map((era) => (
            <option key={era.id} value={era.id}>
              {era.period} · {era.label}
            </option>
          ))}
        </select>
      </Field>

      {/* Multi-kill */}
      <Field label="Multi-kill">
        <select
          value={multiSelected}
          onChange={(e) =>
            set({
              multi_kill_min: (e.target.value ||
                undefined) as VSFiltersSide["multi_kill_min"],
            })
          }
          className="vs-select"
          aria-label={`Multi-kill ${sideLabel}`}
        >
          <option value="">Tous</option>
          {VS_MULTIKILL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {/* First blood + min score */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={value.is_first_blood === true}
            onChange={(e) =>
              set({ is_first_blood: e.target.checked ? true : undefined })
            }
            className="h-4 w-4 rounded border border-white/30 bg-transparent accent-[var(--gold)]"
            aria-label={`First blood uniquement ${sideLabel}`}
          />
          <span className="text-[11px] uppercase tracking-widest text-white/70">
            First Blood
          </span>
        </label>
        <div className="text-right">
          <p className="font-data text-[9px] uppercase tracking-[0.25em] text-white/40">
            Score IA min · {(value.min_highlight_score ?? 0).toFixed(1)}
          </p>
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={value.min_highlight_score ?? 0}
            onChange={(e) =>
              set({
                min_highlight_score:
                  parseFloat(e.target.value) || undefined,
              })
            }
            className="w-[110px] accent-[var(--gold)] mt-1"
            aria-label={`Score IA minimum ${sideLabel}`}
          />
        </div>
      </div>

      <style jsx>{`
        :global(.vs-select) {
          width: 100%;
          background: rgba(1, 10, 19, 0.65);
          border: 1px solid rgba(200, 170, 110, 0.18);
          color: var(--text-primary);
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 13px;
          font-family: var(--font-inter-tight), system-ui, sans-serif;
          appearance: none;
          background-image: linear-gradient(
              45deg,
              transparent 50%,
              var(--gold) 50%
            ),
            linear-gradient(135deg, var(--gold) 50%, transparent 50%);
          background-position: calc(100% - 16px) 50%, calc(100% - 11px) 50%;
          background-size: 5px 5px, 5px 5px;
          background-repeat: no-repeat;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        :global(.vs-select:focus) {
          outline: none;
          border-color: rgba(200, 170, 110, 0.6);
          box-shadow: 0 0 0 2px rgba(200, 170, 110, 0.25);
        }
        :global(.vs-select option) {
          background: var(--bg-elevated);
          color: var(--text-primary);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-data text-[9px] uppercase tracking-[0.3em] text-white/45 mb-1 block">
        {label}
      </span>
      {children}
    </label>
  );
}

function roleAbbr(role: string): string {
  const m: Record<string, string> = {
    top: "TOP",
    jungle: "JGL",
    mid: "MID",
    bottom: "ADC",
    support: "SUP",
  };
  return m[role.toLowerCase()] ?? role.toUpperCase();
}

// ════════════════════════════════════════════════════════════════════
// SPIN button
// ════════════════════════════════════════════════════════════════════

function SpinButton({
  onClick,
  disabled,
  state,
}: {
  onClick: () => void;
  disabled: boolean;
  state: SpinState["kind"];
}) {
  const label =
    state === "spinning"
      ? "Roulette en cours…"
      : state === "idle"
        ? "SPIN"
        : state === "voted" || state === "voting"
          ? "Re-spin"
          : "SPIN";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Lancer la roulette"
      className="relative group inline-flex items-center justify-center font-display text-base font-black uppercase tracking-[0.3em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] disabled:cursor-not-allowed disabled:opacity-70"
      style={{
        padding: "18px 42px",
        color: "var(--bg-primary)",
        background:
          "linear-gradient(135deg, #F0E6D2 0%, #C8AA6E 40%, #785A28 100%)",
        borderRadius: 14,
        boxShadow:
          "0 18px 38px rgba(200,170,110,0.4), 0 0 60px rgba(0,87,255,0.25), inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -2px 0 rgba(0,0,0,0.3)",
      }}
    >
      {/* Inner sweep */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-[14px] overflow-hidden pointer-events-none"
      >
        <span
          className="absolute inset-y-0 -inset-x-12 motion-safe:group-hover:animate-[vs-sweep_1s_ease-in-out_infinite]"
          style={{
            background:
              "linear-gradient(110deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)",
            opacity: 0.45,
            transform: "translateX(-110%)",
          }}
        />
      </span>
      <span className="relative">{label}</span>

      <style jsx>{`
        @keyframes vs-sweep {
          0% {
            transform: translateX(-110%);
          }
          100% {
            transform: translateX(110%);
          }
        }
      `}</style>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════
// Arena — clip pair + roulette animation + vote / result UI
// ════════════════════════════════════════════════════════════════════

function Arena({
  state,
  thumbnails,
  prefersReducedMotion,
  onVote,
  onSpinAgain,
  onResetFilters,
}: {
  state: SpinState;
  thumbnails: string[];
  prefersReducedMotion: boolean;
  onVote: (choice: "a" | "b" | "tie") => void;
  onSpinAgain: () => void;
  onResetFilters: () => void;
}) {
  if (state.kind === "idle") {
    return (
      <IdlePlaceholder
        thumbnails={thumbnails}
        prefersReducedMotion={prefersReducedMotion}
      />
    );
  }

  if (state.kind === "spinning") {
    return (
      <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:gap-6 items-stretch">
        <RouletteReel
          thumbnails={thumbnails}
          accent="var(--cyan)"
          prefersReducedMotion={prefersReducedMotion}
        />
        <CenterVSBadge active />
        <RouletteReel
          thumbnails={thumbnails}
          accent="var(--gold)"
          prefersReducedMotion={prefersReducedMotion}
          delayMs={120}
        />
      </div>
    );
  }

  if (state.kind === "empty") {
    return (
      <CenteredCard tone="warn">
        <p className="font-display text-lg font-bold text-[var(--gold-bright)]">
          Aucune paire trouvée
        </p>
        <p className="mt-2 text-sm text-white/70 max-w-md mx-auto">
          {state.message}
        </p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onResetFilters}
            className="rounded-xl border border-white/25 bg-black/30 px-4 py-2 font-display text-xs font-bold uppercase tracking-widest text-white/80 hover:border-white/50"
            aria-label="Réinitialiser les filtres"
          >
            Changer filtres
          </button>
        </div>
      </CenteredCard>
    );
  }

  if (state.kind === "error") {
    return (
      <CenteredCard tone="error">
        <p className="font-display text-lg font-bold text-[var(--red)]">
          Erreur
        </p>
        <p className="mt-2 text-sm text-white/70 max-w-md mx-auto">
          {state.message}
        </p>
      </CenteredCard>
    );
  }

  // loaded / voting / voted — same layout
  const a = state.a;
  const b = state.b;
  const isVoted = state.kind === "voted";
  const isVoting = state.kind === "voting";
  const voted: "a" | "b" | "tie" | null =
    state.kind === "voted" || state.kind === "voting" ? state.voted : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:gap-6 items-stretch">
        <ClipPanel
          kill={a}
          side="left"
          accent="var(--cyan)"
          highlight={voted === "a"}
          dimmed={isVoted && voted !== "a" && voted !== "tie"}
          prefersReducedMotion={prefersReducedMotion}
        />
        <CenterVSBadge />
        <ClipPanel
          kill={b}
          side="right"
          accent="var(--gold)"
          highlight={voted === "b"}
          dimmed={isVoted && voted !== "b" && voted !== "tie"}
          prefersReducedMotion={prefersReducedMotion}
        />
      </div>

      {/* Vote / result actions */}
      <AnimatePresence mode="wait">
        {isVoted ? (
          <m.div
            key="result"
            initial={
              prefersReducedMotion ? false : { opacity: 0, y: 10 }
            }
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <ResultBlock
              state={state}
              onSpinAgain={onSpinAgain}
              onResetFilters={onResetFilters}
            />
          </m.div>
        ) : (
          <m.div
            key="vote"
            initial={
              prefersReducedMotion ? false : { opacity: 0, y: 10 }
            }
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <VoteRow
              a={a}
              b={b}
              disabled={isVoting}
              onVote={onVote}
            />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Idle placeholder — visible before first spin
// ════════════════════════════════════════════════════════════════════

function IdlePlaceholder({
  thumbnails,
  prefersReducedMotion,
}: {
  thumbnails: string[];
  prefersReducedMotion: boolean;
}) {
  // Show a static 3-thumbnail stack on each side, gently pulsing, with
  // a "Lance la roulette" tagline. No animation cycling — keeps idle
  // CPU near zero.
  const cherry = thumbnails.slice(0, 3);
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:gap-6 items-stretch">
      <IdleStack thumbnails={cherry} accent="var(--cyan)" />
      <div className="flex flex-col items-center justify-center gap-3 py-6 md:py-0">
        <Losange />
        <p className="font-display text-2xl md:text-3xl font-black tracking-tight text-[var(--gold)]">
          VS
        </p>
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-white/45 max-w-[140px] text-center">
          {prefersReducedMotion
            ? "Appuie sur SPIN"
            : "Lance la roulette"}
        </p>
      </div>
      <IdleStack
        thumbnails={[...cherry].reverse()}
        accent="var(--gold)"
        mirror
      />
    </div>
  );
}

function IdleStack({
  thumbnails,
  accent,
  mirror,
}: {
  thumbnails: string[];
  accent: string;
  mirror?: boolean;
}) {
  return (
    <div
      className="relative rounded-2xl border bg-[var(--bg-surface)]/60 overflow-hidden"
      style={{
        borderColor: `${accent}40`,
        boxShadow: `0 18px 38px rgba(0,0,0,0.4), inset 0 0 0 1px ${accent}10`,
        aspectRatio: "9 / 16",
        maxHeight: 540,
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {thumbnails.length === 0 ? (
          <div
            className="font-data text-[10px] uppercase tracking-widest text-white/30"
            aria-hidden
          >
            Aucun clip
          </div>
        ) : (
          thumbnails.map((src, i) => (
            <div
              key={src + i}
              className="absolute h-[68%] w-[58%] rounded-xl overflow-hidden border border-white/15"
              style={{
                transform: `translate(${
                  (i - 1) * (mirror ? -24 : 24)
                }px, ${(i - 1) * 12}px) rotate(${
                  (i - 1) * (mirror ? -4 : 4)
                }deg)`,
                opacity: 0.55 + i * 0.15,
                boxShadow: `0 10px 30px rgba(0,0,0,0.5), 0 0 24px ${accent}30`,
              }}
            >
              <Image
                src={src}
                alt=""
                fill
                sizes="(max-width: 768px) 60vw, 25vw"
                className="object-cover"
              />
            </div>
          ))
        )}
      </div>
      {/* Corner losanges */}
      <CornerLosange position="tl" />
      <CornerLosange position="tr" />
      <CornerLosange position="bl" />
      <CornerLosange position="br" />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Roulette reel — slot-machine cycling thumbnails
// ════════════════════════════════════════════════════════════════════

function RouletteReel({
  thumbnails,
  accent,
  prefersReducedMotion,
  delayMs = 0,
}: {
  thumbnails: string[];
  accent: string;
  prefersReducedMotion: boolean;
  delayMs?: number;
}) {
  const [tickIdx, setTickIdx] = useState(0);
  const [phase, setPhase] = useState<"fast" | "slow" | "lock">("fast");

  useEffect(() => {
    if (prefersReducedMotion || thumbnails.length === 0) return;
    let stopped = false;
    let interval: number;
    const startTimer = window.setTimeout(() => {
      let frameDelay = 70;
      const tick = () => {
        if (stopped) return;
        setTickIdx((i) => (i + 1) % thumbnails.length);
      };
      interval = window.setInterval(tick, frameDelay);

      // Slow down at 50% of the spin
      const slowTimer = window.setTimeout(() => {
        if (stopped) return;
        setPhase("slow");
        window.clearInterval(interval);
        frameDelay = 160;
        interval = window.setInterval(tick, frameDelay);
      }, Math.max(0, SPIN_DURATION_MS * 0.5 - delayMs));

      // Lock-in near the end
      const lockTimer = window.setTimeout(() => {
        if (stopped) return;
        setPhase("lock");
        window.clearInterval(interval);
      }, Math.max(0, SPIN_DURATION_MS - delayMs - 250));

      return () => {
        window.clearTimeout(slowTimer);
        window.clearTimeout(lockTimer);
      };
    }, delayMs);

    return () => {
      stopped = true;
      window.clearTimeout(startTimer);
      window.clearInterval(interval);
    };
  }, [thumbnails, prefersReducedMotion, delayMs]);

  const currentThumb =
    thumbnails.length > 0 ? thumbnails[tickIdx % thumbnails.length] : null;

  const blur =
    prefersReducedMotion || phase === "lock"
      ? 0
      : phase === "fast"
        ? 8
        : 3;

  return (
    <div
      className="relative rounded-2xl border bg-[var(--bg-surface)] overflow-hidden"
      style={{
        borderColor: accent,
        aspectRatio: "9 / 16",
        maxHeight: 540,
        boxShadow: `0 20px 50px rgba(0,0,0,0.55), 0 0 0 1px ${accent}30, 0 0 60px ${accent}45`,
      }}
      aria-live="polite"
      aria-label="Roulette en cours"
    >
      {/* Background flicker thumb */}
      {currentThumb ? (
        <Image
          src={currentThumb}
          alt=""
          fill
          sizes="(max-width: 768px) 60vw, 25vw"
          className="object-cover transition-all"
          style={{
            filter: `blur(${blur}px) saturate(${
              phase === "fast" ? 1.4 : 1.1
            })`,
            opacity: 0.92,
          }}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, var(--bg-surface), var(--bg-elevated))",
          }}
        />
      )}

      {/* Gold sweep that runs through the reel */}
      <m.div
        aria-hidden
        className="absolute inset-y-0 -inset-x-1/3 pointer-events-none"
        initial={{ x: "-110%" }}
        animate={{ x: ["-110%", "110%"] }}
        transition={{
          duration: 0.9,
          repeat: phase === "lock" ? 0 : Infinity,
          ease: "linear",
        }}
        style={{
          background:
            "linear-gradient(110deg, transparent 0%, rgba(240,230,210,0.7) 45%, rgba(200,170,110,0.85) 50%, rgba(240,230,210,0.7) 55%, transparent 100%)",
          opacity: phase === "lock" ? 0 : 0.55,
          mixBlendMode: "screen",
        }}
      />

      {/* Blue-cyan glow pulse */}
      <m.div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        animate={{ opacity: [0.25, 0.55, 0.25] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
        style={{
          background: `radial-gradient(ellipse 70% 50% at 50% 50%, ${accent}30 0%, transparent 70%)`,
          mixBlendMode: "screen",
        }}
      />

      {/* Horizontal scanlines on the reel — slot-machine feel */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-25"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.4) 0px, rgba(0,0,0,0.4) 2px, transparent 2px, transparent 6px)",
        }}
      />

      {/* Corner losanges that spawn at lock-in */}
      <AnimatePresence>
        {phase === "lock" && !prefersReducedMotion && (
          <>
            <SpawningLosange position="tl" />
            <SpawningLosange position="tr" />
            <SpawningLosange position="bl" />
            <SpawningLosange position="br" />
          </>
        )}
      </AnimatePresence>

      {/* Vertical gold center line */}
      <div
        aria-hidden
        className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 pointer-events-none"
        style={{
          width: 1,
          background:
            "linear-gradient(180deg, transparent, rgba(200,170,110,0.6), transparent)",
        }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Clip panel — locked-in result, plays the actual MP4
// ════════════════════════════════════════════════════════════════════

function ClipPanel({
  kill,
  side,
  accent,
  highlight,
  dimmed,
  prefersReducedMotion,
}: {
  kill: VSKill;
  side: "left" | "right";
  accent: string;
  highlight: boolean;
  dimmed: boolean;
  prefersReducedMotion: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrl =
    kill.clip_url_vertical_low ?? kill.clip_url_vertical ?? null;
  const poster = kill.thumbnail_url ?? undefined;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoUrl) return;
    // Mute is required for autoplay on mobile (Safari/Chrome policy).
    el.muted = true;
    el.playsInline = true;
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        /* Autoplay blocked — user can tap to play */
      });
    }
  }, [videoUrl]);

  return (
    <m.div
      initial={
        prefersReducedMotion
          ? false
          : { opacity: 0, scale: 0.94, y: side === "left" ? 18 : 18 }
      }
      animate={{
        opacity: dimmed ? 0.45 : 1,
        scale: highlight ? 1.02 : 1,
        y: 0,
      }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative rounded-2xl border overflow-hidden bg-[var(--bg-surface)]"
      style={{
        borderColor: highlight ? "var(--gold-bright)" : `${accent}55`,
        aspectRatio: "9 / 16",
        maxHeight: 540,
        boxShadow: highlight
          ? "0 22px 50px rgba(0,0,0,0.5), 0 0 0 2px var(--gold-bright), 0 0 80px rgba(240,230,210,0.5)"
          : `0 18px 38px rgba(0,0,0,0.45), 0 0 0 1px ${accent}25, 0 0 40px ${accent}25`,
        transition:
          "box-shadow 0.45s cubic-bezier(0.16, 1, 0.3, 1), filter 0.45s",
      }}
    >
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
          aria-label={`Clip de ${kill.killer_name ?? kill.killer_champion ?? "?"}`}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-white/40">
          Clip indisponible
        </div>
      )}

      {/* Bottom info gradient */}
      <div className="absolute inset-x-0 bottom-0 pointer-events-none">
        <div className="bg-gradient-to-t from-black via-black/60 to-transparent px-4 py-4 pt-12 text-left">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="rounded-md px-1.5 py-0.5 text-[9px] font-data font-bold uppercase tracking-widest"
              style={{
                color: accent,
                backgroundColor: `${accent}1f`,
                border: `1px solid ${accent}50`,
              }}
            >
              {kill.killer_role ? roleAbbr(kill.killer_role) : "KC"}
            </span>
            {kill.multi_kill ? (
              <span className="rounded-md bg-[var(--orange)]/20 border border-[var(--orange)]/40 px-1.5 py-0.5 text-[9px] font-data font-bold uppercase tracking-widest text-[var(--orange)]">
                {kill.multi_kill}
              </span>
            ) : null}
            {kill.is_first_blood ? (
              <span className="rounded-md bg-[var(--red)]/20 border border-[var(--red)]/40 px-1.5 py-0.5 text-[9px] font-data font-bold uppercase tracking-widest text-[var(--red)]">
                FB
              </span>
            ) : null}
          </div>
          <p className="font-display text-lg font-black text-white leading-tight">
            <span style={{ color: accent }}>
              {kill.killer_name ?? "?"}
            </span>{" "}
            <span className="text-white/70">{kill.killer_champion}</span>
          </p>
          <p className="text-[11px] text-white/65 mt-0.5">
            → {kill.victim_name ?? kill.victim_champion ?? "?"}{" "}
            <span className="text-white/35">({kill.victim_champion})</span>
          </p>
          {kill.ai_description ? (
            <p className="text-[11px] text-white/55 mt-1.5 line-clamp-2">
              {kill.ai_description}
            </p>
          ) : null}
        </div>
      </div>

      {/* Score badges top-right */}
      <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
        {kill.highlight_score != null ? (
          <span className="rounded-md bg-black/60 backdrop-blur-sm px-1.5 py-0.5 text-[10px] font-data text-[var(--gold)]">
            IA {kill.highlight_score.toFixed(1)}
          </span>
        ) : null}
        <span className="rounded-md bg-black/60 backdrop-blur-sm px-1.5 py-0.5 text-[10px] font-data text-white/80">
          ELO {Math.round(kill.elo_rating ?? 1500)}
        </span>
      </div>

      <CornerLosange position="tl" gold />
      <CornerLosange position="br" gold />
    </m.div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Center VS badge
// ════════════════════════════════════════════════════════════════════

function CenterVSBadge({ active }: { active?: boolean } = {}) {
  return (
    <div className="flex md:flex-col items-center justify-center gap-2 md:gap-3 py-3 md:py-0">
      <div
        aria-hidden
        className="hidden md:block w-px"
        style={{
          height: 90,
          background:
            "linear-gradient(180deg, transparent, rgba(200,170,110,0.6), transparent)",
        }}
      />
      <div
        className="relative inline-flex items-center justify-center rounded-full font-display font-black text-2xl"
        style={{
          width: 64,
          height: 64,
          color: "var(--bg-primary)",
          background:
            "linear-gradient(135deg, #F0E6D2, #C8AA6E 50%, #785A28)",
          boxShadow:
            "0 14px 30px rgba(0,0,0,0.5), 0 0 30px rgba(200,170,110,0.45), inset 0 1px 0 rgba(255,255,255,0.5)",
          letterSpacing: "0.05em",
          animation: active ? "vs-pulse 0.9s ease-in-out infinite" : undefined,
        }}
      >
        VS
        <style jsx>{`
          @keyframes vs-pulse {
            0%,
            100% {
              transform: scale(1);
              box-shadow: 0 14px 30px rgba(0, 0, 0, 0.5),
                0 0 30px rgba(200, 170, 110, 0.45),
                inset 0 1px 0 rgba(255, 255, 255, 0.5);
            }
            50% {
              transform: scale(1.08);
              box-shadow: 0 18px 36px rgba(0, 0, 0, 0.55),
                0 0 60px rgba(240, 230, 210, 0.7),
                inset 0 1px 0 rgba(255, 255, 255, 0.6);
            }
          }
        `}</style>
      </div>
      <div
        aria-hidden
        className="hidden md:block w-px"
        style={{
          height: 90,
          background:
            "linear-gradient(180deg, transparent, rgba(200,170,110,0.6), transparent)",
        }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Vote row
// ════════════════════════════════════════════════════════════════════

function VoteRow({
  a,
  b,
  disabled,
  onVote,
}: {
  a: VSKill;
  b: VSKill;
  disabled: boolean;
  onVote: (choice: "a" | "b" | "tie") => void;
}) {
  const labelA = a.killer_name ?? a.killer_champion ?? "Gauche";
  const labelB = b.killer_name ?? b.killer_champion ?? "Droite";
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] items-stretch">
      <m.button
        type="button"
        onClick={() => onVote("a")}
        disabled={disabled}
        aria-label={`Vote pour le clip de ${labelA}`}
        whileTap={{ scale: 0.97 }}
        className="group rounded-xl border border-[var(--cyan)]/40 bg-[var(--cyan)]/5 backdrop-blur-sm px-5 py-3.5 font-display text-sm font-black uppercase tracking-[0.2em] text-[var(--cyan)] hover:bg-[var(--cyan)]/15 hover:border-[var(--cyan)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        style={{
          boxShadow: "0 12px 28px rgba(10,200,185,0.18)",
        }}
      >
        <span className="mr-2 group-hover:-translate-x-0.5 inline-block transition-transform">
          👈
        </span>
        Plus fort
      </m.button>

      <m.button
        type="button"
        onClick={() => onVote("tie")}
        disabled={disabled}
        aria-label="Vote pour l'égalité"
        whileTap={{ scale: 0.97 }}
        className="rounded-xl border border-white/25 bg-black/30 backdrop-blur-sm px-4 py-3 font-data text-[11px] font-bold uppercase tracking-[0.3em] text-white/70 hover:border-white/55 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        Égalité
      </m.button>

      <m.button
        type="button"
        onClick={() => onVote("b")}
        disabled={disabled}
        aria-label={`Vote pour le clip de ${labelB}`}
        whileTap={{ scale: 0.97 }}
        className="group rounded-xl border border-[var(--gold)]/45 bg-[var(--gold)]/8 backdrop-blur-sm px-5 py-3.5 font-display text-sm font-black uppercase tracking-[0.2em] text-[var(--gold)] hover:bg-[var(--gold)]/20 hover:border-[var(--gold)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        style={{
          boxShadow: "0 12px 28px rgba(200,170,110,0.22)",
        }}
      >
        Plus fort
        <span className="ml-2 group-hover:translate-x-0.5 inline-block transition-transform">
          👉
        </span>
      </m.button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Result block — shows ELO delta + winrate + actions
// ════════════════════════════════════════════════════════════════════

function ResultBlock({
  state,
  onSpinAgain,
  onResetFilters,
}: {
  state: Extract<SpinState, { kind: "voted" }>;
  onSpinAgain: () => void;
  onResetFilters: () => void;
}) {
  const { a, b, result, voted, deltaA, deltaB } = state;
  const aIsRowA = result.kill_a_id === a.id;
  const aBattles = aIsRowA ? result.kill_a_battles : result.kill_b_battles;
  const aWins = aIsRowA ? result.kill_a_wins : result.kill_b_wins;
  const bBattles = aIsRowA ? result.kill_b_battles : result.kill_a_battles;
  const bWins = aIsRowA ? result.kill_b_wins : result.kill_a_wins;

  const aEloAfter = Math.round(
    aIsRowA ? result.kill_a_elo : result.kill_b_elo,
  );
  const bEloAfter = Math.round(
    aIsRowA ? result.kill_b_elo : result.kill_a_elo,
  );

  const inserted = result.inserted;

  return (
    <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/80 backdrop-blur-md p-5 md:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Losange small />
          <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70">
            {inserted ? "Vote enregistré" : "Vote déjà compté"}
          </p>
        </div>
        {voted === "tie" ? (
          <p className="font-display text-[11px] uppercase tracking-widest text-white/55">
            Égalité — pas de gagnant
          </p>
        ) : (
          <p className="font-display text-[11px] uppercase tracking-widest text-white/55">
            Vainqueur :{" "}
            <span className="text-[var(--gold)]">
              {voted === "a"
                ? a.killer_name ?? a.killer_champion
                : b.killer_name ?? b.killer_champion}
            </span>
          </p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ResultStatCard
          accent="var(--cyan)"
          name={a.killer_name ?? a.killer_champion ?? "?"}
          champion={a.killer_champion}
          eloAfter={aEloAfter}
          delta={deltaA}
          battles={aBattles}
          wins={aWins}
          winner={voted === "a"}
        />
        <ResultStatCard
          accent="var(--gold)"
          name={b.killer_name ?? b.killer_champion ?? "?"}
          champion={b.killer_champion}
          eloAfter={bEloAfter}
          delta={deltaB}
          battles={bBattles}
          wins={bWins}
          winner={voted === "b"}
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <button
          type="button"
          onClick={onSpinAgain}
          aria-label="Relancer la roulette avec les mêmes filtres"
          className="rounded-xl bg-[var(--gold)] px-6 py-2.5 font-display text-xs font-black uppercase tracking-[0.25em] text-[var(--bg-primary)] hover:bg-[var(--gold-bright)] hover:scale-[1.02] active:scale-95 transition-all"
          style={{
            boxShadow:
              "0 12px 28px rgba(200,170,110,0.35), inset 0 1px 0 rgba(255,255,255,0.4)",
          }}
        >
          Encore
        </button>
        <button
          type="button"
          onClick={onResetFilters}
          aria-label="Réinitialiser les filtres"
          className="rounded-xl border border-white/25 bg-black/30 px-5 py-2.5 font-display text-xs font-bold uppercase tracking-[0.25em] text-white/75 hover:border-white/55 hover:text-white transition-all"
        >
          Changer filtres
        </button>
        <Link
          href="/vs/leaderboard"
          className="rounded-xl border border-[var(--gold)]/45 bg-black/30 px-5 py-2.5 font-display text-xs font-bold uppercase tracking-[0.25em] text-[var(--gold)] hover:border-[var(--gold)] hover:bg-[var(--gold)]/10 transition-all"
        >
          Classement ELO
        </Link>
      </div>
    </div>
  );
}

function ResultStatCard({
  accent,
  name,
  champion,
  eloAfter,
  delta,
  battles,
  wins,
  winner,
}: {
  accent: string;
  name: string;
  champion: string | null;
  eloAfter: number;
  delta: number;
  battles: number;
  wins: number;
  winner: boolean;
}) {
  const wr = winRatePct(wins, battles);
  return (
    <div
      className="rounded-xl border bg-[var(--bg-elevated)]/50 p-4"
      style={{
        borderColor: winner ? "var(--gold-bright)" : `${accent}33`,
        boxShadow: winner
          ? "0 12px 30px rgba(240,230,210,0.18), inset 0 0 0 1px var(--gold-bright)"
          : `0 8px 24px rgba(0,0,0,0.35), inset 0 0 0 1px ${accent}15`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p
            className="font-display text-sm font-black uppercase tracking-[0.15em] truncate"
            style={{ color: accent }}
          >
            {name}
          </p>
          <p className="text-[10px] text-white/55 truncate">
            {champion ?? "?"}
          </p>
        </div>
        {winner ? (
          <span
            className="rounded-md px-2 py-0.5 font-data text-[9px] uppercase tracking-widest"
            style={{
              color: "var(--bg-primary)",
              background:
                "linear-gradient(135deg, var(--gold-bright), var(--gold))",
            }}
          >
            Vainqueur
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat
          label="ELO"
          value={`${eloAfter}`}
          sub={
            <span
              className="font-data text-[10px]"
              style={{
                color:
                  delta > 0
                    ? "var(--green)"
                    : delta < 0
                      ? "var(--red)"
                      : "var(--text-muted)",
              }}
            >
              {formatEloDelta(delta)}
            </span>
          }
        />
        <Stat label="Battles" value={`${battles}`} />
        <Stat label="Winrate" value={`${wr}%`} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-black/30 px-2 py-2 text-center">
      <p className="font-data text-[8.5px] uppercase tracking-[0.25em] text-white/45">
        {label}
      </p>
      <p className="font-display text-base font-black text-white">{value}</p>
      {sub ? <div className="mt-0.5">{sub}</div> : null}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Helpers — losange / centered card
// ════════════════════════════════════════════════════════════════════

function CornerLosange({
  position,
  gold,
}: {
  position: "tl" | "tr" | "bl" | "br";
  gold?: boolean;
}) {
  const map: Record<string, string> = {
    tl: "top-2 left-2",
    tr: "top-2 right-2",
    bl: "bottom-2 left-2",
    br: "bottom-2 right-2",
  };
  return (
    <span
      aria-hidden
      className={`absolute ${map[position]}`}
      style={{
        width: 8,
        height: 8,
        transform: "rotate(45deg)",
        background: gold
          ? "linear-gradient(135deg, var(--gold-bright), var(--gold))"
          : "rgba(200,170,110,0.5)",
        boxShadow: gold ? "0 0 10px rgba(200,170,110,0.6)" : undefined,
      }}
    />
  );
}

function SpawningLosange({
  position,
}: {
  position: "tl" | "tr" | "bl" | "br";
}) {
  const map: Record<string, string> = {
    tl: "top-3 left-3",
    tr: "top-3 right-3",
    bl: "bottom-3 left-3",
    br: "bottom-3 right-3",
  };
  return (
    <m.span
      aria-hidden
      initial={{ scale: 0, rotate: 0, opacity: 0 }}
      animate={{ scale: 1, rotate: 45, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className={`absolute ${map[position]}`}
      style={{
        width: 12,
        height: 12,
        background:
          "linear-gradient(135deg, var(--gold-bright), var(--gold))",
        boxShadow: "0 0 18px rgba(240,230,210,0.7)",
      }}
    />
  );
}

function Losange({ small }: { small?: boolean } = {}) {
  const size = small ? 8 : 14;
  return (
    <span
      aria-hidden
      className="inline-block"
      style={{
        width: size,
        height: size,
        transform: "rotate(45deg)",
        background:
          "linear-gradient(135deg, var(--gold-bright), var(--gold))",
        boxShadow: "0 0 14px rgba(200,170,110,0.5)",
      }}
    />
  );
}

function CenteredCard({
  tone,
  children,
}: {
  tone: "warn" | "error";
  children: React.ReactNode;
}) {
  const borderColor =
    tone === "warn" ? "var(--orange)" : "var(--red)";
  return (
    <div
      className="rounded-2xl border bg-[var(--bg-surface)]/80 px-6 py-10 text-center"
      style={{
        borderColor,
        boxShadow: `0 16px 38px rgba(0,0,0,0.4), inset 0 0 0 1px ${borderColor}25`,
      }}
    >
      {children}
    </div>
  );
}
