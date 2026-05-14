/**
 * /admin/community/face-off — Face-off votes admin (read-only).
 *
 * Wave 31a — top duels by total votes + recent vote spread. Direct
 * delete via Supabase table editor.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { AdminPage } from "@/components/admin/ui/AdminPage";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { getTopFaceOffDuels } from "@/lib/supabase/face-off";
import { createAnonSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Face-off Admin — KCKILLS",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function FaceOffAdminPage() {
  const [topDuels, plannedTotal] = await Promise.all([
    getTopFaceOffDuels(20),
    (async () => {
      try {
        const sb = createAnonSupabase();
        const { count } = await sb
          .from("face_off_votes")
          .select("*", { count: "planned", head: true });
        return count ?? 0;
      } catch {
        return 0;
      }
    })(),
  ]);

  const totalVotesTop = topDuels.reduce((s, d) => s + d.total_votes, 0);

  return (
    <AdminPage
      title="Face-off"
      subtitle="Duels PvP votés par la communauté."
      breadcrumbs={[
        { label: "Admin", href: "/admin" },
        { label: "Community", href: "/admin/community" },
        { label: "Face-off" },
      ]}
      actions={
        <Link
          href="/face-off"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--gold)] hover:bg-[var(--gold)]/20"
        >
          Voir le site public →
        </Link>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <Tile
          label="Votes (total, estimé)"
          value={plannedTotal.toLocaleString("fr-FR")}
        />
        <Tile
          label="Top 20 cumulés"
          value={totalVotesTop.toLocaleString("fr-FR")}
        />
        <Tile
          label="Duels engagés (top 20)"
          value={String(topDuels.length)}
        />
      </div>

      <AdminCard title={`Top duels (${topDuels.length})`}>
        {topDuels.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] italic text-center py-8">
            Aucun duel voté pour l&apos;instant.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {topDuels.map((d) => {
              const max = Math.max(d.votes_a, d.votes_b, d.votes_draw, 1);
              return (
                <li
                  key={`${d.player_a_slug}-${d.player_b_slug}`}
                  className="py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <Link
                      href={`/face-off?a=${encodeURIComponent(d.player_a_slug)}&b=${encodeURIComponent(d.player_b_slug)}`}
                      className="text-sm text-[var(--text-primary)] hover:text-[var(--gold)]"
                    >
                      <span className="font-semibold">
                        {cap(d.player_a_slug)}
                      </span>
                      <span className="mx-2 text-[var(--text-muted)]">vs</span>
                      <span className="font-semibold">
                        {cap(d.player_b_slug)}
                      </span>
                    </Link>
                    <span className="font-data text-[10px] tabular-nums text-[var(--text-muted)]">
                      {d.total_votes} votes
                    </span>
                  </div>
                  <div className="space-y-1">
                    <Bar
                      label={cap(d.player_a_slug)}
                      value={d.votes_a}
                      max={max}
                      color="var(--gold)"
                    />
                    <Bar
                      label="Égalité"
                      value={d.votes_draw}
                      max={max}
                      color="var(--text-muted)"
                    />
                    <Bar
                      label={cap(d.player_b_slug)}
                      value={d.votes_b}
                      max={max}
                      color="var(--cyan)"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AdminCard>
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

function Bar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = (value / max) * 100;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-20 truncate text-[var(--text-muted)] shrink-0">
        {label}
      </span>
      <div className="flex-1 h-3 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-data text-[10px] tabular-nums text-[var(--text-secondary)] w-10 text-right shrink-0">
        {value}
      </span>
    </div>
  );
}

function cap(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
