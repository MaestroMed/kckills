"use client";

/**
 * CompilationBuilder — 3-step wizard for /compilation.
 *
 *   Step 1 : Picker        (filter + multi-select from the published pool)
 *   Step 2 : Reorder       (drag-to-reorder ribbon + intro/outro text)
 *   Step 3 : Title         (title + description + submit)
 *   Step 4 (success view)  : short URL + polling status
 *
 * Notes :
 *   - Anon-friendly. We mint a session_hash on first interaction and
 *     keep it in localStorage under `kckills_compilation_session`.
 *     Same shape as the BCC / VS roulette helpers : `comp-<hex32>`.
 *   - Reorder uses motion@12's Reorder primitive
 *     (re-exported from framer-motion). When `prefers-reduced-motion`
 *     is set, the drag animation is reduced to a snap — we lean on
 *     useReducedMotion() to flip the layout transition off.
 *   - The polling loop ticks every 10 s while the render is pending
 *     and tears down on unmount + on status === 'done' | 'failed'.
 *   - Mobile-first : the picker grid is 2 cols on 375 px, 4 cols on
 *     desktop. Sticky bottom action bar so "Suivant" stays in reach.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { m, AnimatePresence, Reorder, useReducedMotion } from "motion/react";

import { championIconUrl } from "@/lib/constants";

// ─── Public types (consumed by page.tsx) ────────────────────────────────

export interface BuilderKill {
  id: string;
  killerChampion: string | null;
  victimChampion: string | null;
  killerPlayerId: string | null;
  thumbnailUrl: string | null;
  clipUrlVertical: string | null;
  clipUrlHorizontal: string | null;
  multiKill: string | null;
  isFirstBlood: boolean;
  highlightScore: number | null;
  avgRating: number | null;
  ratingCount: number;
  aiDescription: string | null;
  aiTags: string[];
  matchDate: string | null;
  matchStage: string | null;
  gameNumber: number;
}

interface CompilationBuilderProps {
  pool: BuilderKill[];
}

// ─── Session helpers (anon ownership) ──────────────────────────────────

const SESSION_KEY = "kckills_compilation_session";

function generateSessionHash(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `comp-${hex}`;
}

function getCompilationSessionHash(): string {
  if (typeof window === "undefined") return "comp-ssr-placeholder-hash";
  try {
    const cur = window.localStorage.getItem(SESSION_KEY);
    if (cur && cur.length >= 16) return cur;
    const fresh = generateSessionHash();
    window.localStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return generateSessionHash();
  }
}

// ─── Filter state ──────────────────────────────────────────────────────

type MultiKillFilter = "any" | "double" | "triple" | "quadra" | "penta" | "fb";

interface PickerFilters {
  q: string;
  multi: MultiKillFilter;
  minScore: number; // 0-10 highlight floor
  player: string; // killer_player_id ("" = any)
}

const DEFAULT_FILTERS: PickerFilters = { q: "", multi: "any", minScore: 0, player: "" };

// ─── Constants ────────────────────────────────────────────────────────

const MIN_CLIPS = 3;
const MAX_CLIPS = 10;
const MAX_HARD = 20; // schema cap — RPC enforces too

// ─── Component ────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | "success";

interface SuccessState {
  shortCode: string;
  id: string;
}

interface PollState {
  status: "pending" | "rendering" | "done" | "failed";
  outputUrl: string | null;
  renderError: string | null;
}

export function CompilationBuilder({ pool }: CompilationBuilderProps) {
  const reduced = useReducedMotion();

  // ── State ──────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1);
  const [filters, setFilters] = useState<PickerFilters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<BuilderKill[]>([]); // order matters
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [introText, setIntroText] = useState("");
  const [outroText, setOutroText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [poll, setPoll] = useState<PollState | null>(null);

  const titleInputId = useId();
  const descInputId = useId();

  // ── Filtered pool ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const minScore = filters.minScore;
    return pool.filter((k) => {
      if (minScore > 0 && (k.highlightScore ?? 0) < minScore) return false;
      if (filters.player && k.killerPlayerId !== filters.player) return false;
      if (filters.multi !== "any") {
        if (filters.multi === "fb") {
          if (!k.isFirstBlood) return false;
        } else {
          if (k.multiKill !== filters.multi) return false;
        }
      }
      if (q) {
        const hay = (
          (k.killerChampion ?? "") +
          " " +
          (k.victimChampion ?? "") +
          " " +
          (k.aiDescription ?? "") +
          " " +
          (k.aiTags || []).join(" ")
        ).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pool, filters]);

  // List of player chips, from the pool — small N so it's cheap each render.
  const playerChips = useMemo(() => {
    const seen = new Map<string, { id: string; champion: string | null }>();
    for (const k of pool) {
      if (!k.killerPlayerId) continue;
      if (seen.has(k.killerPlayerId)) continue;
      seen.set(k.killerPlayerId, {
        id: k.killerPlayerId,
        champion: k.killerChampion,
      });
    }
    return Array.from(seen.values()).slice(0, 8);
  }, [pool]);

  // ── Selection helpers ──────────────────────────────────────────
  const selectedIds = useMemo(() => new Set(selected.map((k) => k.id)), [selected]);

  const toggle = useCallback(
    (kill: BuilderKill) => {
      setSelected((prev) => {
        if (prev.some((k) => k.id === kill.id)) {
          return prev.filter((k) => k.id !== kill.id);
        }
        if (prev.length >= MAX_HARD) return prev;
        return [...prev, kill];
      });
    },
    [],
  );

  const removeAt = useCallback((id: string) => {
    setSelected((prev) => prev.filter((k) => k.id !== id));
  }, []);

  // ── Submit ─────────────────────────────────────────────────────
  const canGoStep2 = selected.length >= MIN_CLIPS && selected.length <= MAX_CLIPS;
  const canGoStep3 = canGoStep2;
  const canSubmit = canGoStep3 && title.trim().length > 0;

  const submit = useCallback(async () => {
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const sessionHash = getCompilationSessionHash();
      const res = await fetch("/api/compilation/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          killIds: selected.map((k) => k.id),
          introText: introText.trim() || undefined,
          outroText: outroText.trim() || undefined,
          sessionHash,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; shortCode: string; id: string; viewerUrl: string }
        | { ok: false; error: string };
      if (!res.ok || !json.ok) {
        const msg = "error" in json ? json.error : "Échec de la création.";
        setSubmitError(msg);
        setSubmitting(false);
        return;
      }
      setSuccess({ shortCode: json.shortCode, id: json.id });
      setPoll({ status: "pending", outputUrl: null, renderError: null });
      setStep("success");
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Erreur réseau — réessaie dans un instant.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [submitting, canSubmit, title, description, selected, introText, outroText]);

  // ── Status polling ─────────────────────────────────────────────
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!success) return;
    if (poll?.status === "done" || poll?.status === "failed") return;

    let cancelled = false;
    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch(`/c/${success!.shortCode}/status.json`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: PollState["status"];
          outputUrl: string | null;
          renderError: string | null;
        };
        if (cancelled) return;
        setPoll({
          status: data.status,
          outputUrl: data.outputUrl,
          renderError: data.renderError,
        });
      } catch {
        // Network blip — keep polling, no toast.
      }
    }
    void tick();
    pollTimer.current = setInterval(() => void tick(), 10_000);
    return () => {
      cancelled = true;
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [success, poll?.status]);

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="mx-auto mt-8 max-w-6xl">
      <StepIndicator step={step} />

      <AnimatePresence mode="wait">
        {step === 1 ? (
          <m.div
            key="step1"
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <PickerStep
              pool={pool}
              filtered={filtered}
              filters={filters}
              setFilters={setFilters}
              selected={selected}
              selectedIds={selectedIds}
              toggle={toggle}
              removeAt={removeAt}
              playerChips={playerChips}
            />
            <StickyBar
              left={
                <span className="text-sm">
                  <span className="font-mono text-[var(--gold)]">{selected.length}</span>
                  <span className="text-[var(--text-muted)]">
                    /{MIN_CLIPS}–{MAX_CLIPS} clips
                  </span>
                </span>
              }
              right={
                <button
                  type="button"
                  disabled={!canGoStep2}
                  onClick={() => setStep(2)}
                  className="rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-bold text-black transition disabled:cursor-not-allowed disabled:bg-[var(--gold-dark)] disabled:text-[var(--text-disabled)]"
                >
                  Suivant — Réordonner
                </button>
              }
            />
          </m.div>
        ) : null}

        {step === 2 ? (
          <m.div
            key="step2"
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <ReorderStep
              selected={selected}
              setSelected={setSelected}
              introText={introText}
              setIntroText={setIntroText}
              outroText={outroText}
              setOutroText={setOutroText}
              reducedMotion={Boolean(reduced)}
            />
            <StickyBar
              left={
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="text-sm text-[var(--text-secondary)] hover:text-[var(--gold)]"
                >
                  ← Retour au picker
                </button>
              }
              right={
                <button
                  type="button"
                  disabled={!canGoStep3}
                  onClick={() => setStep(3)}
                  className="rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-bold text-black transition disabled:cursor-not-allowed disabled:bg-[var(--gold-dark)] disabled:text-[var(--text-disabled)]"
                >
                  Suivant — Titre
                </button>
              }
            />
          </m.div>
        ) : null}

        {step === 3 ? (
          <m.div
            key="step3"
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <TitleStep
              titleInputId={titleInputId}
              descInputId={descInputId}
              title={title}
              setTitle={setTitle}
              description={description}
              setDescription={setDescription}
              selected={selected}
              submitError={submitError}
            />
            <StickyBar
              left={
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="text-sm text-[var(--text-secondary)] hover:text-[var(--gold)]"
                >
                  ← Retour
                </button>
              }
              right={
                <button
                  type="button"
                  disabled={!canSubmit || submitting}
                  onClick={() => void submit()}
                  className="rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-bold text-black transition disabled:cursor-not-allowed disabled:bg-[var(--gold-dark)] disabled:text-[var(--text-disabled)]"
                >
                  {submitting ? "Lancement…" : "Lancer le rendu"}
                </button>
              }
            />
          </m.div>
        ) : null}

        {step === "success" && success ? (
          <m.div
            key="success"
            initial={reduced ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <SuccessStep
              shortCode={success.shortCode}
              poll={poll}
              clipCount={selected.length}
            />
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step indicator
// ════════════════════════════════════════════════════════════════════

function StepIndicator({ step }: { step: Step }) {
  const labels = [
    { id: 1, label: "Clips" },
    { id: 2, label: "Ordre" },
    { id: 3, label: "Titre" },
  ] as const;
  const numericStep = step === "success" ? 4 : step;
  return (
    <ol className="mb-6 flex items-center gap-3 sm:gap-6">
      {labels.map((l) => {
        const isActive = numericStep === l.id;
        const isDone = numericStep > l.id;
        return (
          <li
            key={l.id}
            className="flex items-center gap-2"
            aria-current={isActive ? "step" : undefined}
          >
            <span
              className={`flex size-7 items-center justify-center rounded-full border text-xs font-bold transition ${
                isDone
                  ? "border-[var(--gold)] bg-[var(--gold)] text-black"
                  : isActive
                    ? "border-[var(--gold)] text-[var(--gold)]"
                    : "border-[var(--border-subtle)] text-[var(--text-muted)]"
              }`}
            >
              {isDone ? "✓" : l.id}
            </span>
            <span
              className={`text-xs uppercase tracking-[0.2em] ${
                isActive ? "text-[var(--gold)]" : "text-[var(--text-muted)]"
              }`}
            >
              {l.label}
            </span>
            {l.id < 3 ? (
              <span className="ml-2 hidden h-px w-8 bg-[var(--border-subtle)] sm:inline-block" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step 1 — Picker
// ════════════════════════════════════════════════════════════════════

interface PickerStepProps {
  pool: BuilderKill[];
  filtered: BuilderKill[];
  filters: PickerFilters;
  setFilters: React.Dispatch<React.SetStateAction<PickerFilters>>;
  selected: BuilderKill[];
  selectedIds: Set<string>;
  toggle: (k: BuilderKill) => void;
  removeAt: (id: string) => void;
  playerChips: Array<{ id: string; champion: string | null }>;
}

function PickerStep({
  pool,
  filtered,
  filters,
  setFilters,
  selected,
  selectedIds,
  toggle,
  removeAt,
  playerChips,
}: PickerStepProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            placeholder="Champion, joueur, tag…"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--gold)]/40 focus:outline-none"
            aria-label="Rechercher un clip"
          />
          <select
            value={filters.multi}
            onChange={(e) =>
              setFilters((f) => ({ ...f, multi: e.target.value as MultiKillFilter }))
            }
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--gold)]/40 focus:outline-none"
            aria-label="Filtrer par type"
          >
            <option value="any">Tous</option>
            <option value="fb">First Blood</option>
            <option value="double">Double</option>
            <option value="triple">Triple</option>
            <option value="quadra">Quadra</option>
            <option value="penta">Penta</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span className="hidden sm:inline">Score ≥</span>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={filters.minScore}
              onChange={(e) =>
                setFilters((f) => ({ ...f, minScore: Number(e.target.value) }))
              }
              className="h-1 w-20 accent-[var(--gold)]"
              aria-label="Score minimum"
            />
            <span className="font-mono text-[var(--gold)]">{filters.minScore}</span>
          </label>
        </div>

        {playerChips.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-2">
            <ChipButton
              active={filters.player === ""}
              onClick={() => setFilters((f) => ({ ...f, player: "" }))}
            >
              Tous joueurs
            </ChipButton>
            {playerChips.map((p) => (
              <ChipButton
                key={p.id}
                active={filters.player === p.id}
                onClick={() => setFilters((f) => ({ ...f, player: p.id }))}
              >
                {p.champion ?? "?"}
              </ChipButton>
            ))}
          </div>
        ) : null}

        <div className="text-xs text-[var(--text-muted)]">
          {filtered.length}/{pool.length} clip{filtered.length === 1 ? "" : "s"} affiché
          {filtered.length === 1 ? "" : "s"}
        </div>

        <ul
          role="listbox"
          aria-label="Clips disponibles"
          aria-multiselectable
          className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          {filtered.map((k) => {
            const idx = selected.findIndex((s) => s.id === k.id);
            const sel = idx >= 0;
            return (
              <PickerCard
                key={k.id}
                kill={k}
                selected={sel}
                orderBadge={sel ? idx + 1 : null}
                onClick={() => toggle(k)}
              />
            );
          })}
        </ul>

        {filtered.length === 0 ? (
          <p className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/30 px-4 py-6 text-center text-sm text-[var(--text-muted)]">
            Aucun clip ne matche ces filtres. Élargis la recherche.
          </p>
        ) : null}
      </div>

      {/* ───── Selection sidecar ──────────────────────────────── */}
      <aside className="sticky top-4 hidden h-fit rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/40 p-4 lg:block">
        <h2 className="mb-1 font-display text-sm font-bold uppercase tracking-[0.2em] text-[var(--gold)]">
          Ta sélection
        </h2>
        <p className="mb-3 text-[11px] text-[var(--text-muted)]">
          {selected.length === 0
            ? "Clique un clip pour le sélectionner."
            : `${selected.length} clip${selected.length === 1 ? "" : "s"} — ordre modifiable à l'étape suivante.`}
        </p>
        {selected.length > 0 ? (
          <ol className="space-y-2">
            {selected.map((k, i) => (
              <li
                key={k.id}
                className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 p-2"
              >
                <span className="font-mono text-xs text-[var(--gold)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="relative size-10 shrink-0 overflow-hidden rounded">
                  <Image
                    src={championIconUrl(k.killerChampion ?? "Aatrox")}
                    alt={k.killerChampion ?? "?"}
                    width={40}
                    height={40}
                    className="size-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1 text-xs">
                  <p className="truncate text-[var(--text-primary)]">
                    {k.killerChampion} → {k.victimChampion}
                  </p>
                  <p className="truncate text-[10px] text-[var(--text-muted)]">
                    {k.matchStage ?? "LEC"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeAt(k.id)}
                  aria-label={`Retirer ${k.killerChampion} → ${k.victimChampion}`}
                  className="rounded p-1 text-[var(--text-muted)] hover:bg-black/20 hover:text-[var(--red)]"
                >
                  <svg className="size-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </aside>
    </div>
  );
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.16em] transition ${
        active
          ? "bg-[var(--gold)] text-black"
          : "border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 text-[var(--text-muted)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)]"
      }`}
    >
      {children}
    </button>
  );
}

function PickerCard({
  kill,
  selected,
  orderBadge,
  onClick,
}: {
  kill: BuilderKill;
  selected: boolean;
  orderBadge: number | null;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        role="option"
        aria-selected={selected}
        className={`group relative block aspect-[9/16] w-full overflow-hidden rounded-xl border-2 text-left transition focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/60 ${
          selected
            ? "border-[var(--gold)] shadow-lg shadow-[var(--gold)]/20"
            : "border-[var(--border-subtle)] hover:border-[var(--gold)]/50"
        }`}
      >
        {kill.thumbnailUrl ? (
          <Image
            src={kill.thumbnailUrl}
            alt={`${kill.killerChampion ?? "?"} → ${kill.victimChampion ?? "?"}`}
            fill
            sizes="(min-width: 1024px) 16rem, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-[var(--bg-surface)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

        {/* Top-left : score */}
        {kill.highlightScore !== null ? (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-[var(--gold)]">
            {kill.highlightScore.toFixed(1)}
          </span>
        ) : null}
        {/* Top-right : multi-kill badge */}
        {kill.multiKill ? (
          <span className="absolute right-1.5 top-1.5 rounded-md bg-[var(--red)]/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
            {kill.multiKill}
          </span>
        ) : kill.isFirstBlood ? (
          <span className="absolute right-1.5 top-1.5 rounded-md bg-[var(--gold)]/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--gold-bright)]">
            FB
          </span>
        ) : null}

        {/* Bottom : kill summary */}
        <div className="absolute inset-x-0 bottom-0 p-2">
          <p className="font-display text-xs font-bold leading-tight text-[var(--text-primary)]">
            <span className="text-[var(--gold)]">{kill.killerChampion}</span>
            <span className="text-[var(--text-muted)]"> → </span>
            <span>{kill.victimChampion}</span>
          </p>
          <p className="mt-0.5 truncate text-[9px] text-[var(--text-muted)]">
            {kill.matchStage ?? "LEC"}
          </p>
        </div>

        {/* Order badge */}
        {selected && orderBadge !== null ? (
          <span
            className="absolute left-1.5 bottom-1.5 flex size-7 items-center justify-center rounded-full bg-[var(--gold)] font-mono text-xs font-bold text-black shadow"
            aria-label={`Position ${orderBadge}`}
          >
            {orderBadge}
          </span>
        ) : null}

        {/* Selected overlay tick */}
        {selected ? (
          <span className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-[var(--gold)]" />
        ) : null}
      </button>
    </li>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step 2 — Reorder + intro/outro
// ════════════════════════════════════════════════════════════════════

interface ReorderStepProps {
  selected: BuilderKill[];
  setSelected: React.Dispatch<React.SetStateAction<BuilderKill[]>>;
  introText: string;
  setIntroText: (v: string) => void;
  outroText: string;
  setOutroText: (v: string) => void;
  reducedMotion: boolean;
}

function ReorderStep({
  selected,
  setSelected,
  introText,
  setIntroText,
  outroText,
  setOutroText,
  reducedMotion,
}: ReorderStepProps) {
  return (
    <section>
      <header className="mb-4">
        <h2 className="font-display text-xl font-black text-[var(--gold)]">
          Compose ta séquence
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Glisse les vignettes pour les réordonner. Ajoute un titre d&apos;intro et un
          mot de fin si tu veux signer ton best-of.
        </p>
      </header>

      {/* Intro */}
      <TextCard
        eyebrow="Titre d'intro"
        placeholder="Ex. — Best of Caliste 2026 Spring"
        value={introText}
        onChange={setIntroText}
        max={160}
        accent="cyan"
      />

      {/* Reorder ribbon */}
      <div className="my-6 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/30 p-3">
        <Reorder.Group
          axis="x"
          values={selected}
          onReorder={setSelected}
          className="flex gap-3 overflow-x-auto pb-2"
          role="list"
          aria-label="Séquence des clips — glisse pour réordonner"
        >
          {selected.map((k, i) => (
            <Reorder.Item
              key={k.id}
              value={k}
              dragListener
              whileDrag={
                reducedMotion
                  ? undefined
                  : { scale: 1.06, boxShadow: "0 12px 32px rgba(0,0,0,.5)" }
              }
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="group relative size-32 shrink-0 cursor-grab overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] active:cursor-grabbing sm:size-40"
              aria-label={`${i + 1}. ${k.killerChampion} → ${k.victimChampion}`}
            >
              {k.thumbnailUrl ? (
                <Image
                  src={k.thumbnailUrl}
                  alt=""
                  fill
                  sizes="160px"
                  className="object-cover"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40" />
              <span className="absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-[var(--gold)] font-mono text-[11px] font-bold text-black">
                {i + 1}
              </span>
              <span className="absolute right-1.5 top-1.5 text-[10px] text-white/80">
                ↔ Drag
              </span>
              <div className="absolute inset-x-1.5 bottom-1.5 text-[10px] text-white">
                <p className="truncate font-bold">
                  {k.killerChampion} → {k.victimChampion}
                </p>
              </div>
            </Reorder.Item>
          ))}
        </Reorder.Group>
        <p className="mt-2 text-[10px] text-[var(--text-muted)]">
          Astuce : tu peux aussi utiliser le tab + flèche pour réordonner au clavier.
          Total {selected.length} clip{selected.length === 1 ? "" : "s"}.
        </p>
      </div>

      {/* Outro */}
      <TextCard
        eyebrow="Mot de fin"
        placeholder="Ex. — GG WP — KCKILLS"
        value={outroText}
        onChange={setOutroText}
        max={160}
        accent="gold"
      />
    </section>
  );
}

function TextCard({
  eyebrow,
  value,
  onChange,
  placeholder,
  max,
  accent,
}: {
  eyebrow: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  max: number;
  accent: "gold" | "cyan";
}) {
  const accentClass = accent === "cyan" ? "text-[var(--cyan)]" : "text-[var(--gold)]";
  return (
    <label
      className={`block rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/30 p-4 transition focus-within:border-[var(--gold)]/40`}
    >
      <span
        className={`mb-2 block text-[10px] uppercase tracking-[0.24em] ${accentClass}`}
      >
        {eyebrow} <span className="text-[var(--text-muted)]">(optionnel)</span>
      </span>
      <input
        type="text"
        value={value}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-base font-bold text-[var(--text-primary)] placeholder:text-[var(--text-disabled)] focus:outline-none"
      />
      <div className="mt-1 text-right text-[10px] text-[var(--text-muted)]">
        {value.length}/{max}
      </div>
    </label>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step 3 — Title / description
// ════════════════════════════════════════════════════════════════════

function TitleStep({
  titleInputId,
  descInputId,
  title,
  setTitle,
  description,
  setDescription,
  selected,
  submitError,
}: {
  titleInputId: string;
  descInputId: string;
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  selected: BuilderKill[];
  submitError: string | null;
}) {
  return (
    <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <h2 className="font-display text-xl font-black text-[var(--gold)]">
          Titre &amp; description
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Choisis un titre court et percutant — il s&apos;affichera sur la page de
          partage et dans les cartes Discord / Twitter.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label
              htmlFor={titleInputId}
              className="mb-1 block text-[10px] uppercase tracking-[0.24em] text-[var(--gold)]"
            >
              Titre <span className="text-[var(--text-muted)]">(obligatoire, 80 max)</span>
            </label>
            <input
              id={titleInputId}
              type="text"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Best of Caliste — Spring 2026"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 px-3 py-2 text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--gold)]/40 focus:outline-none"
              autoFocus
            />
            <p className="mt-1 text-right text-[10px] text-[var(--text-muted)]">
              {title.length}/80
            </p>
          </div>

          <div>
            <label
              htmlFor={descInputId}
              className="mb-1 block text-[10px] uppercase tracking-[0.24em] text-[var(--gold)]"
            >
              Description{" "}
              <span className="text-[var(--text-muted)]">(optionnelle, 400 max)</span>
            </label>
            <textarea
              id={descInputId}
              value={description}
              maxLength={400}
              rows={4}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Sa carrière en 5 minutes : du first Sumail à la finale Worlds."
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--gold)]/40 focus:outline-none"
            />
            <p className="mt-1 text-right text-[10px] text-[var(--text-muted)]">
              {description.length}/400
            </p>
          </div>

          {submitError ? (
            <div
              role="alert"
              className="rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-2 text-sm text-[var(--red)]"
            >
              {submitError}
            </div>
          ) : null}
        </div>
      </div>

      <aside className="hidden h-fit rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/40 p-4 lg:block">
        <h3 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-[var(--gold)]">
          Aperçu de la séquence
        </h3>
        <ol className="mt-3 space-y-2">
          {selected.map((k, i) => (
            <li key={k.id} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-[10px] text-[var(--gold)]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="truncate text-[var(--text-primary)]">
                {k.killerChampion} → {k.victimChampion}
              </span>
              {k.multiKill ? (
                <span className="rounded bg-[var(--red)]/20 px-1 text-[9px] uppercase text-[var(--red)]">
                  {k.multiKill}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[10px] text-[var(--text-muted)]">
          Le worker téléchargera chaque clip, les concaténera dans cet ordre et
          ajoutera ton intro/outro en surimpression.
        </p>
      </aside>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Step 4 — Success
// ════════════════════════════════════════════════════════════════════

function SuccessStep({
  shortCode,
  poll,
  clipCount,
}: {
  shortCode: string;
  poll: PollState | null;
  clipCount: number;
}) {
  const viewerPath = `/c/${shortCode}`;
  const fullUrl = typeof window !== "undefined" ? `${window.location.origin}${viewerPath}` : viewerPath;
  const status = poll?.status ?? "pending";

  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [fullUrl]);

  return (
    <section className="rounded-3xl border border-[var(--border-gold)] bg-gradient-to-br from-[var(--bg-elevated)]/40 to-[var(--bg-surface)]/30 p-6 sm:p-10">
      <div className="mx-auto max-w-2xl text-center">
        <p className="mb-2 text-[11px] uppercase tracking-[0.32em] text-[var(--gold)]">
          Compilation envoyée
        </p>
        <h2 className="font-display text-3xl font-black text-[var(--text-primary)] sm:text-4xl">
          Ton best-of est en cuisine.
        </h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          {clipCount} clips · rendu 1080p H.264 · environ 2 à 5 minutes selon la
          longueur totale.
        </p>

        {/* Short URL row */}
        <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row">
          <code className="flex-1 truncate rounded-lg border border-[var(--border-subtle)] bg-black/40 px-3 py-3 text-left font-mono text-sm text-[var(--gold-bright)]">
            {fullUrl}
          </code>
          <button
            type="button"
            onClick={copy}
            className="rounded-lg bg-[var(--gold)] px-4 py-3 text-sm font-bold text-black transition hover:bg-[var(--gold-bright)]"
          >
            {copied ? "Copié ✓" : "Copier"}
          </button>
        </div>

        {/* Status pill */}
        <StatusPill status={status} renderError={poll?.renderError ?? null} />

        {/* Actions */}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={viewerPath}
            className="rounded-lg border border-[var(--gold)]/40 px-4 py-2 text-sm font-bold text-[var(--gold)] transition hover:border-[var(--gold)] hover:bg-[var(--gold)]/10"
          >
            Ouvrir la page de partage →
          </Link>
          <Link
            href="/compilation"
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            Créer une autre compilation
          </Link>
        </div>
      </div>
    </section>
  );
}

function StatusPill({
  status,
  renderError,
}: {
  status: PollState["status"];
  renderError: string | null;
}) {
  const styles =
    status === "done"
      ? "border-[var(--green)]/40 bg-[var(--green)]/10 text-[var(--green)]"
      : status === "failed"
        ? "border-[var(--red)]/40 bg-[var(--red)]/10 text-[var(--red)]"
        : "border-[var(--cyan)]/40 bg-[var(--cyan)]/10 text-[var(--cyan)]";
  const label =
    status === "done"
      ? "Rendu terminé — prêt à partager"
      : status === "failed"
        ? "Échec du rendu"
        : status === "rendering"
          ? "Rendu en cours — patiente quelques minutes"
          : "En file d'attente — démarrage imminent";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-6 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs ${styles}`}
    >
      {status === "done" ? (
        <span aria-hidden>✓</span>
      ) : status === "failed" ? (
        <span aria-hidden>✕</span>
      ) : (
        <span aria-hidden className="inline-block size-1.5 animate-pulse rounded-full bg-current" />
      )}
      <span>{label}</span>
      {renderError ? (
        <span className="ml-2 text-[var(--text-muted)]">— {renderError}</span>
      ) : null}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Sticky bottom action bar (mobile-friendly)
// ════════════════════════════════════════════════════════════════════

function StickyBar({
  left,
  right,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div className="sticky bottom-0 z-30 mt-8 -mx-4 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[var(--bg-primary)]/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        {left}
        {right}
      </div>
    </div>
  );
}
