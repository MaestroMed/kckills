/**
 * /admin/push — push broadcast composer + recent history.
 *
 * Lets the editor send a push notification to all subscribers in two
 * modes :
 *
 *   * "enqueue"  — INSERT into push_notifications, the worker daemon
 *                  picks it up within ~5 minutes. Default. Scales.
 *   * "send_now" — Bounded synchronous send via Node web-push. For
 *                  urgent broadcasts to small audiences (< 200 subs).
 *
 * The right column shows the v_recent_push_notifications view —
 * what was sent, when, to how many, with success/failure breakdown.
 *
 * Inherits requireAdmin() from the parent admin layout.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { PushBroadcastForm } from "./push-broadcast-form";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = {
  title: "Push Broadcast — Admin",
  robots: { index: false, follow: false },
};

interface RecentRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  kill_id: string | null;
  sent_by: string | null;
  target_count: number;
  sent_count: number;
  failed_count: number;
  expired_count: number;
  created_at: string;
  sent_at: string | null;
  killer_champion: string | null;
  victim_champion: string | null;
  thumbnail_url: string | null;
}

async function getRecent(): Promise<RecentRow[]> {
  const sb = await createServerSupabase();
  // The view filters to the latest 50 ; we just SELECT * here.
  const { data } = await sb
    .from("v_recent_push_notifications")
    .select("*")
    .limit(30);
  return (data ?? []) as RecentRow[];
}

async function getSubscriberCount(): Promise<number> {
  const sb = await createServerSupabase();
  const { count } = await sb
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function PushBroadcastPage() {
  const [recent, subscriberCount] = await Promise.all([
    getRecent(),
    getSubscriberCount(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--text-primary)]">
          Push Broadcast
        </h1>
        <span className="text-xs text-[var(--text-muted)]">
          {subscriberCount.toLocaleString("fr-FR")} abonnés
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Composer */}
        <PushBroadcastForm subscriberCount={subscriberCount} />

        {/* Recent broadcasts */}
        <aside>
          <h2 className="mb-3 font-display text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
            Récents
          </h2>
          {recent.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Aucun broadcast envoyé.</p>
          ) : (
            <ol className="space-y-2">
              {recent.map((r) => (
                <li
                  key={r.id}
                  className="rounded border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[var(--gold)] truncate">{r.kind}</span>
                    <span className="text-[var(--text-muted)] whitespace-nowrap">
                      {formatTime(r.created_at)}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-medium text-[var(--text-primary)]">
                    {r.title}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[var(--text-secondary)]">
                    {r.body}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[10px]">
                    {r.sent_at ? (
                      <>
                        <span className="text-[var(--green)]">
                          ✓ {r.sent_count}
                        </span>
                        {r.failed_count > 0 && (
                          <span className="text-[var(--red)]">
                            ✗ {r.failed_count}
                          </span>
                        )}
                        {r.expired_count > 0 && (
                          <span className="text-[var(--text-muted)]">
                            ⏚ {r.expired_count}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[var(--orange)]">en attente…</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}
