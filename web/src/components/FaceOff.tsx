"use client";

/**
 * FaceOff — Player vs Player face-off client surface.
 *
 * Two modes :
 *   1. Selector intro screen (no players yet, or invalid slugs)
 *      — two dropdowns (gauche / droite), preset duel chips, DUEL button.
 *   2. Face-off result page (both players present)
 *      — Versus card with portraits sliding in
 *      — Stats comparison (9 metrics, scroll-driven bar fill)
 *      — Side-by-side top 10 kills (mobile : accordion toggle)
 *      — Community vote (3 buttons) wired to fn_record_face_off_vote
 *      — Popular duels footer.
 *
 * The data layer lives in `lib/supabase/face-off.ts` — this component
 * is a pure UI wrapper around the props the RSC fetches.
 *
 * Visual identity :
 *   - Side A : --gold (warm, lead colour of the site)
 *   - Side B : --cyan (Hextech blue, complementary)
 *   - Crown badge on the metric winner, gold border + glow
 *   - Mobile : columns stack, top 10 kills become accordion swap
 *
 * Accessibility :
 *   - All buttons have aria-label
 *   - prefers-reduced-motion : skip portrait slide-in, snap bars
 *   - Keyboard nav on the selector + vote buttons
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { m, useInView, useReducedMotion } from "motion/react";

import { createClient } from "@/lib/supabase/client";
import type {
  FaceOffPlayerStats,
  FaceOffTally,
  FaceOffTopKill,
  MostKilledOpponent,
  TopFaceOffDuel,
} from "@/lib/supabase/face-off-types";

// ════════════════════════════════════════════════════════════════════
// Public props
// ════════════════════════════════════════════════════════════════════

export interface FaceOffPlayerOption {
  /** URL slug — lower-cased ign, matches /player/[slug]. */
  slug: string;
  /** Display name. */
  name: string;
  /** "Roster 2026" / "Alumni · 2022" / etc. */
  era: string;
  /** "top" / "jungle" / etc. */
  role: string | null;
  /** Photo URL or null (falls back to champion splash). */
  photoUrl: string | null;
  /** Champion to fall back to when no photo. */
  signatureChampion: string;
  /** True if this is an active 2026 KC player. */
  isCurrent: boolean;
}

export interface FaceOffPresetDuel {
  aSlug: string;
  bSlug: string;
  label: string;
  subtitle?: string;
}

export interface FaceOffBundle {
  player: FaceOffPlayerOption;
  stats: FaceOffPlayerStats;
  topKills: FaceOffTopKill[];
  mostKilled: MostKilledOpponent | null;
  mostVictimizedBy: MostKilledOpponent | null;
}

export interface FaceOffProps {
  players: FaceOffPlayerOption[];
  presets: FaceOffPresetDuel[];
  /** When NULL, render the selector screen. */
  bundleA: FaceOffBundle | null;
  bundleB: FaceOffBundle | null;
  initialTally: FaceOffTally;
  topDuels: TopFaceOffDuel[];
  playersBySlug: Record<string, FaceOffPlayerOption>;
}

// ════════════════════════════════════════════════════════════════════
// Session hash (vote dedup) — same pattern as vs-roulette.ts
// ════════════════════════════════════════════════════════════════════

const FACE_OFF_SESSION_KEY = "kckills_face_off_session_id";

function getFaceOffSessionHash(): string {
  if (typeof window === "undefined") return "fo-ssr-placeholder-hash";
  try {
    const existing = window.localStorage.getItem(FACE_OFF_SESSION_KEY);
    if (existing && existing.length >= 16) return existing;
    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    const fresh = `fo-${hex}`;
    window.localStorage.setItem(FACE_OFF_SESSION_KEY, fresh);
    return fresh;
  } catch {
    return `fo-${Math.random().toString(16).slice(2).padStart(16, "0")}`;
  }
}

// ════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════

const ROLE_LABEL: Record<string, string> = {
  top: "TOP",
  jungle: "JGL",
  mid: "MID",
  bottom: "ADC",
  adc: "ADC",
  support: "SUP",
};

function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return ROLE_LABEL[role.toLowerCase()] ?? role.toUpperCase();
}

