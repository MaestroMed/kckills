/**
 * /admin/community/achievements — Achievements catalogue + global feed.
 *
 * Wave 31a — view the catalogue (locked or earned doesn't matter for
 * admin POV) + the recent-unlocks community feed. Direct edits to the
 * achievements table via Supabase ; this surface is read-only diagnostics.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { AdminPage } from "@/components/admin/ui/AdminPage";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import {
  getUserAchievements,
  getRecentUnlocks,
} from "@/lib/supabase/achievements";
import {
  RARITY_COLOR,
  RARITY_LABEL,
  CATEGORY_LABEL,
} from "@/lib/supabase/achievements-types";
import { createAnonSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Achievements Admin — KCKILLS",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AchievementsAdminPage() {
  // Pass null sessionHash → unlocked state hides, but the catalogue is
  // still returned so we can see every defined badge.
  const [catalogue, recent, plannedEarned] = await Promise.all([
    getUserAchievements(null, { buildTime: true }),
    getRecentUnlocks(20, { buildTime: true }),
    (async () => {
      try {
        const sb = createAnonSupabase();
        const { count } = await sb
          .from("user_achievements")
          .select("*", { count: "planned", head: true });
        return count ?? 0;
      } catch {
        return 0;
      }
    })(),
  ]);

  const byCategory = catalogue.reduce<Record<string, typeof catalogue>>(
    (acc, row) => {
      const k = row.category;
      acc[k] ??= [];
      acc[k]!.push(row);
      return acc;
    },
    {},
  );

  return (
    <AdminPage
      title="Achievements"
      subtitle={`Catalogue de ${catalogue.length} badges + feed récent.`}
      breadcrumbs={[
        { label: "Admin", href: "/admin" },
        { label: "Community", href: "/admin/community" },
        { label: "Achievements" },
      ]}
      actions={
        <Link
          href="/achievements"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--gold)] hover:bg-[var(--gold)]/20"
        >
          Voir le catalogue public →
        </Link>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <Tile label="Badges définis" value={String(catalogue.length)} />
        <Tile
          label="Unlocks (estimé)"
          value={plannedEarned.toLocaleString("fr-FR")}
        />
        <Tile label="Récents (24h)" value={String(recent.length)} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Catalogue grouped by category */}
        <AdminCard title="Catalogue par catégorie">
          {Object.keys(byCategory).length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] italic text-center py-6">
              Aucun badge défini.
            </p>
          ) : (
            <div className="space-y-4">
              {Object.entries(byCategory).map(([cat, rows]) => (
                <div key={cat}>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
                    {CATEGORY_LABEL[cat as keyof typeof CATEGORY_LABEL] ?? cat}{" "}
                    ({rows.length})
                  </p>
                  <ul className="space-y-1">
                    {rows.map((r) => (
                      <li
                        key={r.slug}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span className="text-base" aria-hidden>
                          {r.icon}
                        </span>
                        <span className="flex-1 truncate text-[var(--text-primary)]">
                          {r.name}
                        </span>
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest"
                          style={{
                            color: RARITY_COLOR[r.rarity],
                            backgroundColor: `${RARITY_COLOR[r.rarity]}1a`,
                          }}
                        >
                          {RARITY_LABEL[r.rarity]}
                        </span>
                        <span className="font-data text-[10px] text-[var(--text-muted)] tabular-nums w-8 text-right">
                          {r.points}p
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </AdminCard>

        {/* Recent unlocks feed */}
        <AdminCard title="Récemment débloqués">
          {recent.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] italic text-center py-6">
              Pas encore d&apos;unlocks.
            </p>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-y-auto">
              {recent.map((u, idx) => (
                <li
                  key={`${u.slug}-${u.earned_at}-${idx}`}
                  className="flex items-center gap-2 text-xs border-b border-[var(--border-subtle)] last:border-b-0 pb-2 last:pb-0"
                >
                  <span className="text-base" aria-hidden>
                    {u.icon}
                  </span>
                  <span className="flex-1 truncate text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--text-primary)]">
                      {u.display_name ?? "Anon BCC"}
                    </span>
                    {" → "}
                    <span style={{ color: RARITY_COLOR[u.rarity] }}>
                      {u.name}
                    </span>
                  </span>
                  <span className="font-data text-[10px] tabular-nums text-[var(--text-muted)] shrink-0">
                    {new Date(u.earned_at).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      </div>
    </AdminPage>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="font-data text-2xl font-bold tabular-nums text-[var(--text-primary)] mt-1">
        {value}
      </p>
    </div>
  );
}
