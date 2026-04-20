"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  status: string;
  retry_count: number;
  requested_by_actor: string | null;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
}

const STATUSES = ["pending", "running", "completed", "failed", "cancelled"];

export function JobsQueue() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    params.set("limit", "100");
    try {
      const r = await fetch(`/api/admin/pipeline/jobs?${params}`);
      if (r.ok) {
        const data = await r.json();
        setJobs(data.items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void fetchJobs();
    const id = window.setInterval(fetchJobs, 5000); // poll every 5s
    return () => window.clearInterval(id);
  }, [fetchJobs]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/admin/pipeline" className="text-xs text-[var(--text-muted)] hover:text-[var(--gold)]">
            ← Pipeline
          </Link>
          <h1 className="font-display text-2xl font-black text-[var(--gold)] mt-1">Job Queue</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{jobs.length} jobs · poll every 5s</p>
        </div>
        <Link href="/admin/pipeline/trigger" className="rounded-md bg-[var(--gold)] px-3 py-1.5 text-xs font-bold text-black">
          Nouveau job
        </Link>
      </header>

      {/* Status filter */}
      <div className="flex gap-1">
        <button
          onClick={() => setStatusFilter("")}
          className={`rounded-full px-3 py-1 text-xs font-bold border ${
            !statusFilter ? "bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold)]" : "border-[var(--border-gold)] text-[var(--text-muted)]"
          }`}
        >
          Tous
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-bold border ${
              statusFilter === s ? "bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold)]" : "border-[var(--border-gold)] text-[var(--text-muted)]"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading && jobs.length === 0 ? (
        <p className="text-center text-[var(--text-muted)] py-8">Chargement...</p>
      ) : jobs.length === 0 ? (
        <p className="text-center text-[var(--text-muted)] py-8">Aucun job.</p>
      ) : (
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-elevated)] border-b border-[var(--border-gold)] text-left">
              <tr>
                <th className="px-3 py-2 w-24">Status</th>
                <th className="px-3 py-2 w-40">Kind</th>
                <th className="px-3 py-2">Payload</th>
                <th className="px-3 py-2 w-32">Requested</th>
                <th className="px-3 py-2 w-32">Completed</th>
                <th className="px-3 py-2 w-12">Retry</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-[var(--border-gold)]/20">
                  <td className="px-3 py-2"><StatusBadge status={job.status} /></td>
                  <td className="px-3 py-2 font-mono text-[var(--gold)]">{job.kind}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)] font-mono text-[10px]">
                    {Object.keys(job.payload).length === 0 ? "—" : JSON.stringify(job.payload)}
                    {job.error && <span className="text-[var(--red)] ml-2">⚠ {job.error.slice(0, 60)}</span>}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)] text-[10px]">
                    {new Date(job.requested_at).toLocaleString("fr-FR")}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)] text-[10px]">
                    {job.completed_at ? new Date(job.completed_at).toLocaleString("fr-FR") : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono">{job.retry_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
