"use client";

/**
 * QuietHoursCard — pick a daily window where push notifications are
 * silenced (Wave 9 / PR-arch P2).
 *
 * UX
 * ──
 *   * Two `<input type="time">` pickers (native, mobile-friendly :
 *     iOS surfaces the wheel picker, Android surfaces the clock).
 *   * Hours are stored UTC in the DB ; the picker shows them in the
 *     user's local timezone for clarity, and we round-trip via the
 *     two `*_utc` integer columns.
 *   * Defaults : 23h-7h UTC = 00h-08h Paris (the value the worker
 *     uses when these columns are NULL or migration 042 isn't applied).
 *   * The card is unmounted when the user is not subscribed — no
 *     point letting them set quiet hours for a non-existent device.
 *
 * Persistence
 * ───────────
 * PUT /api/push/preferences with the device's `endpoint` URL +
 * `quiet_hours_start_utc` + `quiet_hours_end_utc`. The route is
 * Wave-9 aware and applies a fallback patch (preferences-only) when
 * migration 042 hasn't landed yet, so saving never bricks.
 *
 * Note on `system` notifications
 * ──────────────────────────────
 * The Python worker (push_throttle.py) bypasses quiet hours for the
 * `system` kind so downtime / maintenance alerts always reach the
 * user. The card surfaces a small caption mentioning this.
 */

import { useEffect, useState } from "react";

interface Props {
  /** PushSubscription endpoint URL — null while we don't yet know
   *  whether the device is subscribed. */
  endpoint: string | null;
}

const DEFAULT_START_UTC = 23;
const DEFAULT_END_UTC = 7;

/** Convert a 0-23 UTC hour to a "HH:00" string in the local timezone
 *  for the `<input type="time">` value. */
function utcHourToLocalTimeString(utcHour: number): string {
  // Build a Date today at `utcHour:00` UTC, then read its local hour.
  const d = new Date();
  d.setUTCHours(utcHour, 0, 0, 0);
  const lh = d.getHours();
  return `${String(lh).padStart(2, "0")}:00`;
}

/** Convert a local "HH:MM" string back to a 0-23 UTC hour. Minutes
 *  are dropped — the throttle's resolution is hour-of-day. */
function localTimeStringToUtcHour(timeStr: string): number {
  const [hStr] = timeStr.split(":");
  const lh = Number(hStr);
  if (!Number.isFinite(lh)) return 0;
  const d = new Date();
  d.setHours(lh, 0, 0, 0);
  return d.getUTCHours();
}

export function QuietHoursCard({ endpoint }: Props) {
  const [startUtc, setStartUtc] = useState<number>(DEFAULT_START_UTC);
  const [endUtc, setEndUtc] = useState<number>(DEFAULT_END_UTC);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Initial load — pull current values from the API.
  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/push/preferences?endpoint=${encodeURIComponent(endpoint)}`,
        );
        if (!r.ok) return;
        const data = (await r.json()) as {
          quiet_hours_start_utc?: number;
          quiet_hours_end_utc?: number;
        };
        if (cancelled) return;
        if (typeof data.quiet_hours_start_utc === "number") {
          setStartUtc(data.quiet_hours_start_utc);
        }
        if (typeof data.quiet_hours_end_utc === "number") {
          setEndUtc(data.quiet_hours_end_utc);
        }
      } catch {
        // Silent — defaults are already in state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const save = async (nextStart: number, nextEnd: number) => {
    if (!endpoint) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/push/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint,
          quiet_hours_start_utc: nextStart,
          quiet_hours_end_utc: nextEnd,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  // Don't render anything when the device isn't subscribed.
  if (!endpoint) return null;

  const startLocal = utcHourToLocalTimeString(startUtc);
  const endLocal = utcHourToLocalTimeString(endUtc);

  return (
    <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold">Heures de silence</h2>
        {savedAt !== null && !busy && !error && (
          <span
            className="text-[10px] uppercase tracking-widest text-[var(--green)]"
            role="status"
            aria-live="polite"
          >
            ● Enregistré
          </span>
        )}
      </div>

      <p className="text-sm text-[var(--text-muted)]">
        Pendant cette tranche horaire, on ne t&apos;envoie aucune notif —
        sauf les alertes système (maintenance, downtime).
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--text-muted)]">Début</span>
          <input
            type="time"
            value={startLocal}
            step={3600}
            disabled={busy}
            onChange={(e) => {
              const u = localTimeStringToUtcHour(e.target.value);
              setStartUtc(u);
              void save(u, endUtc);
            }}
            className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
            aria-label="Début des heures de silence"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--text-muted)]">Fin</span>
          <input
            type="time"
            value={endLocal}
            step={3600}
            disabled={busy}
            onChange={(e) => {
              const u = localTimeStringToUtcHour(e.target.value);
              setEndUtc(u);
              void save(startUtc, u);
            }}
            className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
            aria-label="Fin des heures de silence"
          />
        </label>
      </div>

      <p className="text-[10px] text-[var(--text-muted)] opacity-70">
        Les horaires sont affichés dans ton fuseau local. Ils s&apos;appliquent
        au navigateur où tu les configures.
      </p>

      {error && (
        <p className="text-xs text-[var(--red)]" role="status" aria-live="polite">
          {error}
        </p>
      )}
    </section>
  );
}
