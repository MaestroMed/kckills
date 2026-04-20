import { createServerSupabase } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pipeline — Admin",
  robots: { index: false, follow: false },
};

export default async function PipelinePage() {
  const sb = await createServerSupabase();

  const [heartbeat, recentJobs, pendingCount, runningCount, kdaStats] = await Promise.all([
    sb.from("health_checks").select("*").eq("id", "worker_heartbeat").maybeSingle(),
    sb.from("worker_jobs").select("*").order("requested_at", { ascending: false }).limit(10),
    sb.from("worker_jobs").select("id", { count: "exact" }).eq("status", "pending"),
    sb.from("worker_jobs").select("id", { count: "exact" }).eq("status", "running"),
    sb.from("kills").select("status", { count: "exact" }).eq("status", "raw"),
  ]);

  const hb = heartbeat.data;
  const lastSeenMs = hb?.last_seen ? new Date(hb.last_seen).getTime() : 0;
  const ageMin = lastSeenMs ? Math.round((Date.now() - lastSeenMs) / 60000) : null;
  const isHealthy = ageMin !== null && ageMin < 10;

  const metrics = (hb?.metrics as Record<string, unknown> | null) ?? {};
  const scheduler = (metrics.scheduler as Record<string, unknown> | undefined) ?? {};
  const dailyRemaining = (scheduler.daily_remaining as Record<string, number> | undefined) ?? {};

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">Pipeline</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Worker daemon status + job queue</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/pipeline/jobs" className="rounded-md border border-[var(--border-gold)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--gold)]">
            Job Queue ({pendingCount.count ?? 0})
          </Link>
          <Link href="/admin/pipeline/trigger" className="rounded-md bg-[var(--gold)] px-3 py-1.5 text-xs font-bold text-black">
            Trigger Job
          </Link>
        </div>
      </header>

      {/* Heartbeat status */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`rounded-xl border p-4 ${isHealthy ? "border-[var(--green)]/40 bg-[var(--green)]/5" : "border-[var(--red)]/40 bg-[var(--red)]/5"}`}>
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Daemon Status</p>
          <p className={`font-display text-2xl font-black mt-1 ${isHealthy ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
            {isHealthy ? "● HEALTHY" : "● OFFLINE"}
          </p>
          {ageMin !== null && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Last ping: {ageMin < 1 ? "just now" : ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Jobs en attente</p>
          <p className="font-display text-2xl font-black mt-1 text-[var(--gold)]">{pendingCount.count ?? 0}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">{runningCount.count ?? 0} en cours</p>
        </div>

        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Kills à processer</p>
          <p className="font-display text-2xl font-black mt-1 text-[var(--orange)]">{kdaStats.count ?? 0}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">en status &apos;raw&apos;</p>
        </div>
      </section>

      {/* Scheduler quotas */}
      {Object.keys(dailyRemaining).length > 0 && (
        <section>
          <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
            Quotas API (reset 07:00 UTC)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(dailyRemaining).map(([service, remaining]) => (
              <div key={service} className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3">
                <p className="text-[10px] text-[var(--text-muted)] uppercase">{service}</p>
                <p className="font-mono text-lg font-bold text-[var(--gold)] mt-0.5">{remaining}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent jobs */}
      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Jobs récents
        </h2>
        {!recentJobs.data || recentJobs.data.length === 0 ? (
          <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
            Aucun job. <Link href="/admin/pipeline/trigger" className="text-[var(--gold)] hover:underline">Lancer un job →</Link>
          </p>
        ) : (
          <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30">
            {recentJobs.data.map((job) => (
              <div key={job.id} className="px-3 py-2 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <StatusBadge status={job.status} />
                  <span className="font-mono text-[var(--gold)]">{job.kind}</span>
                  <span className="text-[var(--text-muted)] truncate">
                    {JSON.stringify(job.payload).slice(0, 60)}
                  </span>
                </div>
                <span className="text-[var(--text-muted)] whitespace-nowrap">
                  {new Date(job.requested_at).toLocaleString("fr-FR")}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-[var(--orange)]/20 text-[var(--orange)] border-[var(--orange)]/40",
    running: "bg-[var(--cyan)]/20 text-[var(--cyan)] border-[var(--cyan)]/40 animate-pulse",
    completed: "bg-[var(--green)]/20 text-[var(--green)] border-[var(--green)]/40",
    failed: "bg-[var(--red)]/20 text-[var(--red)] border-[var(--red)]/40",
    cancelled: "bg-[var(--text-muted)]/20 text-[var(--text-muted)] border-[var(--text-muted)]/40",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${colors[status] ?? colors.pending}`}>
      {status}
    </span>
  );
}
