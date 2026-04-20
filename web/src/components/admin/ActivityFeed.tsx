"use client";

import { useEffect, useState } from "react";

interface AdminAction {
  id: string;
  actor_label: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
}

/**
 * ActivityFeed — right-rail stream of recent admin actions.
 * Polls /api/admin/audit every 15s.
 */
export function ActivityFeed() {
  const [actions, setActions] = useState<AdminAction[]>([]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const r = await fetch("/api/admin/audit?limit=20");
        if (cancelled || !r.ok) return;
        const data = await r.json();
        if (!cancelled && Array.isArray(data.items)) setActions(data.items);
      } catch {}
    };

    void tick();
    const id = window.setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <aside className="hidden xl:block fixed right-0 top-14 bottom-0 w-64 border-l border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-y-auto z-30">
      <div className="px-4 py-3 border-b border-[var(--border-gold)]">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
          Activity
        </h3>
      </div>
      <div className="divide-y divide-[var(--border-gold)]/30">
        {actions.length === 0 ? (
          <p className="px-4 py-6 text-[11px] text-[var(--text-muted)] text-center">
            Aucune action récente
          </p>
        ) : (
          actions.map((a) => (
            <div key={a.id} className="px-4 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-[var(--text-secondary)] truncate">
                    <span className="text-[var(--gold)] font-bold">{a.action}</span>
                  </p>
                  {a.entity_id && (
                    <p className="text-[9px] font-mono text-[var(--text-muted)] truncate mt-0.5">
                      {a.entity_type}: {a.entity_id.slice(0, 8)}
                    </p>
                  )}
                </div>
                <span className="text-[9px] text-[var(--text-disabled)] whitespace-nowrap">
                  {formatAgo(a.created_at)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function formatAgo(iso: string): string {
  const ageMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(ageMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}
