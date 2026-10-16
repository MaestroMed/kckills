import type { AdminDb } from "@/lib/admin/db";

/**
 * État du worker (server component) : vivant / en retard / arrêté d'après
 * le heartbeat (toutes les 5 min côté worker), compteurs du jour du
 * scheduler (Gemini, recherches YouTube) et dernier passage de chaque
 * module (pipeline_runs).
 *
 * Volontairement sans bouton de relance : le worker tourne sur le PC de
 * Mehdi, qui décide seul quand il consomme GPU, réseau et quota Gemini.
 */
const MODULES = [
  "sentinel", "harvester", "event_mapper", "transitioner", "vod_offset_finder",
  "clipper", "analyzer", "og_generator", "event_publisher", "embedder",
  "quote_extractor", "translator", "achievement_evaluator", "moderator",
  "discord_autopost", "hls_packager", "channel_discoverer", "channel_reconciler",
  "vod_fallback_finder", "match_planner", "qc_sampler", "job_runner",
  "job_dispatcher", "admin_job_runner", "heartbeat", "watchdog", "queue_health",
  "dlq_drainer", "kill_of_the_week",
];

interface Run {
  module_name: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  items_processed: number;
  items_failed: number;
  error_summary: string | null;
}

interface SchedulerStats {
  daily_counts?: Record<string, number>;
  daily_remaining?: Record<string, number>;
  daily_cost_usd?: Record<string, number>;
  daily_cost_remaining_usd?: Record<string, number>;
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} j`;
}

export async function WorkerStatus({ sb }: { sb: AdminDb }) {
  const now = Date.now();
  const [hb, ...runs] = await Promise.all([
    sb.from("health_checks").select("last_seen, metrics").eq("id", "worker_heartbeat").maybeSingle(),
    ...MODULES.map((m) =>
      sb
        .from("pipeline_runs")
        .select("module_name, started_at, ended_at, status, items_processed, items_failed, error_summary")
        .eq("module_name", m)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  ]);

  const lastSeen = hb.data?.last_seen as string | undefined;
  const ageMin = lastSeen ? (now - Date.parse(lastSeen)) / 60000 : Infinity;
  const state =
    ageMin <= 12 ? { label: "En marche", cls: "bg-[var(--green)]/15 text-[var(--green)]" }
    : ageMin <= 45 ? { label: "En retard", cls: "bg-[var(--orange)]/15 text-[var(--orange)]" }
    : { label: "Arrêté", cls: "bg-[var(--red)]/15 text-[var(--red)]" };
  const sched = ((hb.data?.metrics as { scheduler?: SchedulerStats } | null)?.scheduler ?? {}) as SchedulerStats;
  const moduleRuns = runs
    .map((r) => r.data as Run | null)
    .filter((r): r is Run => Boolean(r))
    .sort((a, b) => b.started_at.localeCompare(a.started_at));

  const gemCalls = sched.daily_counts?.gemini ?? 0;
  const gemLeft = sched.daily_remaining?.gemini;
  const gemCost = sched.daily_cost_usd?.gemini ?? 0;
  const gemCostLeft = sched.daily_cost_remaining_usd?.gemini;
  const ytLeft = sched.daily_remaining?.youtube_search;

  return (
    <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-widest text-[var(--gold)]">Worker</h2>
        <span className={`rounded-full px-2.5 py-0.5 font-data text-[10px] font-bold uppercase tracking-widest ${state.cls}`}>{state.label}</span>
        <span className="text-xs text-[var(--text-muted)]">
          {lastSeen ? `dernier signe de vie il y a ${ago(lastSeen, now)}` : "aucun signe de vie enregistré"}
          {" · "}relance : depuis le PC, par toi uniquement
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { k: "Appels Gemini (jour du worker)", v: gemCalls.toLocaleString("fr-FR"), s: gemLeft !== undefined ? `${gemLeft} restants` : null },
          { k: "Coût Gemini", v: `${gemCost.toFixed(2)} $`, s: gemCostLeft !== undefined ? `plafond restant ${gemCostLeft.toFixed(2)} $` : null },
          { k: "Recherches YouTube", v: (sched.daily_counts?.youtube_search ?? 0).toString(), s: ytLeft !== undefined ? `${ytLeft} restantes` : null },
          { k: "Modules vus", v: `${moduleRuns.length} / ${MODULES.length}`, s: "dernier passage connu" },
        ].map((t) => (
          <div key={t.k} className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2">
            <dt className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">{t.k}</dt>
            <dd className="font-data text-lg font-bold tabular-nums text-[var(--text-primary)]">{t.v}</dd>
            {t.s && <dd className="text-[10px] text-[var(--text-muted)]">{t.s}</dd>}
          </div>
        ))}
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              <th className="py-1.5 pr-3 font-normal">Module</th>
              <th className="py-1.5 pr-3 font-normal">Dernier passage</th>
              <th className="py-1.5 pr-3 font-normal">Statut</th>
              <th className="py-1.5 pr-3 text-right font-normal">Traités</th>
              <th className="py-1.5 font-normal">Dernière erreur</th>
            </tr>
          </thead>
          <tbody>
            {moduleRuns.map((r) => (
              <tr key={r.module_name} className="border-t border-[var(--border-subtle)] align-top">
                <td className="py-1.5 pr-3 font-mono text-[var(--text-secondary)]">{r.module_name}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-[var(--text-muted)]">il y a {ago(r.started_at, now)}</td>
                <td className={`py-1.5 pr-3 ${r.status === "succeeded" ? "text-[var(--green)]" : r.status === "running" ? "text-[var(--cyan)]" : "text-[var(--red)]"}`}>{r.status}</td>
                <td className="py-1.5 pr-3 text-right font-data tabular-nums">
                  {r.items_processed}
                  {r.items_failed > 0 && <span className="text-[var(--red)]"> / {r.items_failed} ✕</span>}
                </td>
                <td className="py-1.5 max-w-[28rem] truncate text-[var(--text-muted)]" title={r.error_summary ?? undefined}>{r.error_summary ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
