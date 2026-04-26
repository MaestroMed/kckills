"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { VitalsResponse, VitalStats } from "@/app/api/admin/perf/vitals/route";

/**
 * WebVitalsTile — 5th tile on the /admin live dashboard.
 *
 * Why a stand-alone component instead of reusing KpiTile ?
 *   KpiTile is a single-value-with-sparkline shape ; vitals naturally
 *   want THREE values (LCP, CLS, INP) inside one tile, each with its
 *   own Google-threshold-based color. Stuffing that into KpiTile's
 *   "label + big number" slot would either (a) hide two of the three
 *   metrics or (b) render a string like "1.8s / 0.05 / 180ms" that's
 *   unreadable at a glance. The card chrome (border, padding, fonts)
 *   matches KpiTile so the row stays visually homogeneous.
 *
 * Auto-refresh : 60s (vs 30s for the other tiles). Vitals data moves
 * slowly — a single sample per metric per page load — and the API has
 * a 60s server cache so faster polling would hit the cache anyway.
 *
 * Click → /admin/perf for the full breakdown (per-page table, trend
 * lines, mobile-vs-desktop split, etc.).
 */
export function WebVitalsTile() {
  const [data, setData] = useState<VitalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchVitals = async () => {
      try {
        const r = await fetch("/api/admin/perf/vitals", { cache: "no-store" });
        if (cancelled) return;
        if (!r.ok) {
          setError(`HTTP ${r.status}`);
          return;
        }
        const body: VitalsResponse = await r.json();
        if (cancelled) return;
        setData(body);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed");
      }
    };

    void fetchVitals();
    const id = window.setInterval(() => {
      void fetchVitals();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const loading = data == null && error == null;
  const hasNoData = data != null && data.sample_count === 0;

  return (
    <Link
      href="/admin/perf"
      className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 flex flex-col gap-2 min-h-[112px] hover:border-[var(--gold)]/40 hover:bg-[var(--bg-elevated)]/30 transition-colors group"
      aria-label="Voir les Web Vitals détaillés"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] truncate">
          Web Vitals · 24h
        </p>
        <span className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--gold)] transition-colors">
          détails →
        </span>
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[11px] text-[var(--red)]">Erreur · {error}</p>
        </div>
      ) : loading ? (
        <div className="flex-1 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-12 rounded bg-[var(--bg-elevated)] animate-pulse"
              aria-label="Chargement"
            />
          ))}
        </div>
      ) : hasNoData ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <p className="text-[11px] text-[var(--text-muted)]">Aucun échantillon</p>
          <p className="text-[10px] text-[var(--text-disabled)] mt-0.5">
            En attente de trafic réel
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <MiniMetric metric="LCP" stats={data!.lcp} />
          <MiniMetric metric="CLS" stats={data!.cls} />
          <MiniMetric metric="INP" stats={data!.inp} />
        </div>
      )}

      {data && data.sample_count > 0 ? (
        <p
          className="text-[11px] text-[var(--text-muted)] mt-auto truncate"
          title={`${data.sample_count} samples sur 24h`}
        >
          {data.sample_count.toLocaleString("fr-FR")} échantillons · p75
        </p>
      ) : (
        <p className="text-[11px] text-[var(--text-disabled)] mt-auto">—</p>
      )}
    </Link>
  );
}

/** Google's official Core Web Vitals thresholds (April 2026). */
const THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 },   // ms
  CLS: { good: 0.1, poor: 0.25 },    // unitless
  INP: { good: 200, poor: 500 },     // ms
} as const;

type MetricKey = keyof typeof THRESHOLDS;

type Tone = "good" | "warn" | "bad" | "neutral";

function toneFor(metric: MetricKey, p75: number | null): Tone {
  if (p75 == null) return "neutral";
  const { good, poor } = THRESHOLDS[metric];
  if (p75 <= good) return "good";
  if (p75 < poor) return "warn";
  return "bad";
}

function formatValue(metric: MetricKey, p75: number | null): string {
  if (p75 == null) return "—";
  if (metric === "CLS") return p75.toFixed(2);
  if (metric === "LCP") {
    return p75 >= 1000 ? `${(p75 / 1000).toFixed(2)}s` : `${Math.round(p75)}ms`;
  }
  // INP, ms
  return `${Math.round(p75)}ms`;
}

function MiniMetric({ metric, stats }: { metric: MetricKey; stats: VitalStats }) {
  const tone = toneFor(metric, stats.p75);
  const colors: Record<Tone, { text: string; border: string; bg: string }> = {
    good: {
      text: "text-[var(--green)]",
      border: "border-[var(--green)]/40",
      bg: "bg-[var(--green)]/5",
    },
    warn: {
      text: "text-[var(--orange)]",
      border: "border-[var(--orange)]/40",
      bg: "bg-[var(--orange)]/5",
    },
    bad: {
      text: "text-[var(--red)]",
      border: "border-[var(--red)]/40",
      bg: "bg-[var(--red)]/5",
    },
    neutral: {
      text: "text-[var(--text-muted)]",
      border: "border-[var(--border-gold)]",
      bg: "",
    },
  };
  const c = colors[tone];

  return (
    <div
      className={`rounded-md border ${c.border} ${c.bg} px-2 py-1.5 flex flex-col items-center justify-center min-h-[48px]`}
    >
      <span className="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
        {metric}
      </span>
      <span className={`font-mono font-bold text-sm leading-tight ${c.text}`}>
        {formatValue(metric, stats.p75)}
      </span>
    </div>
  );
}
