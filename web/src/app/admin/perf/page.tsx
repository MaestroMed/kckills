"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { VitalsResponse, VitalStats } from "@/app/api/admin/perf/vitals/route";
import type { VitalsByPageResponse } from "@/app/api/admin/perf/vitals-by-page/route";
import { WebVitalsByPageTable } from "@/components/admin/WebVitalsByPageTable";

/**
 * /admin/perf — Real-User-Monitoring detail page.
 *
 * Surfaces the full Web Vitals breakdown collected by WebVitalsReporter
 * (Wave 9 / Agent AL). The dashboard tile (WebVitalsTile) gives the
 * 3-metric headline ; this page shows :
 *   - All 5 metrics (LCP/CLS/INP/FCP/TTFB) with p50/p75/p95
 *   - Rating distribution histograms (good / NI / poor)
 *   - Top 10 worst pages by sample count
 *   - Window toggle : 24h ↔ 7d
 *
 * Client component because we want a window toggle without a full page
 * reload, and the auto-refresh + loading/error states are easier to
 * orchestrate client-side. The two API endpoints already handle auth
 * server-side via requireAdmin().
 */

type WindowKey = "24h" | "7d";

export default function AdminPerfPage() {
  const [windowKey, setWindowKey] = useState<WindowKey>("24h");
  const [vitals, setVitals] = useState<VitalsResponse | null>(null);
  const [byPage, setByPage] = useState<VitalsByPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchAll = async () => {
      try {
        const [vRes, pRes] = await Promise.all([
          fetch(`/api/admin/perf/vitals?window=${windowKey}`, { cache: "no-store" }),
          fetch(`/api/admin/perf/vitals-by-page?window=${windowKey}&limit=10`, { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (!vRes.ok) {
          setError(`Vitals HTTP ${vRes.status}`);
          setLoading(false);
          return;
        }
        if (!pRes.ok) {
          setError(`By-page HTTP ${pRes.status}`);
          setLoading(false);
          return;
        }
        const vBody: VitalsResponse = await vRes.json();
        const pBody: VitalsByPageResponse = await pRes.json();
        if (cancelled) return;
        setVitals(vBody);
        setByPage(pBody);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "fetch failed");
          setLoading(false);
        }
      }
    };

    void fetchAll();

    // Auto-refresh every 60s — same cadence as the dashboard tile.
    const id = window.setInterval(() => {
      void fetchAll();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [windowKey]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-black text-[var(--gold)]">
            Web Vitals · RUM
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Performance perçue par les utilisateurs réels (terrain, pas Lighthouse)
          </p>
        </div>
        <nav className="flex items-center gap-2">
          <Link
            href="/admin"
            className="rounded-md border border-[var(--border-gold)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40"
          >
            ← Dashboard
          </Link>
          <WindowToggle value={windowKey} onChange={setWindowKey} />
        </nav>
      </header>

      {error ? (
        <div className="rounded-xl border border-[var(--red)]/40 bg-[var(--red)]/10 p-4">
          <p className="text-sm text-[var(--red)]">Erreur : {error}</p>
        </div>
      ) : null}

      {/* Headline strip — 5 metrics */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Vue d&apos;ensemble · {windowKey === "7d" ? "7 jours" : "24 heures"}
            </h2>
            <p className="text-[11px] text-[var(--text-disabled)] mt-0.5">
              {vitals
                ? `${vitals.sample_count.toLocaleString("fr-FR")} échantillons collectés`
                : "Chargement…"}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <MetricCard label="LCP" sub="Largest Contentful Paint" stats={vitals?.lcp ?? null} kind="ms" loading={loading} />
          <MetricCard label="CLS" sub="Cumulative Layout Shift" stats={vitals?.cls ?? null} kind="cls" loading={loading} />
          <MetricCard label="INP" sub="Interaction to Next Paint" stats={vitals?.inp ?? null} kind="ms" loading={loading} />
          <MetricCard label="FCP" sub="First Contentful Paint" stats={vitals?.fcp ?? null} kind="ms" loading={loading} />
          <MetricCard label="TTFB" sub="Time to First Byte" stats={vitals?.ttfb ?? null} kind="ms" loading={loading} />
        </div>
      </section>

      {/* Rating distribution bars */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Répartition par seuil Google
            </h2>
            <p className="text-[11px] text-[var(--text-disabled)] mt-0.5">
              Vert = bon · Orange = à améliorer · Rouge = mauvais (selon Google web.dev)
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 space-y-4">
          {(["LCP", "CLS", "INP", "FCP", "TTFB"] as const).map((m) => {
            const stats = vitals == null
              ? null
              : m === "LCP"
                ? vitals.lcp
                : m === "CLS"
                  ? vitals.cls
                  : m === "INP"
                    ? vitals.inp
                    : m === "FCP"
                      ? vitals.fcp
                      : vitals.ttfb;
            return <RatingBar key={m} label={m} stats={stats} />;
          })}
        </div>
      </section>

      {/* Top 10 pages */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Top 10 pages par volume d&apos;échantillons
            </h2>
            <p className="text-[11px] text-[var(--text-disabled)] mt-0.5">
              Triées par nombre de samples — les pages les plus vues en premier
            </p>
          </div>
          {byPage ? (
            <span className="text-[10px] text-[var(--text-muted)]">
              {byPage.total_pages} pages distinctes
            </span>
          ) : null}
        </div>
        <WebVitalsByPageTable rows={byPage?.pages ?? []} loading={loading} />
      </section>

      {/* Footnote */}
      <p className="text-[10px] text-[var(--text-disabled)] text-center pt-4">
        Données collectées via la lib web-vitals de Google · Reset à chaque rafraîchissement (60s)
        · Les seuils suivent les recommandations officielles de web.dev (avril 2026)
      </p>
    </div>
  );
}

function WindowToggle({ value, onChange }: { value: WindowKey; onChange: (v: WindowKey) => void }) {
  return (
    <div className="inline-flex rounded-md border border-[var(--border-gold)] overflow-hidden">
      <button
        onClick={() => onChange("24h")}
        className={`px-3 py-1.5 text-xs transition-colors ${
          value === "24h"
            ? "bg-[var(--gold)]/15 text-[var(--gold)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
        }`}
      >
        24h
      </button>
      <button
        onClick={() => onChange("7d")}
        className={`px-3 py-1.5 text-xs transition-colors border-l border-[var(--border-gold)] ${
          value === "7d"
            ? "bg-[var(--gold)]/15 text-[var(--gold)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
        }`}
      >
        7 jours
      </button>
    </div>
  );
}

const THRESHOLDS: Record<string, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  CLS: { good: 0.1, poor: 0.25 },
  INP: { good: 200, poor: 500 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

type Tone = "good" | "warn" | "bad" | "neutral";

function toneFor(metric: string, p75: number | null): Tone {
  const t = THRESHOLDS[metric];
  if (!t || p75 == null) return "neutral";
  if (p75 <= t.good) return "good";
  if (p75 < t.poor) return "warn";
  return "bad";
}

function formatBy(kind: "ms" | "cls", v: number | null): string {
  if (v == null) return "—";
  if (kind === "cls") return v.toFixed(3);
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
}

function MetricCard({
  label,
  sub,
  stats,
  kind,
  loading,
}: {
  label: string;
  sub: string;
  stats: VitalStats | null;
  kind: "ms" | "cls";
  loading: boolean;
}) {
  const tone = toneFor(label, stats?.p75 ?? null);
  const colors: Record<Tone, { border: string; text: string }> = {
    good: { border: "border-[var(--green)]/40", text: "text-[var(--green)]" },
    warn: { border: "border-[var(--orange)]/40", text: "text-[var(--orange)]" },
    bad: { border: "border-[var(--red)]/40", text: "text-[var(--red)]" },
    neutral: { border: "border-[var(--border-gold)]", text: "text-[var(--text-muted)]" },
  };
  const c = colors[tone];

  return (
    <div className={`rounded-xl border ${c.border} bg-[var(--bg-surface)] p-4 flex flex-col gap-2 min-h-[140px]`}>
      <div>
        <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">{label}</p>
        <p className="text-[10px] text-[var(--text-disabled)]">{sub}</p>
      </div>
      {loading ? (
        <div className="h-9 w-24 rounded bg-[var(--bg-elevated)] animate-pulse" />
      ) : (
        <p className={`font-display text-3xl font-black leading-none ${c.text}`}>
          {formatBy(kind, stats?.p75 ?? null)}
        </p>
      )}
      <div className="grid grid-cols-3 gap-1 text-[10px] mt-auto pt-2">
        <PercentileChip label="p50" v={formatBy(kind, stats?.p50 ?? null)} />
        <PercentileChip label="p75" v={formatBy(kind, stats?.p75 ?? null)} highlight />
        <PercentileChip label="p95" v={formatBy(kind, stats?.p95 ?? null)} />
      </div>
      <p className="text-[10px] text-[var(--text-muted)] font-mono">
        n = {stats?.sample_count.toLocaleString("fr-FR") ?? 0}
      </p>
    </div>
  );
}

function PercentileChip({ label, v, highlight }: { label: string; v: string; highlight?: boolean }) {
  return (
    <div
      className={`text-center rounded px-1 py-0.5 ${
        highlight
          ? "bg-[var(--bg-elevated)] border border-[var(--border-gold)]/50"
          : ""
      }`}
    >
      <span className="block text-[8px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </span>
      <span className="block font-mono text-[10px] text-[var(--text-secondary)]">{v}</span>
    </div>
  );
}

function RatingBar({ label, stats }: { label: string; stats: VitalStats | null }) {
  if (stats == null || stats.sample_count === 0) {
    return (
      <div className="flex items-center gap-3">
        <span className="w-12 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          {label}
        </span>
        <div className="flex-1 h-3 rounded-full bg-[var(--bg-elevated)]" />
        <span className="w-16 text-right text-[10px] font-mono text-[var(--text-disabled)]">—</span>
      </div>
    );
  }

  const { good, ni, poor } = stats.rating_distribution;
  const goodPct = Math.round(good * 100);
  const niPct = Math.round(ni * 100);
  const poorPct = Math.round(poor * 100);

  return (
    <div className="flex items-center gap-3">
      <span className="w-12 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </span>
      <div className="flex-1 h-3 rounded-full overflow-hidden flex bg-[var(--bg-elevated)]">
        <div
          className="bg-[var(--green)] transition-all"
          style={{ width: `${goodPct}%` }}
          title={`${goodPct}% bon`}
        />
        <div
          className="bg-[var(--orange)] transition-all"
          style={{ width: `${niPct}%` }}
          title={`${niPct}% à améliorer`}
        />
        <div
          className="bg-[var(--red)] transition-all"
          style={{ width: `${poorPct}%` }}
          title={`${poorPct}% mauvais`}
        />
      </div>
      <span className="w-32 text-right text-[10px] font-mono text-[var(--text-secondary)]">
        <span className="text-[var(--green)]">{goodPct}%</span> ·{" "}
        <span className="text-[var(--orange)]">{niPct}%</span> ·{" "}
        <span className="text-[var(--red)]">{poorPct}%</span>
      </span>
    </div>
  );
}
