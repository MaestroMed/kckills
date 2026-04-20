"use client";

import { useEffect, useState } from "react";

/**
 * HeartbeatPill — visual indicator of worker daemon freshness.
 *
 * Polls /api/admin/pipeline/heartbeat every 30s. Shows:
 *   green  — worker pinged < 10 min ago
 *   orange — 10-60 min
 *   red    — > 60 min (or never)
 */
export function HeartbeatPill() {
  const [state, setState] = useState<{ ageMinutes: number | null; status: "green" | "orange" | "red" | "loading" }>({
    ageMinutes: null,
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const r = await fetch("/api/admin/pipeline/heartbeat");
        if (cancelled || !r.ok) return;
        const data: { last_seen?: string | null } = await r.json();
        if (!data.last_seen) {
          setState({ ageMinutes: null, status: "red" });
          return;
        }
        const ageMs = Date.now() - new Date(data.last_seen).getTime();
        const ageMinutes = Math.round(ageMs / 60000);
        const status = ageMinutes < 10 ? "green" : ageMinutes < 60 ? "orange" : "red";
        if (!cancelled) setState({ ageMinutes, status });
      } catch {
        if (!cancelled) setState({ ageMinutes: null, status: "red" });
      }
    };

    void tick();
    const id = window.setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const color = {
    green: "bg-[var(--green)]",
    orange: "bg-[var(--orange)]",
    red: "bg-[var(--red)]",
    loading: "bg-[var(--text-muted)]",
  }[state.status];

  const label =
    state.status === "loading"
      ? "..."
      : state.ageMinutes == null
        ? "no data"
        : state.ageMinutes < 1
          ? "just now"
          : state.ageMinutes < 60
            ? `${state.ageMinutes}m`
            : `${Math.round(state.ageMinutes / 60)}h`;

  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--border-gold)] bg-[var(--bg-elevated)]/60 px-3 py-1">
      <span className={`h-2 w-2 rounded-full ${color} ${state.status === "green" ? "animate-pulse" : ""}`} />
      <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Worker</span>
      <span className="text-[10px] font-mono font-bold text-[var(--text-primary)]">{label}</span>
    </div>
  );
}
