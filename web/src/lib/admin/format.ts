/**
 * Admin formatters — pure utilities reused by every admin primitive.
 *
 * Locale: French (fr-FR) for human-facing strings, ASCII compact units
 * (KB / MB / GB) for technical readouts. No deps, tree-shakable.
 *
 * Used by AdminTable cells, AdminCard captions, KpiTile sub labels,
 * pipeline / DLQ / audit pages, etc. Centralised so "il y a 2 min"
 * doesn't end up phrased a dozen different ways across the admin.
 */

// ─── Time ────────────────────────────────────────────────────────────────────

const RELATIVE_THRESHOLDS: Array<{ unit: Intl.RelativeTimeFormatUnit; secs: number }> = [
  { unit: "second", secs: 60 },
  { unit: "minute", secs: 3600 },
  { unit: "hour", secs: 86400 },
  { unit: "day", secs: 604800 },
  { unit: "week", secs: 2629800 },
  { unit: "month", secs: 31557600 },
  { unit: "year", secs: Infinity },
];

const RTF = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

/**
 * Returns "à l'instant", "il y a 5 min", "hier", "il y a 3 h", ...
 * Negative diff (future) returns "dans X". Invalid input returns "—".
 */
export function relativeTime(input: Date | string | number | null | undefined): string {
  if (input === null || input === undefined) return "—";
  const d = input instanceof Date ? input : new Date(input);
  const ts = d.getTime();
  if (!Number.isFinite(ts)) return "—";

  const diffSec = Math.round((ts - Date.now()) / 1000);
  const absSec = Math.abs(diffSec);

  if (absSec < 5) return "à l'instant";

  let acc = 1;
  for (const { unit, secs } of RELATIVE_THRESHOLDS) {
    if (absSec < secs) {
      const value = Math.round(diffSec / acc);
      return RTF.format(value, unit);
    }
    acc = secs;
  }
  return "—";
}

/**
 * "1m 23s", "2h 14m", "45s". Used for clip durations, job runtimes.
 * Negative or NaN → "—".
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return remS > 0 ? `${m}m ${remS}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

// ─── Sizes / counts ──────────────────────────────────────────────────────────

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * "1.2 KB", "3.4 MB", "12 B". Base 1024. Negative/NaN → "—".
 */
export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "0 B";
  const exp = Math.min(Math.floor(Math.log(n) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = n / Math.pow(1024, exp);
  // Sub-10 → 1 decimal, 10+ → integer (saves visual noise on table cells).
  const formatted = value < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${formatted} ${SIZE_UNITS[exp]}`;
}

/**
 * "1.2K", "1.5M", "999". Used for impression counts, comment counts.
 * Compact, no spaces. Negative → "—".
 */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return Math.round(n).toString();
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v < 10 ? v.toFixed(1) : Math.round(v)}K`;
  }
  if (n < 1_000_000_000) {
    const v = n / 1_000_000;
    return `${v < 10 ? v.toFixed(1) : Math.round(v)}M`;
  }
  const v = n / 1_000_000_000;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}B`;
}

// ─── Latency w/ color hint ───────────────────────────────────────────────────

export type LatencyTone = "good" | "warn" | "bad" | "neutral";

export interface LatencyResult {
  /** Display string: "120ms" or "1.2s". */
  label: string;
  /** Severity bucket — caller can map to a CSS var. */
  tone: LatencyTone;
}

/**
 * "120ms" / "1.2s" + a tone hint:
 *   ≤ 500ms → "good"
 *   ≤ 2000ms → "warn"
 *   > 2000ms → "bad"
 *   null/NaN → "neutral" + "—"
 */
export function formatLatency(ms: number | null | undefined): LatencyResult {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return { label: "—", tone: "neutral" };
  }
  const label = ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  const tone: LatencyTone = ms <= 500 ? "good" : ms <= 2000 ? "warn" : "bad";
  return { label, tone };
}

/**
 * Map a LatencyTone to a CSS variable name. Stays consistent with KpiTile.
 */
export function latencyToneVar(tone: LatencyTone): string {
  switch (tone) {
    case "good":
      return "var(--green)";
    case "warn":
      return "var(--orange)";
    case "bad":
      return "var(--red)";
    default:
      return "var(--text-muted)";
  }
}

// ─── Misc helpers ────────────────────────────────────────────────────────────

/**
 * Truncate a string with ellipsis. Used for IDs / hashes in tables.
 */
export function truncateMiddle(s: string | null | undefined, head = 6, tail = 4): string {
  if (!s) return "—";
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/**
 * Format a percentage from a fraction. 0.123 → "12.3%". Null → "—".
 */
export function formatPercent(fraction: number | null | undefined, decimals = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(decimals)}%`;
}
