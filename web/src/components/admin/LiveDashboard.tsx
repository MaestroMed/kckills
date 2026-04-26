"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { KpiTile, type KpiTone } from "./KpiTile";
import { WebVitalsTile } from "./WebVitalsTile";
import type { DashboardKpis } from "@/app/api/admin/dashboard/kpis/route";
import type { ModuleHealth } from "@/app/api/admin/dashboard/health/route";

/**
 * LiveDashboard — client component that owns the auto-refresh loop.
 *
 * Lives at the top of /admin. Fetches both /kpis and /health, refreshes
 * /kpis every 30s and /health every 60s. Shows a tiny "last refresh"
 * pill so the operator knows the data is live (not a stale CDN cache).
 *
 * SSR shell : the parent server component renders the surrounding chrome
 * (header, nav links, recent activity). This component handles ONLY the
 * 4 tiles + the per-module table.
 */
export function LiveDashboard() {
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [health, setHealth] = useState<ModuleHealth[]>([]);
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Single auto-refresh loop — fetch KPIs every 30s, health every 60s.
  // Health is staggered (60s) because per-module aggregation is heavier
  // and changes slower than the headline KPIs.
  useEffect(() => {
    let cancelled = false;
    let healthTickCount = 0;

    const fetchKpis = async () => {
      try {
        const r = await fetch("/api/admin/dashboard/kpis", { cache: "no-store" });
        if (cancelled) return;
        if (!r.ok) {
          setError(`KPIs HTTP ${r.status}`);
          return;
        }
        const data: DashboardKpis = await r.json();
        if (cancelled) return;
        setKpis(data);
        setLastRefresh(new Date());
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed");
      }
    };

    const fetchHealth = async () => {
      try {
        const r = await fetch("/api/admin/dashboard/health", { cache: "no-store" });
        if (cancelled || !r.ok) return;
        const data: { items: ModuleHealth[] } = await r.json();
        if (!cancelled) {
          setHealth(data.items ?? []);
          setHealthLoaded(true);
        }
      } catch {
        if (!cancelled) setHealthLoaded(true);
      }
    };

    void fetchKpis();
    void fetchHealth();

    const id = window.setInterval(() => {
      void fetchKpis();
      // Health every other tick = 60s.
      healthTickCount = (healthTickCount + 1) % 2;
      if (healthTickCount === 0) void fetchHealth();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const loading = kpis == null;

  return (
    <>
      {/* Header strip — title + freshness pill */}
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            Indicateurs en direct
          </h2>
          <p className="text-[11px] text-[var(--text-disabled)] mt-0.5">
            Auto-refresh toutes les 30s — les sparklines couvrent les 24 dernières heures.
          </p>
        </div>
        <FreshnessPill lastRefresh={lastRefresh} error={error} />
      </div>

      {/* ─── Hero KPIs ──────────────────────────────────────────── */}
      {/* Wave 11 / Agent DG : ajout du 5e tile (Web Vitals).
          La grille passe de 4 à 5 colonnes sur xl pour rester homogène,
          stacke 2 par ligne sur sm/md, et 1 par ligne en mobile. */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiTile
          label="Kills publiés (24h)"
          value={kpis?.kills24h ?? null}
          sparkline={kpis?.sparklines.kills ?? []}
          delta={kpis?.deltas.kills24h ?? null}
          tone="neutral"
          sub="updated_at < 24h"
          loading={loading}
        />
        <KpiTile
          label="Cadence (60 min)"
          value={kpis?.clipRate ?? null}
          sparkline={kpis?.sparklines.clipRate ?? []}
          delta={kpis?.deltas.clipRate ?? null}
          tone={
            kpis == null
              ? "neutral"
              : kpis.clipRate === 0
                ? "warn"
                : kpis.clipRate >= 5
                  ? "good"
                  : "neutral"
          }
          sub="kills publiés / heure"
          loading={loading}
        />
        <KpiTile
          label="File d’attente"
          value={kpis?.queueDepth ?? null}
          sparkline={kpis?.sparklines.queue ?? []}
          delta={kpis?.deltas.queueDepth ?? null}
          invertDelta
          tone={
            kpis == null
              ? "neutral"
              : kpis.queueDepth > 200
                ? "bad"
                : kpis.queueDepth > 50
                  ? "warn"
                  : "good"
          }
          sub="pending + claimed (pipeline_jobs)"
          loading={loading}
        />
        <KpiTile
          label="Dead letter (24h)"
          value={kpis?.dlqCount ?? null}
          sparkline={kpis?.sparklines.dlq ?? []}
          delta={kpis?.deltas.dlqCount ?? null}
          invertDelta
          tone={
            kpis == null
              ? "neutral"
              : kpis.dlqCount === 0
                ? "good"
                : kpis.dlqCount < 10
                  ? "warn"
                  : "bad"
          }
          sub="failures non triées sur 24h"
          loading={loading}
        />
        {/* Wave 11 / Agent DG — RUM Web Vitals tile.
            Auto-refresh independent (60s vs 30s ici) — vitals data
            change peu donc pas besoin de polluer la fenêtre Network. */}
        <WebVitalsTile />
      </section>

      {/* ─── Per-module health table ─────────────────────────────── */}
      <section className="mt-8">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Santé des modules · 24h
            </h2>
            <p className="text-[11px] text-[var(--text-disabled)] mt-0.5">
              Triés par défaillances (pire en haut). Cliquez pour voir le détail des jobs.
            </p>
          </div>
          <Link
            href="/admin/pipeline"
            className="text-[10px] text-[var(--cyan)] hover:underline whitespace-nowrap"
          >
            Vue 1h détaillée →
          </Link>
        </div>

        <HealthTable health={health} loading={!healthLoaded} />
      </section>
    </>
  );
}

function FreshnessPill({
  lastRefresh,
  error,
}: {
  lastRefresh: Date | null;
  error: string | null;
}) {
  const [, setTick] = useState(0);
  // Force a re-render every 5s so the relative time stays accurate
  // between data fetches (otherwise "1s ago" would freeze for 30s).
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 5_000);
    return () => window.clearInterval(id);
  }, []);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-1">
        <span className="h-2 w-2 rounded-full bg-[var(--red)] animate-pulse" />
        <span className="text-[10px] uppercase tracking-widest text-[var(--red)]">
          Erreur
        </span>
        <span className="text-[10px] font-mono text-[var(--text-secondary)] truncate max-w-[200px]">
          {error}
        </span>
      </div>
    );
  }

  if (!lastRefresh) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-[var(--border-gold)] bg-[var(--bg-elevated)]/60 px-3 py-1">
        <span className="h-2 w-2 rounded-full bg-[var(--text-muted)] animate-pulse" />
        <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          Chargement…
        </span>
      </div>
    );
  }

  const ageS = Math.max(0, Math.round((Date.now() - lastRefresh.getTime()) / 1000));
  const stale = ageS > 90;
  const label = ageS < 5 ? "à l’instant" : ageS < 60 ? `il y a ${ageS}s` : `il y a ${Math.round(ageS / 60)}m`;

  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
        stale
          ? "border-[var(--orange)]/40 bg-[var(--orange)]/10"
          : "border-[var(--green)]/40 bg-[var(--green)]/10"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${stale ? "bg-[var(--orange)]" : "bg-[var(--green)] animate-pulse"}`}
      />
      <span
        className={`text-[10px] uppercase tracking-widest ${stale ? "text-[var(--orange)]" : "text-[var(--green)]"}`}
      >
        Live
      </span>
      <span className="text-[10px] font-mono text-[var(--text-secondary)]">{label}</span>
    </div>
  );
}

function HealthTable({ health, loading }: { health: ModuleHealth[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="p-3 flex gap-3 animate-pulse">
            <div className="h-4 w-32 bg-[var(--bg-elevated)] rounded" />
            <div className="h-4 w-16 bg-[var(--bg-elevated)] rounded" />
            <div className="h-4 w-16 bg-[var(--bg-elevated)] rounded" />
            <div className="h-4 flex-1 bg-[var(--bg-elevated)] rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (health.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
        Aucun run loggé sur 24h. Le worker tourne-t-il ?
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
      {/* Header — desktop only, table-like */}
      <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2 border-b border-[var(--border-gold)] text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        <span className="col-span-3">Module</span>
        <span className="col-span-1 text-right">Runs</span>
        <span className="col-span-2 text-right">Succès</span>
        <span className="col-span-1 text-right">p50</span>
        <span className="col-span-1 text-right">p95</span>
        <span className="col-span-2 text-right">Dernier run</span>
        <span className="col-span-2">Dernière erreur</span>
      </div>

      <ul className="divide-y divide-[var(--border-gold)]/30">
        {health.map((m) => (
          <HealthRow key={m.module} m={m} />
        ))}
      </ul>
    </div>
  );
}

function HealthRow({ m }: { m: ModuleHealth }) {
  const ratePct = Math.round(m.successRate * 100);
  const tone: KpiTone =
    m.runs === 0
      ? "neutral"
      : ratePct >= 95
        ? "good"
        : ratePct >= 80
          ? "warn"
          : "bad";
  const bg: Record<KpiTone, string> = {
    neutral: "",
    good: "hover:bg-[var(--green)]/5",
    warn: "bg-[var(--orange)]/5 hover:bg-[var(--orange)]/10",
    bad: "bg-[var(--red)]/5 hover:bg-[var(--red)]/10",
  };
  const text: Record<KpiTone, string> = {
    neutral: "text-[var(--text-muted)]",
    good: "text-[var(--green)]",
    warn: "text-[var(--orange)]",
    bad: "text-[var(--red)]",
  };

  // Drill-down link — /admin/pipeline/jobs filters by `kind`.
  // Some modules don't 1-to-1 map to job kinds (e.g. heartbeat) but the
  // page tolerates an unknown kind by showing an empty result.
  const drilldown = `/admin/pipeline/jobs?kind=${encodeURIComponent(m.module)}`;

  return (
    <li>
      <Link
        href={drilldown}
        className={`block px-4 py-3 grid grid-cols-1 md:grid-cols-12 gap-2 text-xs transition-colors ${bg[tone]}`}
      >
        <div className="md:col-span-3 flex items-center gap-2 min-w-0">
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${
              tone === "bad"
                ? "bg-[var(--red)] animate-pulse"
                : tone === "warn"
                  ? "bg-[var(--orange)]"
                  : tone === "good"
                    ? "bg-[var(--green)]"
                    : "bg-[var(--text-muted)]"
            }`}
          />
          <span className="font-mono font-bold text-[var(--text-primary)] truncate">
            {m.module}
          </span>
        </div>
        <span className="md:col-span-1 md:text-right font-mono text-[var(--text-secondary)]">
          <span className="md:hidden text-[10px] text-[var(--text-muted)]">Runs · </span>
          {m.runs}
        </span>
        <span className={`md:col-span-2 md:text-right font-mono font-bold ${text[tone]}`}>
          <span className="md:hidden text-[10px] text-[var(--text-muted)] font-normal">
            Succès ·{" "}
          </span>
          {ratePct}%
          <span className="text-[10px] text-[var(--text-muted)] font-normal">
            {" "}
            ({m.succeeded}/{m.runs}
            {m.failed > 0 ? ` · ${m.failed} ko` : ""})
          </span>
        </span>
        <span className="md:col-span-1 md:text-right font-mono text-[var(--cyan)]">
          <span className="md:hidden text-[10px] text-[var(--text-muted)]">p50 · </span>
          {formatDuration(m.p50)}
        </span>
        <span className="md:col-span-1 md:text-right font-mono text-[var(--cyan)]">
          <span className="md:hidden text-[10px] text-[var(--text-muted)]">p95 · </span>
          {formatDuration(m.p95)}
        </span>
        <span className="md:col-span-2 md:text-right text-[10px] text-[var(--text-muted)] whitespace-nowrap">
          {m.lastRun ? relativeTime(m.lastRun) : "—"}
        </span>
        <span className="md:col-span-2 text-[10px] text-[var(--text-secondary)] truncate" title={m.lastError ?? ""}>
          {m.lastError ?? <span className="text-[var(--text-disabled)]">—</span>}
        </span>
      </Link>
    </li>
  );
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 60_000) return `il y a ${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `il y a ${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `il y a ${Math.round(ms / 3_600_000)}h`;
  return `il y a ${Math.round(ms / 86_400_000)}j`;
}