function formatNumber(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatScore(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toFixed(1);
}

// ════════════════════════════════════════════════════════════════════
// Root component
// ════════════════════════════════════════════════════════════════════

export function FaceOff(props: FaceOffProps) {
  const { bundleA, bundleB } = props;

  if (!bundleA || !bundleB) {
    return <FaceOffSelector {...props} />;
  }

  return <FaceOffResult {...props} bundleA={bundleA} bundleB={bundleB} />;
}

// ════════════════════════════════════════════════════════════════════
// Selector intro screen
// ════════════════════════════════════════════════════════════════════

function FaceOffSelector({ players, presets }: FaceOffProps) {
  const router = useRouter();
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const [queryA, setQueryA] = useState("");
  const [queryB, setQueryB] = useState("");

  const filteredA = useMemo(() => {
    const q = queryA.trim().toLowerCase();
    if (!q) return players;
    return players.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.role?.toLowerCase().includes(q) ||
        p.era.toLowerCase().includes(q),
    );
  }, [queryA, players]);

  const filteredB = useMemo(() => {
    const q = queryB.trim().toLowerCase();
    if (!q) return players;
    return players.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.role?.toLowerCase().includes(q) ||
        p.era.toLowerCase().includes(q),
    );
  }, [queryB, players]);

  const ready = a && b && a !== b;

  const launch = useCallback(
    (aSlug: string, bSlug: string) => {
      if (!aSlug || !bSlug || aSlug === bSlug) return;
      const params = new URLSearchParams();
      params.set("a", aSlug);
      params.set("b", bSlug);
      router.push(`/face-off?${params.toString()}`);
    },
    [router],
  );

  return (
    <section className="mx-auto max-w-6xl px-4 py-10 md:py-16">
      {/* Picker headline */}
      <div className="text-center mb-8 md:mb-12">
        <p className="font-data text-[11px] uppercase tracking-[0.4em] text-[var(--gold)]/70 mb-3">
          Le duel ultime · Settle the debate
        </p>
        <h2
          className="font-display font-black tracking-tight text-3xl md:text-5xl text-[var(--text-primary)]"
          style={{ letterSpacing: "-0.01em" }}
        >
          Choisis tes deux joueurs
        </h2>
        <p className="mt-3 text-sm md:text-base text-white/65 max-w-xl mx-auto">
          Compare les stats, les meilleurs kills, et fais voter la
          communauté. Roster 2026 ou alumni — tout est sur la table.
        </p>
      </div>

      {/* Two dropdowns */}
      <div className="grid gap-6 md:grid-cols-[1fr_auto_1fr] items-stretch">
        <SelectorColumn
          accent="var(--gold)"
          sideLabel="Gauche"
          value={a}
          setValue={(slug) => {
            setA(slug);
            const found = players.find((p) => p.slug === slug);
            if (found) setQueryA(found.name);
          }}
          query={queryA}
          setQuery={setQueryA}
          options={filteredA}
          disallowed={b}
        />
        <div className="hidden md:flex items-center justify-center">
          <div
            className="font-display font-black text-3xl text-[var(--gold)]"
            style={{ textShadow: "0 0 22px rgba(200,170,110,0.5)" }}
          >
            VS
          </div>
        </div>
        <SelectorColumn
          accent="var(--cyan)"
          sideLabel="Droite"
          value={b}
          setValue={(slug) => {
            setB(slug);
            const found = players.find((p) => p.slug === slug);
            if (found) setQueryB(found.name);
          }}
          query={queryB}
          setQuery={setQueryB}
          options={filteredB}
          disallowed={a}
        />
      </div>

      {/* DUEL button */}
      <div className="mt-8 md:mt-10 flex justify-center">
        <button
          type="button"
          onClick={() => launch(a, b)}
          disabled={!ready}
          aria-label="Lancer le duel"
          className="relative group inline-flex items-center justify-center font-display text-base font-black uppercase tracking-[0.3em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] disabled:cursor-not-allowed disabled:opacity-60"
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
          Lancer le duel
        </button>
      </div>

      {/* Preset duels */}
      <div className="mt-10 md:mt-14">
        <div className="flex items-center gap-3 mb-4">
          <span className="h-px w-12 bg-[var(--gold)]" />
          <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
            Duels suggérés
          </span>
          <span className="text-[var(--gold)]/40 text-xs" aria-hidden>
            ◆
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {presets.map((p) => (
            <PresetCard
              key={`${p.aSlug}-${p.bSlug}`}
              preset={p}
              onClick={() => launch(p.aSlug, p.bSlug)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function SelectorColumn({
  accent,
  sideLabel,
  value,
  setValue,
  query,
  setQuery,
  options,
  disallowed,
}: {
  accent: string;
  sideLabel: string;
  value: string;
  setValue: (slug: string) => void;
  query: string;
  setQuery: (q: string) => void;
  options: FaceOffPlayerOption[];
  disallowed: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative rounded-2xl border bg-[var(--bg-surface)]/70 backdrop-blur-md p-5"
      style={{
        borderColor: `${accent}33`,
        boxShadow: `0 18px 40px rgba(0,0,0,0.45), inset 0 0 0 1px ${accent}10`,
      }}
    >
      <p
        className="font-data text-[10px] uppercase tracking-[0.3em] mb-3"
        style={{ color: accent }}
      >
        {sideLabel}
      </p>
      <label className="block">
        <span className="sr-only">Joueur {sideLabel}</span>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Reset selection when the typed text no longer matches the
            // current pick — prevents stale value invisible to the user.
            if (value) {
              const cur = options.find((p) => p.slug === value);
              if (!cur || !cur.name.toLowerCase().includes(e.target.value.toLowerCase())) {
                setValue("");
              }
            }
          }}
          onFocus={() => setOpen(true)}
          placeholder="Tape un nom ou un rôle…"
          aria-label={`Rechercher joueur ${sideLabel}`}
          className="w-full rounded-xl bg-black/40 border border-white/15 px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-white/35 focus:outline-none focus:border-[var(--gold)]/60 focus:ring-2 focus:ring-[var(--gold)]/20 transition-colors"
        />
      </label>

      {open && options.length > 0 && (
        <ul
          role="listbox"
          aria-label={`Suggestions ${sideLabel}`}
          className="absolute left-5 right-5 z-30 mt-2 max-h-72 overflow-auto rounded-xl border border-white/15 bg-[var(--bg-elevated)]/95 backdrop-blur-md shadow-2xl"
        >
          {options.map((p) => {
            const blocked = p.slug === disallowed;
            return (
              <li key={p.slug} role="option" aria-selected={value === p.slug}>
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    if (blocked) return;
                    setValue(p.slug);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <span
                    aria-hidden
                    className="inline-block flex-shrink-0 rounded-full overflow-hidden border border-white/15 bg-black/40"
                    style={{ width: 32, height: 32 }}
                  >
                    {p.photoUrl ? (
                      <Image
                        src={p.photoUrl}
                        alt=""
                        width={32}
                        height={32}
                        className="object-cover h-full w-full"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-sm font-bold text-[var(--text-primary)] truncate">
                      {p.name}
                    </span>
                    <span className="block font-data text-[10px] uppercase tracking-widest text-white/45 truncate">
                      {roleLabel(p.role)} · {p.era}
                    </span>
                  </span>
                  {blocked && (
                    <span className="font-data text-[9px] uppercase tracking-widest text-[var(--red)]/80">
                      Déjà choisi
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {value && (
        <p className="mt-3 font-data text-[10px] uppercase tracking-widest text-white/55">
          Sélectionné :{" "}
          <span style={{ color: accent }} className="font-bold">
            {options.find((p) => p.slug === value)?.name ?? value}
          </span>
        </p>
      )}
    </div>
  );
}

function PresetCard({
  preset,
  onClick,
}: {
  preset: FaceOffPresetDuel;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Lancer le duel ${preset.label}`}
      className="group relative overflow-hidden rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/60 px-4 py-4 text-left transition-all hover:border-[var(--gold)]/60 hover:bg-[var(--bg-surface)] hover:-translate-y-0.5"
      style={{
        boxShadow: "0 10px 26px rgba(0,0,0,0.35)",
      }}
    >
      <p className="font-display text-sm font-black text-[var(--text-primary)] leading-tight">
        {preset.label}
      </p>
      {preset.subtitle && (
        <p className="mt-1 font-data text-[10px] uppercase tracking-widest text-white/45">
          {preset.subtitle}
        </p>
      )}
      <span
        aria-hidden
        className="absolute top-3 right-3 text-[var(--gold)]/40 text-xs group-hover:text-[var(--gold)] transition-colors"
      >
        ◆
      </span>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════
// Result page
// ════════════════════════════════════════════════════════════════════

function FaceOffResult({
  bundleA,
  bundleB,
  initialTally,
  topDuels,
  playersBySlug,
}: FaceOffProps & { bundleA: FaceOffBundle; bundleB: FaceOffBundle }) {
  const prefersReducedMotion = useReducedMotion() ?? false;

  // ─── Vote state ─────────────────────────────────────────────────
  const [tally, setTally] = useState<FaceOffTally>(initialTally);
  const [voting, setVoting] = useState(false);
  const [votedChoice, setVotedChoice] = useState<"a" | "b" | "tie" | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  const sessionHashRef = useRef<string>("fo-ssr-placeholder");

  useEffect(() => {
    sessionHashRef.current = getFaceOffSessionHash();
  }, []);

  const castVote = useCallback(
    async (choice: "a" | "b" | "tie") => {
      if (voting) return;
      setVoting(true);
      setVoteError(null);
      const sb = createClient();
      const winner = choice === "a" ? bundleA.player.slug : choice === "b" ? bundleB.player.slug : null;
      try {
        const { data, error } = await sb.rpc("fn_record_face_off_vote", {
          p_a_slug: bundleA.player.slug,
          p_b_slug: bundleB.player.slug,
          p_winner_slug: winner,
          p_session_hash: sessionHashRef.current,
        });
        if (error) {
          setVoteError(error.message);
        } else {
          const rows = Array.isArray(data) ? data : [];
          const row = rows[0] as
            | { votes_a: number; votes_b: number; votes_draw: number; inserted: boolean }
            | undefined;
          if (row) {
            setTally({
              votes_a: row.votes_a,
              votes_b: row.votes_b,
              votes_draw: row.votes_draw,
            });
          }
          setVotedChoice(choice);
        }
      } catch (err) {
        setVoteError(err instanceof Error ? err.message : "Erreur réseau");
      } finally {
        setVoting(false);
      }
    },
    [bundleA, bundleB, voting],
  );

  // ─── Share / copy URL ──────────────────────────────────────────
  const [shared, setShared] = useState(false);
  const onShare = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${bundleA.player.name} vs ${bundleB.player.name} — KCKILLS`,
          text: `Qui est le meilleur ? ${bundleA.player.name} ou ${bundleB.player.name} ?`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        window.setTimeout(() => setShared(false), 2000);
      }
    } catch {
      // Cancelled by user, ignore
    }
  }, [bundleA, bundleB]);

  return (
    <div className="mx-auto max-w-7xl px-3 md:px-6 pb-16">
      {/* ─── Versus card ─────────────────────────────────────────── */}
      <VersusCard
        bundleA={bundleA}
        bundleB={bundleB}
        prefersReducedMotion={prefersReducedMotion}
        onShare={onShare}
        shared={shared}
      />

      {/* ─── Stats comparison ────────────────────────────────────── */}
      <StatsComparison
        bundleA={bundleA}
        bundleB={bundleB}
        prefersReducedMotion={prefersReducedMotion}
      />

      {/* ─── Side-by-side top 10 kills ───────────────────────────── */}
      <TopKillsGrid bundleA={bundleA} bundleB={bundleB} />

      {/* ─── Community vote ──────────────────────────────────────── */}
      <CommunityVote
        bundleA={bundleA}
        bundleB={bundleB}
        tally={tally}
        votedChoice={votedChoice}
        voting={voting}
        voteError={voteError}
        onVote={castVote}
        prefersReducedMotion={prefersReducedMotion}
      />

      {/* ─── Popular duels footer ────────────────────────────────── */}
      <PopularDuelsFooter
        duels={topDuels}
        playersBySlug={playersBySlug}
        currentA={bundleA.player.slug}
        currentB={bundleB.player.slug}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Versus card
// ════════════════════════════════════════════════════════════════════

function VersusCard({
  bundleA,
  bundleB,
  prefersReducedMotion,
  onShare,
  shared,
}: {
  bundleA: FaceOffBundle;
  bundleB: FaceOffBundle;
  prefersReducedMotion: boolean;
  onShare: () => void;
  shared: boolean;
}) {
  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/60 backdrop-blur-md mt-4 mb-10 md:mb-14"
      style={{
        boxShadow:
          "0 24px 60px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(200,170,110,0.06)",
      }}
      aria-labelledby="face-off-headline"
    >
      {/* Background gradient halves */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, rgba(200,170,110,0.18) 0%, rgba(200,170,110,0.05) 35%, transparent 50%, rgba(10,200,185,0.05) 65%, rgba(10,200,185,0.18) 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(200,170,110,0.5) 15%, transparent 50%, rgba(10,200,185,0.5) 85%, transparent 100%)",
        }}
      />

      <div className="relative grid gap-3 md:grid-cols-[1fr_auto_1fr] items-stretch p-6 md:p-10">
        <FaceCard
          bundle={bundleA}
          side="left"
          accent="var(--gold)"
          prefersReducedMotion={prefersReducedMotion}
        />
        <div className="flex md:flex-col items-center justify-center gap-3 md:gap-4 py-2 md:py-0">
          <div
            aria-hidden
            className="hidden md:block w-px h-24"
            style={{
              background:
                "linear-gradient(180deg, transparent, rgba(200,170,110,0.6), transparent)",
            }}
          />
          <m.div
            initial={prefersReducedMotion ? false : { scale: 0, rotate: 0, opacity: 0 }}
            animate={{ scale: 1, rotate: 45, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.35 }}
            className="relative"
            style={{
              width: 56,
              height: 56,
              background:
                "linear-gradient(135deg, var(--gold-bright), var(--gold) 60%, var(--gold-dark))",
              boxShadow:
                "0 18px 36px rgba(0,0,0,0.5), 0 0 30px rgba(200,170,110,0.55), inset 0 1px 0 rgba(255,255,255,0.6)",
            }}
          >
            <span
              className="absolute inset-0 flex items-center justify-center font-display font-black text-base text-[var(--bg-primary)]"
              style={{ transform: "rotate(-45deg)", letterSpacing: "0.04em" }}
            >
              VS
            </span>
          </m.div>
          <div
            aria-hidden
            className="hidden md:block w-px h-24"
            style={{
              background:
                "linear-gradient(180deg, transparent, rgba(10,200,185,0.6), transparent)",
            }}
          />
        </div>
        <FaceCard
          bundle={bundleB}
          side="right"
          accent="var(--cyan)"
          prefersReducedMotion={prefersReducedMotion}
        />
      </div>

      {/* Share button — bottom of the card */}
      <div className="relative pb-6 md:pb-8 flex justify-center">
        <button
          type="button"
          onClick={onShare}
          aria-label="Partager ce duel"
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-gold)] bg-black/30 px-5 py-2.5 font-display text-xs font-bold uppercase tracking-[0.25em] text-[var(--gold)] hover:border-[var(--gold)]/70 hover:bg-[var(--gold)]/10 transition-all"
        >
          <span aria-hidden>{shared ? "✓" : "◆"}</span>
          {shared ? "Lien copié" : "Partager ce duel"}
        </button>
      </div>

      <h2 id="face-off-headline" className="sr-only">
        {bundleA.player.name} vs {bundleB.player.name}
      </h2>
    </section>
  );
}

function FaceCard({
  bundle,
  side,
  accent,
  prefersReducedMotion,
}: {
  bundle: FaceOffBundle;
  side: "left" | "right";
  accent: string;
  prefersReducedMotion: boolean;
}) {
  const portraitX = side === "left" ? -120 : 120;
  return (
    <m.div
      initial={prefersReducedMotion ? false : { opacity: 0, x: portraitX }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex flex-col items-center text-center"
    >
      {/* Portrait */}
      <div
        className="relative rounded-2xl overflow-hidden mb-4"
        style={{
          width: "min(72vw, 240px)",
          aspectRatio: "1 / 1",
          border: `2px solid ${accent}`,
          boxShadow: `0 18px 40px rgba(0,0,0,0.5), 0 0 60px ${accent}45`,
        }}
      >
        {bundle.player.photoUrl ? (
          <Image
            src={bundle.player.photoUrl}
            alt={bundle.player.name}
            fill
            sizes="(max-width: 768px) 70vw, 240px"
            className="object-cover"
            priority
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[var(--bg-elevated)] to-black text-white/30 font-display text-3xl">
            {bundle.player.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        {/* Era stripe */}
        <span
          className="absolute top-2 left-2 rounded-md px-2 py-1 text-[9px] uppercase tracking-widest font-data font-bold"
          style={{
            color: accent,
            backgroundColor: "rgba(0,0,0,0.55)",
            border: `1px solid ${accent}50`,
            backdropFilter: "blur(6px)",
          }}
        >
          {bundle.player.era}
        </span>
      </div>

      {/* Name */}
      <p
        className="font-display font-black tracking-tight text-3xl md:text-5xl text-[var(--text-primary)] leading-none"
        style={{ textShadow: "0 4px 18px rgba(0,0,0,0.6)" }}
      >
        {bundle.player.name}
      </p>
      <p
        className="mt-2 font-data text-[10px] uppercase tracking-[0.3em]"
        style={{ color: accent }}
      >
        {roleLabel(bundle.player.role)} · Karmine Corp
      </p>

      {/* Quick stat strip */}
      <div className="mt-5 grid grid-cols-3 gap-2 w-full max-w-xs">
        <FaceStat label="Kills" value={formatNumber(bundle.stats.totalKills)} accent={accent} />
        <FaceStat label="Clips" value={formatNumber(bundle.stats.publishedClipCount)} accent={accent} />
        <FaceStat label="Best" value={formatScore(bundle.stats.bestClipScore)} accent={accent} />
      </div>
    </m.div>
  );
}

function FaceStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div
      className="rounded-lg bg-black/30 px-2 py-2 text-center"
      style={{ border: `1px solid ${accent}25` }}
    >
      <p className="font-data text-[8.5px] uppercase tracking-[0.25em] text-white/45">
        {label}
      </p>
      <p className="font-display text-lg font-black text-white">{value}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Stats comparison — bars with scroll-driven fill + winner crown
// ════════════════════════════════════════════════════════════════════

interface MetricDef {
  key: string;
  label: string;
  sublabel?: string;
  value: (b: FaceOffBundle) => number;
  format: (n: number) => string;
  /** True = higher is better (default). False = lower is better. */
  higherIsBetter?: boolean;
}

const METRICS: MetricDef[] = [
  {
    key: "kills",
    label: "Total kills tracked",
    value: (b) => b.stats.totalKills,
    format: (n) => formatNumber(n),
  },
  {
    key: "deaths",
    label: "Total deaths tracked",
    sublabel: "Plus bas = mieux",
    value: (b) => b.stats.totalDeaths,
    format: (n) => formatNumber(n),
    higherIsBetter: false,
  },
  {
    key: "multi",
    label: "Multi-kills (triple+)",
    value: (b) => b.stats.multiKillCount,
    format: (n) => formatNumber(n),
  },
  {
    key: "fb",
    label: "First bloods",
    value: (b) => b.stats.firstBloods,
    format: (n) => formatNumber(n),
  },
  {
    key: "highlight",
    label: "Avg highlight score IA",
    sublabel: "Gemini · 0-10",
    value: (b) => b.stats.avgHighlightScore,
    format: (n) => formatScore(n),
  },
  {
    key: "community",
    label: "Avg note communauté",
    sublabel: "0-5",
    value: (b) => b.stats.avgCommunityRating,
    format: (n) => formatScore(n),
  },
  {
    key: "best",
    label: "Meilleur clip",
    sublabel: "Highlight score max",
    value: (b) => b.stats.bestClipScore,
    format: (n) => formatScore(n),
  },
  {
    key: "champions",
    label: "Diversité champions",
    sublabel: "Champions distincts",
    value: (b) => b.stats.championsCount,
    format: (n) => formatNumber(n),
  },
  {
    key: "clips",
    label: "Clips publiés",
    value: (b) => b.stats.publishedClipCount,
    format: (n) => formatNumber(n),
  },
];

function StatsComparison({
  bundleA,
  bundleB,
  prefersReducedMotion,
}: {
  bundleA: FaceOffBundle;
  bundleB: FaceOffBundle;
  prefersReducedMotion: boolean;
}) {
  return (
    <section className="mb-12 md:mb-16" aria-labelledby="face-off-stats">
      <SectionHeader id="face-off-stats" kicker="Stats comparées" />
      <div className="grid gap-3 md:gap-4">
        {METRICS.map((metric) => (
          <StatRow
            key={metric.key}
            metric={metric}
            bundleA={bundleA}
            bundleB={bundleB}
            prefersReducedMotion={prefersReducedMotion}
          />
        ))}
        {/* Most killed / most-killed-by — non-bar rows */}
        <MatchupRow
          label="Vict ime préférée"
          subA={bundleA.mostKilled}
          subB={bundleB.mostKilled}
          mode="killer"
        />
        <MatchupRow
          label="Bête noire"
          subA={bundleA.mostVictimizedBy}
          subB={bundleB.mostVictimizedBy}
          mode="victim"
        />
      </div>
    </section>
  );
}

function StatRow({
  metric,
  bundleA,
  bundleB,
  prefersReducedMotion,
}: {
  metric: MetricDef;
  bundleA: FaceOffBundle;
  bundleB: FaceOffBundle;
  prefersReducedMotion: boolean;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rowRef, { once: true, amount: 0.4 });

  const vA = metric.value(bundleA);
  const vB = metric.value(bundleB);
  const higherIsBetter = metric.higherIsBetter !== false;

  const winner: "a" | "b" | "tie" =
    vA === vB
      ? "tie"
      : higherIsBetter
        ? vA > vB
          ? "a"
          : "b"
        : vA < vB
          ? "a"
          : "b";

  // Bar fill : we want the BIGGER value to fill 100%, the smaller proportional.
  // For "lower is better" metrics we invert the visual cue : the winning side
  // still gets the crown but the BAR length still reflects raw magnitude
  // so the comparison reads naturally.
  const max = Math.max(vA, vB, 1);
  const pctA = (vA / max) * 100;
  const pctB = (vB / max) * 100;

  return (
    <div
      ref={rowRef}
      className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/55 backdrop-blur-md p-4 md:p-5"
    >
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <p className="font-display text-sm md:text-base font-bold text-[var(--text-primary)] leading-tight">
          {metric.label}
        </p>
        {metric.sublabel && (
          <span className="font-data text-[9px] uppercase tracking-[0.25em] text-white/40">
            {metric.sublabel}
          </span>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr] items-center">
        <Bar
          accent="var(--gold)"
          align="right"
          pct={pctA}
          value={metric.format(vA)}
          winner={winner === "a"}
          inView={inView}
          prefersReducedMotion={prefersReducedMotion}
          name={bundleA.player.name}
        />
        <span
          aria-hidden
          className="hidden md:inline-block font-data text-[10px] uppercase tracking-widest text-white/35 text-center px-2"
        >
          vs
        </span>
        <Bar
          accent="var(--cyan)"
          align="left"
          pct={pctB}
          value={metric.format(vB)}
          winner={winner === "b"}
          inView={inView}
          prefersReducedMotion={prefersReducedMotion}
          name={bundleB.player.name}
        />
      </div>
    </div>
  );
}

function Bar({
  accent,
  align,
  pct,
  value,
  winner,
  inView,
  prefersReducedMotion,
  name,
}: {
  accent: string;
  align: "left" | "right";
  pct: number;
  value: string;
  winner: boolean;
  inView: boolean;
  prefersReducedMotion: boolean;
  name: string;
}) {
  const fillAnim = prefersReducedMotion
    ? { width: `${pct}%` }
    : { width: inView ? `${pct}%` : "0%" };

  const justify = align === "right" ? "justify-end" : "justify-start";
  const flexDir = align === "right" ? "flex-row" : "flex-row-reverse";

  return (
    <div className="space-y-1">
      <div
        className={`flex items-center ${justify} gap-2 text-[10px] uppercase tracking-widest font-data text-white/45`}
      >
        {winner && (
          <span
            className="inline-flex items-center gap-1 font-bold"
            style={{ color: accent }}
            aria-label={`${name} gagne cette mesure`}
          >
            <span aria-hidden>♛</span>
            <span>Gagnant</span>
          </span>
        )}
        <span className="truncate" style={{ color: accent }}>
          {name}
        </span>
      </div>
      <div
        className={`flex items-center ${flexDir} gap-3`}
        style={{ flexWrap: "nowrap" }}
      >
        <span
          className="font-display text-2xl md:text-3xl font-black flex-shrink-0"
          style={{ color: winner ? "var(--gold-bright)" : "var(--text-primary)" }}
        >
          {value}
        </span>
        <div
          className="relative flex-1 rounded-full overflow-hidden bg-black/40"
          style={{
            height: 12,
            boxShadow: "inset 0 1px 0 rgba(0,0,0,0.4)",
          }}
        >
          <m.div
            initial={prefersReducedMotion ? false : { width: 0 }}
            animate={fillAnim}
            transition={{
              duration: prefersReducedMotion ? 0 : 0.9,
              ease: [0.16, 1, 0.3, 1],
              delay: prefersReducedMotion ? 0 : 0.1,
            }}
            className={`absolute top-0 ${
              align === "right" ? "right-0" : "left-0"
            } h-full rounded-full`}
            style={{
              background:
                align === "right"
                  ? `linear-gradient(270deg, ${accent} 0%, ${accent}80 100%)`
                  : `linear-gradient(90deg, ${accent} 0%, ${accent}80 100%)`,
              boxShadow: winner
                ? `0 0 18px ${accent}, inset 0 1px 0 rgba(255,255,255,0.3)`
                : `0 0 8px ${accent}50, inset 0 1px 0 rgba(255,255,255,0.2)`,
              border: winner ? `1px solid ${accent}` : "1px solid transparent",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function MatchupRow({
  label,
  subA,
  subB,
  mode,
}: {
  label: string;
  subA: MostKilledOpponent | null;
  subB: MostKilledOpponent | null;
  mode: "killer" | "victim";
}) {
  // mode is "killer" when subA represents the OPPONENT this side killed
  // most, "victim" when subA represents the OPPONENT who killed this side
  // most. The label tells the user which one ; we just render.
  void mode;
  return (
    <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/55 backdrop-blur-md p-4 md:p-5">
      <p className="font-display text-sm md:text-base font-bold text-[var(--text-primary)] mb-3 leading-tight">
        {label}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <OpponentChip opponent={subA} accent="var(--gold)" />
        <OpponentChip opponent={subB} accent="var(--cyan)" />
      </div>
    </div>
  );
}

function OpponentChip({
  opponent,
  accent,
}: {
  opponent: MostKilledOpponent | null;
  accent: string;
}) {
  if (!opponent) {
    return (
      <div
        className="rounded-xl border bg-black/25 px-4 py-3 font-data text-xs uppercase tracking-widest text-white/40"
        style={{ borderColor: `${accent}25` }}
      >
        Pas de données
      </div>
    );
  }
  return (
    <div
      className="rounded-xl border bg-black/30 px-4 py-3 flex items-center justify-between gap-3"
      style={{ borderColor: `${accent}35` }}
    >
      <div className="min-w-0 flex-1">
        <p
          className="font-display text-base font-black truncate"
          style={{ color: accent }}
        >
          {opponent.victim_ign}
        </p>
        <p className="font-data text-[10px] uppercase tracking-widest text-white/45 truncate">
          {opponent.victim_champion ?? "—"}
        </p>
      </div>
      <span
        className="font-display text-2xl font-black"
        style={{ color: "var(--text-primary)" }}
      >
        ×{opponent.count}
      </span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Top kills grid — side-by-side, accordion on mobile
// ════════════════════════════════════════════════════════════════════

function TopKillsGrid({
  bundleA,
  bundleB,
}: {
  bundleA: FaceOffBundle;
  bundleB: FaceOffBundle;
}) {
  const [mobileSide, setMobileSide] = useState<"a" | "b">("a");

  return (
    <section className="mb-12 md:mb-16" aria-labelledby="face-off-top-kills">
      <SectionHeader id="face-off-top-kills" kicker="Top 10 kills" />

      {/* Mobile toggle */}
      <div
        className="md:hidden mb-4 flex rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/70 backdrop-blur-md p-1"
        role="tablist"
        aria-label="Sélectionner le joueur"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mobileSide === "a"}
          onClick={() => setMobileSide("a")}
          className={`flex-1 rounded-lg px-3 py-2 font-display text-xs font-black uppercase tracking-widest transition-colors ${
            mobileSide === "a"
              ? "bg-[var(--gold)] text-[var(--bg-primary)]"
              : "text-[var(--gold)]/70"
          }`}
        >
          {bundleA.player.name}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileSide === "b"}
          onClick={() => setMobileSide("b")}
          className={`flex-1 rounded-lg px-3 py-2 font-display text-xs font-black uppercase tracking-widest transition-colors ${
            mobileSide === "b"
              ? "bg-[var(--cyan)] text-[var(--bg-primary)]"
              : "text-[var(--cyan)]/70"
          }`}
        >
          {bundleB.player.name}
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <TopKillsColumn
          bundle={bundleA}
          accent="var(--gold)"
          className={mobileSide === "a" ? "block" : "hidden md:block"}
        />
        <TopKillsColumn
          bundle={bundleB}
          accent="var(--cyan)"
          className={mobileSide === "b" ? "block" : "hidden md:block"}
        />
      </div>
    </section>
  );
}

function TopKillsColumn({
  bundle,
  accent,
  className,
}: {
  bundle: FaceOffBundle;
  accent: string;
  className?: string;
}) {
  if (bundle.topKills.length === 0) {
    return (
      <div
        className={`${className ?? ""} rounded-2xl border bg-[var(--bg-surface)]/55 p-8 text-center font-data text-xs uppercase tracking-widest text-white/40`}
        style={{ borderColor: `${accent}25` }}
      >
        Pas encore de clips publiés pour {bundle.player.name}.
      </div>
    );
  }
  return (
    <div className={`${className ?? ""} space-y-3`}>
      <div className="flex items-center gap-2 mb-3">
        <span
          className="inline-block rounded-full"
          style={{
            width: 8,
            height: 8,
            backgroundColor: accent,
            boxShadow: `0 0 12px ${accent}`,
          }}
        />
        <p className="font-display text-sm font-black uppercase tracking-widest" style={{ color: accent }}>
          {bundle.player.name}
        </p>
      </div>
      {bundle.topKills.map((kill, idx) => (
        <KillCardRow key={kill.id} kill={kill} rank={idx + 1} accent={accent} />
      ))}
    </div>
  );
}

function KillCardRow({
  kill,
  rank,
  accent,
}: {
  kill: FaceOffTopKill;
  rank: number;
  accent: string;
}) {
  return (
    <Link
      href={`/kill/${kill.id}`}
      className="group relative flex items-stretch gap-3 rounded-xl border bg-[var(--bg-surface)] overflow-hidden transition-all hover:border-[var(--gold)]/60 hover:-translate-y-0.5"
      style={{
        borderColor: `${accent}30`,
        boxShadow: `0 10px 24px rgba(0,0,0,0.35)`,
      }}
    >
      {/* Rank chip */}
      <div
        aria-hidden
        className="flex-shrink-0 flex items-center justify-center font-display text-2xl font-black"
        style={{
          width: 48,
          color: accent,
          background: `linear-gradient(135deg, rgba(0,0,0,0.4), ${accent}10)`,
        }}
      >
        {rank.toString().padStart(2, "0")}
      </div>
      {/* Thumbnail */}
      <div
        className="relative flex-shrink-0 overflow-hidden bg-black"
        style={{ width: 64, aspectRatio: "9 / 16" }}
      >
        {kill.thumbnail_url ? (
          <Image
            src={kill.thumbnail_url}
            alt=""
            fill
            sizes="64px"
            className="object-cover group-hover:scale-105 transition-transform"
          />
        ) : null}
      </div>
      {/* Info */}
      <div className="flex-1 min-w-0 py-2 pr-3">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          {kill.multi_kill && (
            <span
              className="rounded px-1.5 py-0.5 text-[8.5px] font-data font-bold uppercase tracking-widest"
              style={{
                color: "var(--orange)",
                backgroundColor: "rgba(255,152,0,0.12)",
                border: "1px solid rgba(255,152,0,0.35)",
              }}
            >
              {kill.multi_kill}
            </span>
          )}
          {kill.is_first_blood && (
            <span
              className="rounded px-1.5 py-0.5 text-[8.5px] font-data font-bold uppercase tracking-widest"
              style={{
                color: "var(--red)",
                backgroundColor: "rgba(232,64,87,0.12)",
                border: "1px solid rgba(232,64,87,0.35)",
              }}
            >
              FB
            </span>
          )}
          {kill.match_stage && (
            <span className="rounded px-1.5 py-0.5 text-[8.5px] font-data uppercase tracking-widest text-white/45 border border-white/15">
              {kill.match_stage}
            </span>
          )}
        </div>
        <p
          className="font-display text-sm font-bold text-[var(--text-primary)] leading-tight truncate"
          title={`${kill.killer_champion} vs ${kill.victim_name ?? kill.victim_champion}`}
        >
          <span style={{ color: accent }}>{kill.killer_champion ?? "?"}</span>{" "}
          <span className="text-white/40">vs</span>{" "}
          {kill.victim_name ?? kill.victim_champion ?? "?"}
        </p>
        {kill.ai_description && (
          <p className="mt-0.5 text-[11px] text-white/55 line-clamp-2">
            {kill.ai_description}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2 font-data text-[10px] text-white/50">
          {typeof kill.highlight_score === "number" && (
            <span className="text-[var(--gold)]">
              IA {kill.highlight_score.toFixed(1)}
            </span>
          )}
          {kill.rating_count > 0 && typeof kill.avg_rating === "number" && (
            <span>
              ★ {kill.avg_rating.toFixed(1)} · {kill.rating_count}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ════════════════════════════════════════════════════════════════════
// Community vote
// ════════════════════════════════════════════════════════════════════

function CommunityVote({
  bundleA,
  bundleB,
  tally,
  votedChoice,
  voting,
  voteError,
  onVote,
  prefersReducedMotion,
}: {
  bundleA: FaceOffBundle;
  bundleB: FaceOffBundle;
  tally: FaceOffTally;
  votedChoice: "a" | "b" | "tie" | null;
  voting: boolean;
  voteError: string | null;
  onVote: (choice: "a" | "b" | "tie") => void;
  prefersReducedMotion: boolean;
}) {
  const total = tally.votes_a + tally.votes_b + tally.votes_draw;
  const pctA = total > 0 ? (tally.votes_a / total) * 100 : 0;
  const pctB = total > 0 ? (tally.votes_b / total) * 100 : 0;
  const pctDraw = total > 0 ? (tally.votes_draw / total) * 100 : 0;

  return (
    <section className="mb-12 md:mb-16" aria-labelledby="face-off-vote">
      <SectionHeader id="face-off-vote" kicker="Vote communauté" />
      <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/70 backdrop-blur-md p-5 md:p-7">
        <p className="font-display text-2xl md:text-3xl font-black text-center text-[var(--text-primary)] mb-6 leading-tight">
          Qui est le meilleur ?
        </p>

        {/* Buttons */}
        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] items-stretch">
          <VoteButton
            onClick={() => onVote("a")}
            disabled={voting || votedChoice !== null}
            active={votedChoice === "a"}
            accent="var(--gold)"
            ariaLabel={`Vote pour ${bundleA.player.name}`}
            label={bundleA.player.name}
            icon="👈"
            iconPos="left"
          />
          <VoteButton
            onClick={() => onVote("tie")}
            disabled={voting || votedChoice !== null}
            active={votedChoice === "tie"}
            accent="var(--text-muted)"
            ariaLabel="Vote égalité"
            label="Égalité"
            small
          />
          <VoteButton
            onClick={() => onVote("b")}
            disabled={voting || votedChoice !== null}
            active={votedChoice === "b"}
            accent="var(--cyan)"
            ariaLabel={`Vote pour ${bundleB.player.name}`}
            label={bundleB.player.name}
            icon="👉"
            iconPos="right"
          />
        </div>

        {voteError && (
          <p className="mt-3 text-center text-xs text-[var(--red)]">{voteError}</p>
        )}

        {/* Tally bar */}
        <div className="mt-6">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-widest font-data text-white/45 mb-2">
            <span style={{ color: "var(--gold)" }}>
              {bundleA.player.name} · {pctA.toFixed(0)}%
            </span>
            <span>Égalité · {pctDraw.toFixed(0)}%</span>
            <span style={{ color: "var(--cyan)" }}>
              {bundleB.player.name} · {pctB.toFixed(0)}%
            </span>
          </div>
          <div
            className="relative h-3 rounded-full overflow-hidden bg-black/40"
            style={{ boxShadow: "inset 0 1px 0 rgba(0,0,0,0.4)" }}
          >
            <m.div
              initial={prefersReducedMotion ? false : { width: 0 }}
              animate={{ width: `${pctA}%` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="absolute top-0 left-0 h-full"
              style={{
                background:
                  "linear-gradient(90deg, var(--gold-bright), var(--gold))",
                boxShadow: "0 0 10px var(--gold)",
              }}
            />
            <m.div
              initial={prefersReducedMotion ? false : { width: 0 }}
              animate={{ width: `${pctB}%` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="absolute top-0 right-0 h-full"
              style={{
                background:
                  "linear-gradient(270deg, var(--cyan), rgba(10,200,185,0.6))",
                boxShadow: "0 0 10px var(--cyan)",
              }}
            />
          </div>
          <p className="mt-2 text-center font-data text-[10px] uppercase tracking-widest text-white/40">
            Total {total.toLocaleString("fr-FR")} vote{total > 1 ? "s" : ""}{" "}
            {votedChoice && (
              <span className="ml-2 text-[var(--gold)]">· Merci pour ton vote</span>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

function VoteButton({
  onClick,
  disabled,
  active,
  accent,
  ariaLabel,
  label,
  icon,
  iconPos,
  small,
}: {
  onClick: () => void;
  disabled: boolean;
  active: boolean;
  accent: string;
  ariaLabel: string;
  label: string;
  icon?: string;
  iconPos?: "left" | "right";
  small?: boolean;
}) {
  return (
    <m.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      className={`group rounded-xl border backdrop-blur-sm transition-all disabled:cursor-not-allowed ${
        small ? "px-4 py-3" : "px-5 py-4"
      }`}
      style={{
        borderColor: active ? "var(--gold-bright)" : `${accent}45`,
        background: active ? `${accent}25` : `${accent}0d`,
        color: accent,
        boxShadow: active
          ? `0 18px 36px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.2), 0 0 0 1px ${accent}`
          : `0 12px 24px ${accent}20`,
        opacity: disabled && !active ? 0.5 : 1,
      }}
    >
      <span
        className={`flex items-center justify-center gap-2 font-display font-black uppercase tracking-[0.2em] ${
          small ? "text-[11px]" : "text-sm"
        }`}
      >
        {icon && iconPos === "left" && (
          <span aria-hidden className="text-base">
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
        {icon && iconPos === "right" && (
          <span aria-hidden className="text-base">
            {icon}
          </span>
        )}
      </span>
    </m.button>
  );
}

// ════════════════════════════════════════════════════════════════════
// Popular duels footer
// ════════════════════════════════════════════════════════════════════

function PopularDuelsFooter({
  duels,
  playersBySlug,
  currentA,
  currentB,
}: {
  duels: TopFaceOffDuel[];
  playersBySlug: Record<string, FaceOffPlayerOption>;
  currentA: string;
  currentB: string;
}) {
  const filtered = duels.filter((d) => {
    const ids = [d.player_a_slug, d.player_b_slug].sort();
    const current = [currentA, currentB].sort();
    return ids.join("|") !== current.join("|");
  });

  return (
    <section aria-labelledby="face-off-popular">
      <SectionHeader id="face-off-popular" kicker="Duels populaires" />
      {filtered.length === 0 ? (
        <p className="text-sm text-white/45 px-4 py-6 text-center rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/40">
          Personne n&apos;a encore voté sur d&apos;autres duels.
          Lance-toi !
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.slice(0, 6).map((duel) => {
            const a = playersBySlug[duel.player_a_slug];
            const b = playersBySlug[duel.player_b_slug];
            return (
              <DuelCard
                key={`${duel.player_a_slug}-${duel.player_b_slug}`}
                duel={duel}
                aName={a?.name ?? duel.player_a_slug}
                bName={b?.name ?? duel.player_b_slug}
                aPhoto={a?.photoUrl ?? null}
                bPhoto={b?.photoUrl ?? null}
              />
            );
          })}
        </div>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/face-off"
          className="rounded-xl border border-[var(--gold)]/45 bg-black/30 px-5 py-2.5 font-display text-xs font-bold uppercase tracking-[0.25em] text-[var(--gold)] hover:border-[var(--gold)] hover:bg-[var(--gold)]/10 transition-all"
        >
          Nouveau duel
        </Link>
        <Link
          href="/vs"
          className="rounded-xl border border-white/20 bg-black/25 px-5 py-2.5 font-display text-xs font-bold uppercase tracking-[0.25em] text-white/75 hover:border-white/45 hover:text-white transition-all"
        >
          VS Roulette
        </Link>
      </div>
    </section>
  );
}

function DuelCard({
  duel,
  aName,
  bName,
  aPhoto,
  bPhoto,
}: {
  duel: TopFaceOffDuel;
  aName: string;
  bName: string;
  aPhoto: string | null;
  bPhoto: string | null;
}) {
  const params = new URLSearchParams();
  params.set("a", duel.player_a_slug);
  params.set("b", duel.player_b_slug);
  const total = duel.total_votes;
  const pctA = total > 0 ? Math.round((duel.votes_a / total) * 100) : 0;
  const pctB = total > 0 ? Math.round((duel.votes_b / total) * 100) : 0;
  return (
    <Link
      href={`/face-off?${params.toString()}`}
      className="group rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/60 p-4 transition-all hover:border-[var(--gold)]/60 hover:-translate-y-0.5"
      style={{ boxShadow: "0 10px 24px rgba(0,0,0,0.35)" }}
    >
      <div className="flex items-center gap-3">
        <DuelAvatar src={aPhoto} name={aName} accent="var(--gold)" />
        <span className="font-display text-xs font-black text-[var(--gold)]/80">VS</span>
        <DuelAvatar src={bPhoto} name={bName} accent="var(--cyan)" />
      </div>
      <p className="mt-3 font-display text-sm font-black text-[var(--text-primary)]">
        {aName} <span className="text-white/40">vs</span> {bName}
      </p>
      <div className="mt-2 flex items-center justify-between font-data text-[10px] uppercase tracking-widest text-white/45">
        <span style={{ color: "var(--gold)" }}>{pctA}%</span>
        <span>{total} votes</span>
        <span style={{ color: "var(--cyan)" }}>{pctB}%</span>
      </div>
    </Link>
  );
}

function DuelAvatar({
  src,
  name,
  accent,
}: {
  src: string | null;
  name: string;
  accent: string;
}) {
  return (
    <div
      className="relative rounded-full overflow-hidden flex-shrink-0 bg-black/30 flex items-center justify-center"
      style={{
        width: 36,
        height: 36,
        border: `2px solid ${accent}`,
        boxShadow: `0 0 14px ${accent}30`,
      }}
    >
      {src ? (
        <Image src={src} alt={name} width={36} height={36} className="object-cover h-full w-full" />
      ) : (
        <span className="text-[10px] font-data font-bold text-white/60">
          {name.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Section header — gold rhombus motif (matches player page)
// ════════════════════════════════════════════════════════════════════

function SectionHeader({ kicker, id }: { kicker: string; id?: string }) {
  return (
    <div className="flex items-center gap-3 mb-6" id={id}>
      <span className="h-px w-12 bg-[var(--gold)]" />
      <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
        {kicker}
      </span>
      <span className="text-[var(--gold)]/40 text-xs" aria-hidden>
        ◆
      </span>
    </div>
  );
}
