"use client";

/**
 * FeaturedCalendar — month grid for pinning a kill to the homepage.
 *
 * Owned by Agent ED. Each cell is one calendar day :
 *   - empty (dotted border) → click to add
 *   - pinned → renders the kill thumbnail + champion matchup + ×
 *   - today → gold ring
 *   - past → dimmed (read-only history)
 *
 * Date arithmetic is intentionally LOCAL-time (the editor pins "the
 * 26th" they see in their UI), but every value sent on the wire is the
 * matching `YYYY-MM-DD` slice — same key the API uses on
 * `featured_clips.feature_date`. This avoids the off-by-one issue where
 * `new Date('2026-04-26').toISOString()` flips the date for negative
 * UTC offsets.
 *
 * The "this week" rail at the top is mobile-friendly : 7 cells side-by-
 * side that always show today + 6 days into the future, regardless of
 * which calendar month is being browsed.
 */

import { useMemo, useState } from "react";
import Image from "next/image";

export interface FeaturedCalendarKill {
  id: string;
  killerChampion: string;
  victimChampion: string;
  thumbnail: string | null;
  highlightScore: number | null;
}

export interface FeaturedCalendarPin {
  date: string; // YYYY-MM-DD (local)
  killId: string;
  notes: string | null;
}

interface Props {
  pins: FeaturedCalendarPin[];
  killsById: Map<string, FeaturedCalendarKill>;
  onPickDate: (dateIso: string) => void;
  onRemovePin: (dateIso: string) => void;
}

/** "YYYY-MM-DD" of a date in LOCAL time (no UTC drift). */
function toLocalIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** Monday=0 (French calendar). */
function dayOfWeekMondayFirst(d: Date): number {
  const dow = d.getDay(); // Sun=0
  return (dow + 6) % 7;
}

const DAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];
const MONTH_LABELS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

