"use client";

import type { VitalsByPageRow } from "@/app/api/admin/perf/vitals-by-page/route";

/**
 * WebVitalsByPageTable — per-page LCP/CLS/INP p75 table for /admin/perf.
 *
 * Reuses the same Google Web Vitals thresholds as the WebVitalsTile so
 * a row colored "red" in this table matches the per-metric color in the
 * dashboard tile when the same page dominates the global stats.
 */
const THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 },
  CLS: { good: 0.1, poor: 0.25 },
  INP: { good: 200, poor: 500 },
} as const;

type Tone = "good" | "warn" | "bad" | "neutral";

function toneForLcp(v: number | null): Tone {
  if (v == null) return "neutral";
  if (v <= THRESHOLDS.LCP.good) return "good";
  if (v < THRESHOLDS.LCP.poor) return "warn";
  return "bad";
}
function toneForCls(v: number | null): Tone {
  if (v == null) return "neutral";
  if (v <= THRESHOLDS.CLS.good) return "good";
  if (v < THRESHOLDS.CLS.poor) return "warn";
  return "bad";
}
function toneForInp(v: number | null): Tone {
  if (v == null) return "neutral";
  if (v <= THRESHOLDS.INP.good) return "good";
  if (v < THRESHOLDS.INP.poor) return "warn";
  return "bad";
}

function colorClass(tone: Tone): string {
  switch (tone) {
    case "good":
      return "text-[var(--green)]";
    case "warn":
      return "text-[var(--orange)]";
    case "bad":
      return "text-[var(--red)] font-bold";
    default:
      return "text-[var(--text-muted)]";
  }
}

function formatLcp(v: number | null): string {
  if (v == null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
}
function formatCls(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(3);
}
function formatInp(v: number | null): string {
  if (v == null) return "—";
  return `${Math.round(v)}ms`;
}

function formatPercent(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

interface Props {
  rows: VitalsByPageRow[];
  loading: boolean;
}

export function WebVitalsByPageTable({ rows, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="p-3 flex gap-3 animate-pulse">
            <div className="h-4 flex-1 bg-[var(--bg-elevated)] rounded" />
            <div className="h-4 w-16 bg-[var(--bg-elevated)] rounded" />
            <div className="h-4 w-16 bg-[var(--bg-elevated)] rounded" />
            <div className="h-4 w-16 bg-[var(--bg-elevated)] rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
        Aucun échantillon collecté sur cette fenêtre. Le trafic réel
        n&apos;a pas encore généré de Web Vitals — vérifiez que le
        WebVitalsReporter est bien monté.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
      {/* Header — desktop only */}
      <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2 border-b border-[var(--border-gold)] text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        <span className="col-span-4">Page</span>
        <span className="col-span-1 text-right">N</span>
        <span className="col-span-2 text-right">LCP p75</span>
        <span className="col-span-2 text-right">CLS p75</span>
        <span className="col-span-2 text-right">INP p75</span>
        <span className="col-span-1 text-right">Mobile</span>
      </div>

      <ul className="divide-y divide-[var(--border-gold)]/30">
        {rows.map((row) => {
          const lcpTone = toneForLcp(row.lcp_p75);
          const clsTone = toneForCls(row.cls_p75);
          const inpTone = toneForInp(row.inp_p75);
          const worstTone: Tone =
            lcpTone === "bad" || clsTone === "bad" || inpTone === "bad"
              ? "bad"
              : lcpTone === "warn" || clsTone === "warn" || inpTone === "warn"
                ? "warn"
                : "good";
          const rowBg =
            worstTone === "bad"
              ? "bg-[var(--red)]/5"
              : worstTone === "warn"
                ? "bg-[var(--orange)]/5"
                : "";

          return (
            <li
              key={row.page_path}
              className={`px-4 py-3 grid grid-cols-1 md:grid-cols-12 gap-2 text-xs ${rowBg}`}
            >
              <div className="md:col-span-4 flex items-center gap-2 min-w-0">
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    worstTone === "bad"
                      ? "bg-[var(--red)]"
                      : worstTone === "warn"
                        ? "bg-[var(--orange)]"
                        : "bg-[var(--green)]"
                  }`}
                />
                <span
                  className="font-mono text-[var(--text-primary)] truncate"
                  title={row.page_path}
                >
                  {row.page_path}
                </span>
              </div>
              <span className="md:col-span-1 md:text-right font-mono text-[var(--text-secondary)]">
                <span className="md:hidden text-[10px] text-[var(--text-muted)]">N · </span>
                {row.sample_count.toLocaleString("fr-FR")}
              </span>
              <span className={`md:col-span-2 md:text-right font-mono ${colorClass(lcpTone)}`}>
                <span className="md:hidden text-[10px] text-[var(--text-muted)] font-normal">
                  LCP ·{" "}
                </span>
                {formatLcp(row.lcp_p75)}
                <span className="text-[10px] text-[var(--text-muted)] font-normal ml-1">
                  ({formatPercent(row.poor_rate_lcp)} poor)
                </span>
              </span>
              <span className={`md:col-span-2 md:text-right font-mono ${colorClass(clsTone)}`}>
                <span className="md:hidden text-[10px] text-[var(--text-muted)] font-normal">
                  CLS ·{" "}
                </span>
                {formatCls(row.cls_p75)}
              </span>
              <span className={`md:col-span-2 md:text-right font-mono ${colorClass(inpTone)}`}>
                <span className="md:hidden text-[10px] text-[var(--text-muted)] font-normal">
                  INP ·{" "}
                </span>
                {formatInp(row.inp_p75)}
              </span>
              <span className="md:col-span-1 md:text-right font-mono text-[var(--text-muted)]">
                <span className="md:hidden text-[10px] text-[var(--text-muted)]">Mob · </span>
                {formatPercent(row.mobile_share)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
