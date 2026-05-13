import Image from "next/image";
import Link from "next/link";
import { championIconUrl } from "@/lib/constants";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";

/**
 * MatchSummaryCard — 3-column premium summary under the hero.
 *
 *   Col 1 — Format card (BO label, total duration, stage).
 *   Col 2 — Kills card (total kills, first blood pace, KC vs opp split).
 *   Col 3 — MVP card (player photo + signature champion + score).
 *
 * Mobile-first : stacks single-column < md.
 *
 * Server component — pure render, no interactivity.
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface MatchSummaryCardProps {
  bestOf: number;
  format: string;
  /** Stage label (Playoffs, Week 4 Day 1…). */
  stage: string | null;
  /** Total duration of every game in this BO, seconds. */
  totalDurationSeconds: number;
  /** Match-wide kill totals. */
  totalKills: number;
  kcKills: number;
  oppKills: number;
  /** Seconds in-game when the first KC-side first-blood occurred — null
   *  when none happened (rare data-only cases). */
  firstBloodSeconds: number | null;
  /** Whether the FB was a KC kill. */
  firstBloodByKc: boolean;
  /** Patch played on. */
  patch: string | null;
  /** Optional MVP — null falls back to a "Pas de MVP" card. */
  mvp: {
    ign: string;
    signatureChampion: string;
    aggregateScore: number;
    killCount: number;
    photoUrl?: string | null;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  if (hh > 0) return `${hh}h ${mm.toString().padStart(2, "0")}m`;
  return `${mm}m`;
}

function formatMinSec(seconds: number | null): string {
  if (seconds == null) return "—";
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

// ─── Component ────────────────────────────────────────────────────────

export function MatchSummaryCard({
  bestOf,
  format,
  stage,
  totalDurationSeconds,
  totalKills,
  kcKills,
  oppKills,
  firstBloodSeconds,
  firstBloodByKc,
  patch,
  mvp,
}: MatchSummaryCardProps) {
  return (
    <section
      aria-label="Résumé du match"
      className="grid grid-cols-1 gap-3 md:grid-cols-3"
    >
      {/* Col 1 — Format */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
        <span
          aria-hidden
          className="absolute top-3 right-3 text-[var(--gold)]/30"
        >
          ◆
        </span>
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/80">
          Format
        </p>
        <p className="mt-2 font-display text-3xl font-black text-[var(--text-primary)]">
          Bo{bestOf}
        </p>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          {format.toUpperCase()}
        </p>
        <dl className="mt-4 space-y-2 border-t border-[var(--border-gold)]/40 pt-3">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="text-[var(--text-muted)] uppercase tracking-widest text-[10px]">
              Durée totale
            </dt>
            <dd className="font-data font-bold text-[var(--text-primary)]">
              {formatDuration(totalDurationSeconds)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="text-[var(--text-muted)] uppercase tracking-widest text-[10px]">
              Stage
            </dt>
            <dd className="font-data font-bold text-[var(--text-primary)] truncate">
              {stage ?? "—"}
            </dd>
          </div>
          {patch && (
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="text-[var(--text-muted)] uppercase tracking-widest text-[10px]">
                Patch
              </dt>
              <dd className="font-data font-bold text-[var(--cyan)]">
                {patch}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Col 2 — Kills */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
        <span
          aria-hidden
          className="absolute top-3 right-3 text-[var(--gold)]/30"
        >
          ◆
        </span>
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/80">
          Kills totaux
        </p>
        <p className="mt-2 font-display text-4xl font-black tabular-nums text-[var(--text-primary)]">
          {totalKills}
        </p>
        {/* KC vs opp bar */}
        <div className="mt-3">
          <div className="flex h-2 overflow-hidden rounded-full bg-[var(--bg-primary)]">
            <div
              className="h-full bg-[var(--gold)]"
              style={{
                width: `${totalKills > 0 ? (kcKills / totalKills) * 100 : 50}%`,
              }}
              aria-hidden
            />
            <div
              className="h-full bg-[var(--red)]"
              style={{
                width: `${totalKills > 0 ? (oppKills / totalKills) * 100 : 50}%`,
              }}
              aria-hidden
            />
          </div>
          <div className="mt-2 flex items-center justify-between font-data text-[11px]">
            <span className="text-[var(--gold)] font-bold">{kcKills} KC</span>
            <span className="text-[var(--red)] font-bold">{oppKills} OPP</span>
          </div>
        </div>
        {firstBloodSeconds != null && (
          <p className="mt-4 border-t border-[var(--border-gold)]/40 pt-3 text-xs text-[var(--text-muted)]">
            Premier sang à{" "}
            <span className="font-data font-bold text-[var(--text-primary)]">
              T+{formatMinSec(firstBloodSeconds)}
            </span>
            {" · "}
            <span
              className={
                firstBloodByKc
                  ? "text-[var(--gold)] font-bold"
                  : "text-[var(--red)] font-bold"
              }
            >
              {firstBloodByKc ? "par KC" : "contre KC"}
            </span>
          </p>
        )}
      </div>

      {/* Col 3 — MVP */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
        <span
          aria-hidden
          className="absolute top-3 right-3 text-[var(--gold)]/30"
        >
          ◆
        </span>
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/80">
          MVP du match
        </p>
        {mvp ? (
          <Link
            href={`/player/${encodeURIComponent(mvp.ign)}`}
            className="mt-2 flex items-center gap-4 group"
          >
            <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full border-2 border-[var(--gold)]/40 bg-[var(--bg-elevated)] transition-transform group-hover:scale-105">
              {mvp.photoUrl || PLAYER_PHOTOS[mvp.ign] ? (
                <Image
                  src={mvp.photoUrl ?? PLAYER_PHOTOS[mvp.ign] ?? ""}
                  alt={mvp.ign}
                  fill
                  sizes="64px"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <Image
                  src={championIconUrl(mvp.signatureChampion)}
                  alt={mvp.signatureChampion}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-display text-xl font-black uppercase text-[var(--gold)] leading-tight truncate group-hover:underline">
                {mvp.ign}
              </p>
              <p className="text-xs text-[var(--text-muted)] truncate">
                Signature : {mvp.signatureChampion}
              </p>
              <div className="mt-1 flex items-center gap-3 font-data text-[11px]">
                <span className="rounded-full border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-1.5 py-0.5 text-[var(--gold)] font-bold">
                  IA {mvp.aggregateScore.toFixed(1)}
                </span>
                <span className="text-[var(--text-secondary)]">
                  {mvp.killCount} kills clippés
                </span>
              </div>
            </div>
          </Link>
        ) : (
          <p className="mt-3 text-sm italic text-[var(--text-muted)]">
            Pas encore assez de kills clippés pour désigner le MVP.
          </p>
        )}
      </div>
    </section>
  );
}
