"use client";

import { Sparkline } from "./Sparkline";

export type KpiTone = "neutral" | "good" | "warn" | "bad";

interface Props {
  label: string;
  /** The big number. Can be a string for pre-formatted values ("12,3 K"). */
  value: number | string | null;
  /** Optional small caption under the value (e.g. "publiés / heure"). */
  sub?: string;
  /** Sparkline series — trailing 24 values. Empty array = skeleton bar. */
  sparkline?: number[];
  /** Delta vs previous period as a fraction (0.12 → "+12%"). null = hide. */
  delta?: number | null;
  /** When true, an inverse delta (down = good) flips the color logic. */
  invertDelta?: boolean;
  tone?: KpiTone;
  /** Loading skeleton overrides the value + sparkline with shimmer. */
  loading?: boolean;
}

/**
 * KpiTile — Hero KPI card for /admin live dashboard.
 *
 * Layout (desktop) :
 *   ┌──────────────────────────┐
 *   │ LABEL UPPERCASE          │
 *   │ 1 234   ▒▒▒▒▒▒▒▒▒▒▒      │  ← big number + sparkline right-aligned
 *   │ +12% vs hier             │
 *   │ caption                  │
 *   └──────────────────────────┘
 */
export function KpiTile({
  label,
  value,
  sub,
  sparkline = [],
  delta = null,
  invertDelta = false,
  tone = "neutral",
  loading = false,
}: Props) {
  const accents: Record<KpiTone, { border: string; text: string; spark: string }> = {
    neutral: {
      border: "border-[var(--border-gold)]",
      text: "text-[var(--gold)]",
      spark: "var(--gold)",
    },
    good: {
      border: "border-[var(--green)]/40",
      text: "text-[var(--green)]",
      spark: "var(--green)",
    },
    warn: {
      border: "border-[var(--orange)]/40",
      text: "text-[var(--orange)]",
      spark: "var(--orange)",
    },
    bad: {
      border: "border-[var(--red)]/40",
      text: "text-[var(--red)]",
      spark: "var(--red)",
    },
  };

  const accent = accents[tone];

  const displayValue =
    value == null
      ? "—"
      : typeof value === "number"
        ? value.toLocaleString("fr-FR")
        : value;

  return (
    <div
      className={`rounded-xl border ${accent.border} bg-[var(--bg-surface)] p-4 flex flex-col gap-2 min-h-[112px]`}
    >
      <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] truncate">
        {label}
      </p>

      <div className="flex items-end justify-between gap-3">
        {loading ? (
          <div
            className="h-9 w-20 rounded bg-[var(--bg-elevated)] animate-pulse"
            aria-label="Chargement"
          />
        ) : (
          <p
            className={`font-display text-3xl md:text-4xl font-black leading-none ${accent.text}`}
          >
            {displayValue}
          </p>
        )}
        {loading ? (
          <div className="h-6 w-20 rounded bg-[var(--bg-elevated)] animate-pulse" />
        ) : sparkline.length > 0 ? (
          <Sparkline
            data={sparkline}
            width={88}
            height={28}
            color={accent.spark}
            smooth
            gradient
            showDot
          />
        ) : null}
      </div>

      <DeltaPill delta={delta} invertDelta={invertDelta} loading={loading} />

      {sub ? (
        <p className="text-[11px] text-[var(--text-muted)] mt-auto truncate" title={sub}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function DeltaPill({
  delta,
  invertDelta,
  loading,
}: {
  delta: number | null;
  invertDelta: boolean;
  loading: boolean;
}) {
  if (loading) {
    return <div className="h-3 w-16 rounded bg-[var(--bg-elevated)] animate-pulse" />;
  }
  if (delta == null || !Number.isFinite(delta)) {
    return <span className="text-[10px] text-[var(--text-disabled)]">—</span>;
  }

  // 0.001 = noise floor — anything below renders as "stable".
  const ABS_NOISE = 0.005;
  const abs = Math.abs(delta);
  const stable = abs < ABS_NOISE;
  const positive = delta > 0;
  // For "DLQ count" style metrics, going DOWN is good. invertDelta flips that.
  const isGood = stable
    ? false
    : invertDelta
      ? !positive
      : positive;
  const arrow = stable ? "→" : positive ? "↑" : "↓";
  const color = stable
    ? "text-[var(--text-muted)]"
    : isGood
      ? "text-[var(--green)]"
      : "text-[var(--red)]";
  const pct = Math.round(abs * 100);

  return (
    <p className={`text-[11px] font-mono ${color}`}>
      {arrow} {pct}% <span className="text-[var(--text-muted)]">vs période précédente</span>
    </p>
  );
}