export function FeaturedCalendar({
  pins,
  killsById,
  onPickDate,
  onRemovePin,
}: Props) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const todayIso = toLocalIso(new Date());

  const pinByDate = useMemo(() => {
    const m = new Map<string, FeaturedCalendarPin>();
    for (const p of pins) m.set(p.date, p);
    return m;
  }, [pins]);

  const cells = useMemo(() => {
    const start = startOfMonth(cursor);
    const end = endOfMonth(cursor);
    const offset = dayOfWeekMondayFirst(start);
    const total = end.getDate();
    const out: { date: string; dayOfMonth: number; inMonth: boolean }[] = [];

    // Leading blank cells from previous month
    for (let i = 0; i < offset; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() - (offset - i));
      out.push({ date: toLocalIso(d), dayOfMonth: d.getDate(), inMonth: false });
    }
    // Current month
    for (let i = 1; i <= total; i++) {
      const d = new Date(cursor.getFullYear(), cursor.getMonth(), i);
      out.push({ date: toLocalIso(d), dayOfMonth: i, inMonth: true });
    }
    // Trailing blanks to fill final week
    while (out.length % 7 !== 0) {
      const last = new Date(cursor.getFullYear(), cursor.getMonth(), total);
      last.setDate(last.getDate() + (out.length - (offset + total) + 1));
      out.push({
        date: toLocalIso(last),
        dayOfMonth: last.getDate(),
        inMonth: false,
      });
    }
    return out;
  }, [cursor]);

  const weekRail = useMemo(() => {
    const out: { date: string; dayOfMonth: number; weekday: string }[] = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      out.push({
        date: toLocalIso(d),
        dayOfMonth: d.getDate(),
        weekday: d.toLocaleDateString("fr-FR", { weekday: "short" }),
      });
    }
    return out;
  }, []);

  const goPrev = () =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  const goNext = () =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
  const goToday = () => setCursor(startOfMonth(new Date()));

  return (
    <div className="space-y-5">
      {/* This-week rail */}
      <div>
        <h3 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
          Cette semaine
        </h3>
        <div className="grid grid-cols-7 gap-1.5">
          {weekRail.map((cell) => {
            const pin = pinByDate.get(cell.date) ?? null;
            const kill = pin ? killsById.get(pin.killId) ?? null : null;
            const isToday = cell.date === todayIso;
            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => onPickDate(cell.date)}
                className={`relative aspect-[3/4] rounded-md overflow-hidden border text-left transition-all ${
                  isToday
                    ? "border-[var(--gold)] ring-2 ring-[var(--gold)]/40"
                    : pin
                      ? "border-[var(--gold)]/40"
                      : "border-dashed border-[var(--border-gold)] hover:border-[var(--gold)]/60"
                } bg-[var(--bg-primary)]`}
              >
                {kill?.thumbnail ? (
                  <Image
                    src={kill.thumbnail}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover opacity-60"
                  />
                ) : null}
                <span className="absolute inset-x-0 top-0 px-1 py-0.5 text-[8px] font-bold uppercase tracking-widest bg-black/60 text-[var(--text-secondary)] text-center">
                  {cell.weekday}
                </span>
                <span
                  className={`absolute inset-x-0 bottom-0 px-1 py-0.5 text-[10px] font-mono text-center bg-black/70 ${
                    isToday ? "text-[var(--gold)]" : "text-[var(--text-primary)]"
                  }`}
                >
                  {cell.dayOfMonth}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold text-[var(--text-primary)]">
          {MONTH_LABELS[cursor.getMonth()]} {cursor.getFullYear()}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goPrev}
            className="rounded border border-[var(--border-gold)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--gold)]"
            aria-label="Mois précédent"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded border border-[var(--border-gold)] px-2 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--gold)] uppercase tracking-widest"
          >
            Aujourd&apos;hui
          </button>
          <button
            type="button"
            onClick={goNext}
            className="rounded border border-[var(--border-gold)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--gold)]"
            aria-label="Mois suivant"
          >
            ›
          </button>
        </div>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-1.5 text-[10px] uppercase tracking-widest text-[var(--text-muted)] text-center">
        {DAY_LABELS.map((d, i) => (
          <span key={`${d}-${i}`}>{d}</span>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((cell, i) => {
          const pin = pinByDate.get(cell.date) ?? null;
          const kill = pin ? killsById.get(pin.killId) ?? null : null;
          const isToday = cell.date === todayIso;
          const isPast = cell.date < todayIso;
          const isOutOfMonth = !cell.inMonth;

          return (
            <div
              key={`${cell.date}-${i}`}
              className={`relative aspect-[3/4] rounded-md overflow-hidden border ${
                isToday
                  ? "border-[var(--gold)] ring-2 ring-[var(--gold)]/40"
                  : pin
                    ? "border-[var(--gold)]/40"
                    : "border-dashed border-[var(--border-gold)]/60"
              } ${isOutOfMonth ? "opacity-25" : isPast ? "opacity-60" : ""} bg-[var(--bg-primary)] group`}
            >
              {kill ? (
                <>
                  {kill.thumbnail && (
                    <Image
                      src={kill.thumbnail}
                      alt={`${kill.killerChampion} → ${kill.victimChampion}`}
                      fill
                      sizes="120px"
                      className="object-cover"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => onPickDate(cell.date)}
                    className="absolute inset-0 bg-black/40 hover:bg-black/30 transition-colors"
                    aria-label={`Modifier le pin du ${cell.date}`}
                  />
                  <span className="absolute top-1 left-1 text-[10px] font-mono text-white drop-shadow">
                    {cell.dayOfMonth}
                  </span>
                  <span className="absolute bottom-0 inset-x-0 px-1 py-0.5 text-[8px] font-bold text-center bg-black/70 text-[var(--gold-bright)] truncate">
                    {kill.killerChampion} → {kill.victimChampion}
                  </span>
                  {!isPast && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Retirer le pin du ${cell.date} ?`)) {
                          onRemovePin(cell.date);
                        }
                      }}
                      className="absolute top-0.5 right-0.5 z-10 h-4 w-4 rounded-full bg-black/70 text-[var(--red)] text-[10px] leading-none hover:bg-[var(--red)] hover:text-white opacity-0 group-hover:opacity-100"
                      aria-label="Retirer le pin"
                    >
                      ×
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => onPickDate(cell.date)}
                  disabled={isPast || isOutOfMonth}
                  className="absolute inset-0 flex items-center justify-center text-[var(--text-disabled)] hover:text-[var(--gold)] disabled:cursor-not-allowed text-xs"
                  aria-label={`Pin un kill au ${cell.date}`}
                >
                  <span className="font-mono">{cell.dayOfMonth}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
