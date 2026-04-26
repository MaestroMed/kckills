/**
 * /admin — Live ops dashboard.
 *
 * Hero KPIs (auto-refreshed every 30s) + per-module health table + recent
 * admin activity. The chrome here is server-rendered ; the live tiles are
 * a client component that polls /api/admin/dashboard/{kpis,health}.
 *
 * Replaces the old "static landing page with KPI cards" with a real-time
 * ops view focused on "is the pipeline healthy and how many clips/h are
 * we publishing?". Wave 6 / PR-arch P2.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { createServerSupabase } from "@/lib/supabase/server";
import { LiveDashboard } from "@/components/admin/LiveDashboard";

export const metadata: Metadata = {
  title: "Admin Dashboard — KCKILLS",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface RecentAction {
  id: string;
  actor_label: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
}

export default async function AdminDashboard() {
  const sb = await createServerSupabase();

  // Pull recent activity server-side (20 rows). The tiles fetch via API,
  // but the activity feed is below-the-fold and changes slowly enough
  // that an SSR snapshot + manual refresh is fine.
  const recentRes = await sb
    .from("admin_actions")
    .select("id, actor_label, actor_role, action, entity_type, entity_id, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  const recent: RecentAction[] = (recentRes.data ?? []) as RecentAction[];
  const grouped = groupByHour(recent);

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-black text-[var(--gold)]">
            Live Ops
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Vue temps réel de la pipeline KCKILLS
          </p>
        </div>
        <nav className="flex flex-wrap gap-2">
          <Link
            href="/admin/pipeline"
            className="rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/5 px-3 py-1.5 text-xs font-bold text-[var(--gold)] hover:bg-[var(--gold)]/15"
          >
            Pipeline détaillée →
          </Link>
          <Link
            href="/admin/clips"
            className="rounded-md border border-[var(--border-gold)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40"
          >
            Clip library
          </Link>
          <Link
            href="/admin/moderation"
            className="rounded-md border border-[var(--border-gold)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40"
          >
            Modération
          </Link>
          <Link
            href="/admin/audit"
            className="rounded-md border border-[var(--border-gold)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40"
          >
            Audit log
          </Link>
        </nav>
      </header>

      {/* Live tiles + module health table — client component */}
      <LiveDashboard />

      {/* Recent admin activity — grouped by hour, SSR */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Activité admin récente
            </h2>
            <p className="text-[11px] text-[var(--text-disabled)] mt-0.5">
              20 dernières actions, regroupées par heure
            </p>
          </div>
          <Link
            href="/admin/audit"
            className="text-[10px] text-[var(--cyan)] hover:underline whitespace-nowrap"
          >
            voir tout →
          </Link>
        </div>

        {grouped.length === 0 ? (
          <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
            Aucune action enregistrée.
          </p>
        ) : (
          <div className="space-y-4">
            {grouped.map((group) => (
              <div key={group.hour}>
                <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
                  {group.hour}
                </p>
                <ul className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30">
                  {group.actions.map((a) => (
                    <ActivityRow key={a.id} a={a} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ActivityRow({ a }: { a: RecentAction }) {
  return (
    <li className="px-3 py-2 flex items-center gap-3 text-xs">
      <ActorAvatar label={a.actor_label} role={a.actor_role} />
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[var(--gold)] truncate" title={a.action}>
            {a.action}
          </span>
          <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
            {a.entity_type}
          </span>
        </div>
        {a.entity_id ? (
          <span className="font-mono text-[10px] text-[var(--text-disabled)] truncate">
            {a.entity_id}
          </span>
        ) : null}
      </div>
      <span className="text-[var(--text-muted)] text-[10px] whitespace-nowrap text-right">
        {a.actor_label ?? "?"}
        {a.actor_role && a.actor_role !== "unknown" ? (
          <span className="text-[var(--text-disabled)]"> · {a.actor_role}</span>
        ) : null}
      </span>
      <span className="text-[var(--text-disabled)] text-[10px] whitespace-nowrap font-mono">
        {new Date(a.created_at).toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </li>
  );
}

/**
 * Tiny actor avatar — initials in a colored circle. Color is derived
 * deterministically from the actor_label so the same person always
 * gets the same color (without storing avatar URLs).
 */
function ActorAvatar({ label, role }: { label: string | null; role: string | null }) {
  const initials = (label ?? "?")
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "?";

  const palette = [
    "bg-[var(--gold)]/20 text-[var(--gold)]",
    "bg-[var(--cyan)]/20 text-[var(--cyan)]",
    "bg-[var(--green)]/20 text-[var(--green)]",
    "bg-[var(--blue-kc)]/20 text-[var(--blue-kc)]",
    "bg-[var(--orange)]/20 text-[var(--orange)]",
  ];
  // Deterministic color picker from the label string.
  let hash = 0;
  for (const c of label ?? "?") hash = (hash * 31 + c.charCodeAt(0)) | 0;
  const swatch = palette[Math.abs(hash) % palette.length];

  // Role icon — discord = #, email = @, token = key-ish, unknown = blank.
  const roleIcon: Record<string, string> = {
    token: "◆",
    discord: "#",
    email: "@",
    unknown: "·",
  };
  const icon = role && roleIcon[role] ? roleIcon[role] : "·";

  return (
    <div
      title={`${label ?? "unknown"} · ${role ?? "unknown"}`}
      className={`relative h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${swatch}`}
    >
      {initials}
      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[var(--bg-surface)] border border-[var(--border-gold)] flex items-center justify-center text-[7px] text-[var(--text-muted)] font-mono">
        {icon}
      </span>
    </div>
  );
}

interface ActionGroup {
  hour: string;
  actions: RecentAction[];
}

/**
 * Group actions by their hour-of-day (in fr-FR locale). Returns groups
 * in display order (most recent hour first).
 */
function groupByHour(actions: RecentAction[]): ActionGroup[] {
  const map = new Map<string, RecentAction[]>();
  for (const a of actions) {
    const d = new Date(a.created_at);
    if (Number.isNaN(d.getTime())) continue;
    // Bucket key = "Aujourd'hui 14h" / "Hier 23h" / "Lun. 16h"
    const hour = formatHourBucket(d);
    const arr = map.get(hour) ?? [];
    arr.push(a);
    map.set(hour, arr);
  }
  return Array.from(map.entries()).map(([hour, items]) => ({
    hour,
    actions: items,
  }));
}

function formatHourBucket(d: Date): string {
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const sameYesterday =
    d.getFullYear() === yesterday.getFullYear()
    && d.getMonth() === yesterday.getMonth()
    && d.getDate() === yesterday.getDate();

  const hour = d.getHours().toString().padStart(2, "0");
  if (sameDay) return `Aujourd’hui ${hour}h`;
  if (sameYesterday) return `Hier ${hour}h`;
  // ex. "Lun. 16h"
  const dow = d.toLocaleDateString("fr-FR", { weekday: "short" });
  return `${dow} ${hour}h`;
}
