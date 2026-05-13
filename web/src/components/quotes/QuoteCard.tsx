"use client";

/**
 * QuoteCard — single-card presentation of one extracted shoutable phrase.
 *
 * Used by :
 *   * /quotes encyclopedia grid (3-col desktop / 1-col mobile)
 *   * /kill/[id] PHRASES tab (list view, smaller layout)
 *
 * Compact mode (`variant="inline"`) drops the era badge + the
 * killer→victim header since those are obvious from the parent kill
 * page's hero.
 */

import Link from "next/link";

import { QuoteAudioButton } from "./QuoteAudioButton";
import { QuoteUpvoteButton } from "./QuoteUpvoteButton";

export interface QuoteCardData {
  id: string;
  kill_id: string;
  quote_text: string;
  quote_start_ms: number;
  quote_end_ms: number;
  caster_name: string | null;
  energy_level: number | null;
  is_memetic: boolean;
  upvotes: number;
  killer_champion: string | null;
  victim_champion: string | null;
  clip_url: string | null; // mapped from clip_url_vertical | clip_url_horizontal upstream
  multi_kill: string | null;
  is_first_blood: boolean;
  match_date?: string | null;
}

interface Props {
  quote: QuoteCardData;
  variant?: "full" | "inline";
}

function EnergyFlames({ level }: { level: number | null }) {
  const safe = Math.max(0, Math.min(5, level ?? 0));
  if (safe === 0) {
    return (
      <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        Energie ?
      </span>
    );
  }
  // Five flame icons, filled per energy level. The shapes are subtle —
  // a small triangle with rounded base — so the row reads at a glance
  // without dominating the card.
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`Energie ${safe} sur 5`}
      title={`Energie ${safe}/5`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <FlameIcon key={i} on={i < safe} />
      ))}
    </span>
  );
}

function FlameIcon({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 12 16"
      width="11"
      height="14"
      aria-hidden
      style={{
        color: on ? "var(--orange)" : "var(--text-disabled)",
      }}
    >
      <path
        fill="currentColor"
        d="M6 1c0 3-4 4-4 8a4 4 0 0 0 8 0c0-2-2-3-2-5 0 1-1 1.5-2 3z"
      />
    </svg>
  );
}

function eraOfMatchDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // Cheap "what KC era was this in" classifier — we don't want to
  // import the heavy /lib/eras module from a client island, so the
  // mapping is inline. Mirrors the table in CLAUDE.md PARTIE 6.2.
  const d = new Date(iso);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  if (year <= 2021) return "LFL 2021";
  if (year === 2022) return "Rekkles";
  if (year === 2023) return "LFL→LEC";
  if (year === 2024) return "LEC Rookie";
  if (year === 2025) {
    if (month <= 4) return "Winter Sacre";
    if (month <= 7) return "First Stand";
    return "Drame Summer";
  }
  if (year === 2026) return month <= 4 ? "Versus" : "Spring 26";
  return null;
}

export function QuoteCard({ quote, variant = "full" }: Props) {
  const era = variant === "full" ? eraOfMatchDate(quote.match_date) : null;
  const killerVictim =
    quote.killer_champion && quote.victim_champion
      ? `${quote.killer_champion} → ${quote.victim_champion}`
      : null;

  return (
    <article
      className={[
        "group relative flex flex-col gap-4 rounded-2xl border bg-[var(--bg-surface)] p-5 transition-all",
        "border-[var(--border-gold)] hover:border-[var(--gold)]/60",
        variant === "inline" ? "p-4" : "p-5 md:p-6",
      ].join(" ")}
    >
      {/* corner deco (gold L) */}
      <span
        aria-hidden
        className="absolute top-0 left-0 h-5 w-5 rounded-tl-2xl border-t-2 border-l-2 border-[var(--gold)]/70"
      />
      <span
        aria-hidden
        className="absolute bottom-0 right-0 h-5 w-5 rounded-br-2xl border-b-2 border-r-2 border-[var(--gold)]/30"
      />

      {/* Top row : context + memetic chip */}
      {variant === "full" && (
        <header className="flex items-center justify-between text-[10px] uppercase tracking-[0.25em] text-[var(--text-muted)]">
          <div className="flex items-center gap-2">
            {era && (
              <span className="rounded-full border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[var(--gold)]">
                {era}
              </span>
            )}
            {killerVictim && (
              <span className="hidden md:inline-block">{killerVictim}</span>
            )}
          </div>
          {quote.is_memetic && (
            <span className="rounded-full bg-[var(--gold)]/20 border border-[var(--gold)]/50 px-2.5 py-1 font-data font-black text-[var(--gold-bright)]">
              ★ Meme
            </span>
          )}
        </header>
      )}

      {/* Quote text — the hero of the card */}
      <blockquote
        className={[
          "font-display text-[var(--text-primary)]",
          variant === "full"
            ? "text-xl md:text-2xl leading-snug text-center min-h-[5.5rem] flex items-center justify-center"
            : "text-base md:text-lg leading-snug",
        ].join(" ")}
      >
        <span className="text-[var(--gold)] mr-1" aria-hidden>
          &laquo;
        </span>
        {quote.quote_text}
        <span className="text-[var(--gold)] ml-1" aria-hidden>
          &raquo;
        </span>
      </blockquote>

      {/* Meta row : caster + energy */}
      <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--text-secondary)]">
        <span className="flex items-center gap-2">
          {quote.caster_name ? (
            <span className="rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 font-data uppercase tracking-widest text-[var(--gold-bright)]">
              {quote.caster_name}
            </span>
          ) : (
            <span className="text-[var(--text-muted)] italic">Caster ?</span>
          )}
          <EnergyFlames level={quote.energy_level} />
        </span>
        <span className="font-data tabular-nums text-[var(--text-muted)]">
          {formatMs(quote.quote_start_ms)}
        </span>
      </div>

      {/* Action row */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <QuoteAudioButton
            clipUrl={quote.clip_url}
            startMs={quote.quote_start_ms}
            endMs={quote.quote_end_ms}
            label={quote.quote_text.slice(0, 40)}
          />
          <Link
            href={`/kill/${quote.kill_id}`}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] uppercase tracking-widest text-[var(--text-secondary)] hover:border-[var(--gold)]/50 hover:text-[var(--gold)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)]"
          >
            Voir le clip
            <span aria-hidden>→</span>
          </Link>
        </div>
        <QuoteUpvoteButton quoteId={quote.id} initialUpvotes={quote.upvotes} />
      </div>
    </article>
  );
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
