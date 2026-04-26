/**
 * /admin/push — push broadcast composer + recent history
 * (PR-loltok ED).
 *
 * Migrated to Agent EA's primitives. The composer is a client component
 * (PushBroadcastForm) that consumes the new <PushPreview /> mockup. The
 * recent broadcasts list lives below the form as an AdminTable-style
 * block (kind / title / sent_at / delivered / failed).
 *
 * Inherits requireAdmin() from the parent admin layout.
 */

import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { PushBroadcastForm } from "./push-broadcast-form";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";
import { AdminBreadcrumbs } from "@/components/admin/ui/AdminBreadcrumbs";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { AdminEmptyState } from "@/components/admin/ui/AdminEmptyState";
import { AdminSection } from "@/components/admin/ui/AdminSection";

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
      <AdminBreadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Push Broadcast" }]} />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">
            Push Broadcast
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Compose une notif et envoie à tous les abonnés Web Push.
          </p>
        </div>
        <AdminBadge variant="info" size="md">
          {subscriberCount.toLocaleString("fr-FR")} abonnés
        </AdminBadge>
      </header>

      <PushBroadcastForm subscriberCount={subscriberCount} />

      <AdminSection
        title="Broadcasts récents"
        subtitle={`${recent.length} entrée(s)`}
      >
        <AdminCard variant="dense">
          {recent.length === 0 ? (
            <AdminEmptyState
              icon="📣"
              title="Aucun broadcast envoyé"
              body="Les notifs récentes apparaîtront ici dès qu'une sera envoyée."
              compact
            />
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-elevated)] border-b border-[var(--border-gold)] text-left">
                <tr>
                  <th className="px-3 py-2 w-24">Type</th>
                  <th className="px-3 py-2">Titre</th>
                  <th className="px-3 py-2 w-36">Envoyé</th>
                  <th className="px-3 py-2 w-16 text-right">Cible</th>
                  <th className="px-3 py-2 w-16 text-right">OK</th>
                  <th className="px-3 py-2 w-16 text-right">Fail</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-[var(--border-gold)]/20 hover:bg-[var(--bg-elevated)]/40"
                  >
                    <td className="px-3 py-2">
                      <AdminBadge variant="info" size="sm">
                        {r.kind}
                      </AdminBadge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-[var(--text-primary)] truncate max-w-md">
                        {r.title}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] line-clamp-1">
                        {r.body}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-[var(--text-muted)]">
                      {r.sent_at ? (
                        formatTime(r.sent_at)
                      ) : (
                        <AdminBadge variant="warn" size="sm">
                          en attente
                        </AdminBadge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.target_count.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[var(--green)]">
                      {r.sent_count.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[var(--red)]">
                      {r.failed_count.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-3 py-2">
                      {r.kill_id && (
                        <Link
                          href={`/admin/clips/${r.kill_id}`}
                          className="text-[10px] text-[var(--gold)]/80 hover:text-[var(--gold)] underline"
                        >
                          → clip
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AdminCard>
      </AdminSection>
    </div>
  );
}
