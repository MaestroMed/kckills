"use client";

import { useState } from "react";
import { JsonDiffView } from "@/components/admin/JsonDiffView";

interface Row {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_label: string | null;
  actor_role: string | null;
  before: unknown;
  after: unknown;
  notes: string | null;
  ip_hash: string | null;
  request_id: string | null;
  user_agent_class: string | null;
  created_at: string;
}

const REPLAYABLE = ["kill.edit", "kill.bulk", "player.edit", "featured.set"];

export function AuditRow({ row }: { row: Row }) {
  const [replaying, setReplaying] = useState(false);
  const [replayed, setReplayed] = useState(false);
  const canReplay = REPLAYABLE.some((p) => row.action.startsWith(p));

  const replay = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Re-applique cette action ?\n${row.action} sur ${row.entity_id?.slice(0, 16)}`)) return;
    setReplaying(true);
    try {
      const r = await fetch(`/api/admin/audit/${row.id}/replay`, { method: "POST" });
      if (r.ok) setReplayed(true);
    } finally {
      setReplaying(false);
    }
  };

  return (
    <details className="group">
      <summary className="cursor-pointer px-3 py-2 flex items-center gap-3 text-xs hover:bg-[var(--bg-elevated)]">
        <span className="font-mono text-[var(--gold)] w-32 flex-shrink-0">{row.action}</span>
        <span className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          {row.entity_type}
        </span>
        <span className="font-mono text-[10px] text-[var(--text-disabled)] truncate flex-1">
          {row.entity_id ? row.entity_id.slice(0, 16) : "—"}
        </span>
        {canReplay && (
          <button
            onClick={replay}
            disabled={replaying || replayed}
            className="text-[10px] text-[var(--cyan)] hover:underline disabled:opacity-50"
          >
            {replayed ? "✓ replayed" : replaying ? "..." : "↻ replay"}
          </button>
        )}
        <span className="text-[var(--text-muted)] text-[10px] whitespace-nowrap">
          {row.actor_label ?? "?"}
          {row.actor_role && row.actor_role !== "unknown" ? (
            <span className="text-[var(--text-disabled)]"> · {row.actor_role}</span>
          ) : null}
          {" · "}
          {new Date(row.created_at).toLocaleString("fr-FR")}
        </span>
      </summary>
      <div className="px-3 py-3 bg-[var(--bg-primary)] space-y-2">
        {/* Forensic chips — IP/UA/request_id give post-hoc traceability */}
        <div className="flex flex-wrap gap-2 text-[10px]">
          {row.request_id && (
            <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[var(--text-muted)]">
              req: {row.request_id}
            </span>
          )}
          {row.user_agent_class && row.user_agent_class !== "unknown" && (
            <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-muted)]">
              ua: {row.user_agent_class}
            </span>
          )}
          {row.ip_hash && (
            <span
              className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[var(--text-muted)]"
              title="SHA-256 of client IP (first 32 chars)"
            >
              ip: {row.ip_hash.slice(0, 8)}…
            </span>
          )}
        </div>
        <JsonDiffView before={row.before} after={row.after} />
        {row.notes && <p className="text-[10px] text-[var(--text-muted)] mt-2">{row.notes}</p>}
      </div>
    </details>
  );
}
