/**
 * /admin/community — Wave 30 features hub.
 *
 * Wave 31a — surfaces all the post-Wave-30 community + events tables in
 * one dashboard with quick stats + deep-links to per-feature editors.
 * Reads counts from the same RPCs the public pages use so we don't
 * duplicate query logic.
 *
 * Sections :
 *   1. Active bracket — tournament name, open match count, finals close
 *   2. Quote moderation — total kill_quotes, recent additions
 *   3. Achievements — total catalogue size + global recent unlocks feed
 *   4. Face-off duels — top 3 most-voted PvP duels
 *   5. Compilations — total + recent
 *
 * Each card has a "→ Voir tout" link to the per-feature admin page (some
 * of which point at the public surface until a dedicated editor lands).
 */
import type { Metadata } from "next";
import Link from "next/link";

import { AdminPage } from "@/components/admin/ui/AdminPage";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { getCurrentBracket, currentRound, openMatchCount } from "@/lib/supabase/bracket";
import { getRecentUnlocks } from "@/lib/supabase/achievements";
import { getTopFaceOffDuels } from "@/lib/supabase/face-off";
import { createAnonSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Community & Events — Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// ─── Helpers ───────────────────────────────────────────────────────────

async function plannedCount(table: string): Promise<number | null> {
  // Use the anon client + head-only query to get a fast estimated count.
  // Returns null when the request fails (RLS, missing table) so the
  // caller can render a "—" placeholder rather than a noisy 0.
  try {
    const sb = createAnonSupabase();
    const { count, error } = await sb
      .from(table)
      .select("*", { count: "planned", head: true });
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

function fmt(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("fr-FR");
}

// ─── Page ──────────────────────────────────────────────────────────────

export default async function CommunityAdminHub() {
  // Fan out every read in parallel — none of them depend on each other.
  const [
    bracket,
    recentUnlocks,
    topDuels,
    quoteCount,
    compilationCount,
    achievementsEarnedCount,
    vsBattleCount,
    faceOffVoteCount,
    bracketVoteCount,
    bccPunchCount,
    bccTomatoCount,
    bccAhouCount,
  ] = await Promise.all([
    getCurrentBracket(),
    getRecentUnlocks(8, { buildTime: false }),
    getTopFaceOffDuels(5),
    plannedCount("kill_quotes"),
    plannedCount("compilations"),
    plannedCount("user_achievements"),
    plannedCount("vs_battles"),
    plannedCount("face_off_votes"),
    plannedCount("bracket_votes"),
    plannedCount("bcc_punches"),
    plannedCount("bcc_tomatoes"),
    plannedCount("bcc_ahou_plays"),
  ]);

  const activeRound = currentRound(bracket.matches);
  const openMatches = openMatchCount(bracket.matches);
  const totalMatches = bracket.matches.length;

  return (
    <AdminPage
      title="Community & Events"
      subtitle="Hub des features Wave 30 — bracket, face-off, quotes, achievements, compilations."
      breadcrumbs={[
        { label: "Admin", href: "/admin" },
        { label: "Community" },
      ]}
    >
      {/* ─── KPI row : counters across every Wave-30 table ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiTile label="Quotes" value={fmt(quoteCount)} href="/admin/community/quotes" />
        <KpiTile label="Compilations" value={fmt(compilationCount)} href="/admin/community/compilations" />
        <KpiTile label="Achievements débloqués" value={fmt(achievementsEarnedCount)} href="/admin/community/achievements" />
        <KpiTile label="VS battles" value={fmt(vsBattleCount)} href="/vs" external />
        <KpiTile label="Votes face-off" value={fmt(faceOffVoteCount)} href="/admin/community/face-off" />
        <KpiTile label="Votes bracket" value={fmt(bracketVoteCount)} href="/admin/community/bracket" />
      </div>

      {/* ─── BCC interactions row (smaller — under the main KPIs) ─────── */}
      <AdminCard
        title="Antre BCC — Interactions"
        titleAction={
          <Link href="/alumni/bo" className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)]">
            Voir l&apos;Antre →
          </Link>
        }
        className="mb-6"
      >
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Punches</p>
            <p className="font-data text-2xl font-bold tabular-nums text-[var(--gold)]">{fmt(bccPunchCount)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Tomates</p>
            <p className="font-data text-2xl font-bold tabular-nums text-[var(--red)]">{fmt(bccTomatoCount)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Ahou-ahou</p>
            <p className="font-data text-2xl font-bold tabular-nums text-[var(--cyan)]">{fmt(bccAhouCount)}</p>
          </div>
        </div>
      </AdminCard>

      {/* ─── Two-column main content ───────────────────────────────────── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Bracket status */}
        <AdminCard
          title="Bracket — Tournoi actif"
          titleAction={
            <Link href="/admin/community/bracket" className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)]">
              Gérer →
            </Link>
          }
        >
          {bracket.tournament ? (
            <div className="space-y-3">
              <div>
                <p className="font-display text-lg font-bold text-[var(--text-primary)]">
                  {bracket.tournament.name}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {bracket.tournament.start_date} → {bracket.tournament.end_date} · status{" "}
                  <span className="text-[var(--gold)]">{bracket.tournament.status}</span>
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center pt-2 border-t border-[var(--border-subtle)]">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Matchs</p>
                  <p className="font-data text-xl font-bold tabular-nums">{totalMatches}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Round</p>
                  <p className="font-data text-xl font-bold tabular-nums text-[var(--gold)]">
                    {activeRound ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Ouverts</p>
                  <p className="font-data text-xl font-bold tabular-nums text-[var(--cyan)]">{openMatches}</p>
                </div>
              </div>
              <Link
                href={`/bracket/${bracket.tournament.slug}`}
                className="block text-center text-xs text-[var(--text-secondary)] hover:text-[var(--gold)] underline underline-offset-2 pt-1"
              >
                Voir sur le site public →
              </Link>
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-[var(--text-muted)]">Aucun tournoi actif.</p>
              <Link
                href="/admin/community/bracket"
                className="inline-block mt-3 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-4 py-2 text-xs font-semibold text-[var(--gold)] hover:bg-[var(--gold)]/20"
              >
                Créer le tournoi du mois
              </Link>
            </div>
          )}
        </AdminCard>

        {/* Recent achievements feed */}
        <AdminCard
          title="Achievements — Récemment débloqués"
          titleAction={
            <Link href="/admin/community/achievements" className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)]">
              Catalogue →
            </Link>
          }
        >
          {recentUnlocks.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] italic text-center py-8">
              Pas encore d&apos;unlocks. Le système est tout neuf.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentUnlocks.slice(0, 6).map((u, idx) => (
                <li
                  key={`${u.slug}-${u.earned_at}-${idx}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="text-base" aria-hidden>
                    {u.icon}
                  </span>
                  <span className="flex-1 truncate text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--text-primary)]">
                      {u.display_name ?? "Un membre BCC"}
                    </span>{" "}
                    a débloqué <span className="text-[var(--gold)]">{u.name}</span>
                  </span>
                  <span className="font-data text-[10px] text-[var(--text-muted)] tabular-nums">
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

        {/* Top face-off duels */}
        <AdminCard
          title="Face-off — Top duels"
          titleAction={
            <Link href="/admin/community/face-off" className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)]">
              Modération →
            </Link>
          }
        >
          {topDuels.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] italic text-center py-8">
              Pas encore de duel populaire.
            </p>
          ) : (
            <ul className="space-y-2">
              {topDuels.slice(0, 5).map((duel) => (
                <li
                  key={`${duel.player_a_slug}-${duel.player_b_slug}`}
                  className="flex items-center justify-between gap-3 text-xs border-b border-[var(--border-subtle)] last:border-b-0 pb-2 last:pb-0"
                >
                  <Link
                    href={`/face-off?a=${encodeURIComponent(duel.player_a_slug)}&b=${encodeURIComponent(duel.player_b_slug)}`}
                    className="flex-1 truncate text-[var(--text-secondary)] hover:text-[var(--gold)]"
                  >
                    <span className="font-semibold">{capitalize(duel.player_a_slug)}</span>
                    <span className="mx-1.5 text-[var(--text-muted)]">vs</span>
                    <span className="font-semibold">{capitalize(duel.player_b_slug)}</span>
                  </Link>
                  <span className="font-data text-[10px] tabular-nums text-[var(--text-muted)] shrink-0">
                    {duel.total_votes} votes
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>

        {/* Quotes count + link */}
        <AdminCard
          title="Quotes — Modération"
          titleAction={
            <Link href="/admin/community/quotes" className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)]">
              Liste →
            </Link>
          }
        >
          <div className="space-y-2">
            <p className="text-sm text-[var(--text-secondary)]">
              {fmt(quoteCount)} quotes extraites par Gemini sur les clips publiés.
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Le quote extractor tourne toutes les 30 min sur l&apos;audio des
              nouveaux clips. Modération nécessaire quand une quote contient
              du trash-talk ou un mot que les casters ont mal articulé.
            </p>
            <Link
              href="/quotes"
              className="inline-block text-xs text-[var(--gold)] hover:underline underline-offset-2 mt-1"
            >
              Voir sur le site public →
            </Link>
          </div>
        </AdminCard>
      </div>
    </AdminPage>
  );
}

// ─── Local helpers ─────────────────────────────────────────────────────

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── KpiTile (admin-flavoured) ─────────────────────────────────────────

interface KpiTileProps {
  label: string;
  value: string;
  href?: string;
  external?: boolean;
}

function KpiTile({ label, value, href, external }: KpiTileProps) {
  const inner = (
    <>
      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="font-data text-2xl font-bold tabular-nums text-[var(--text-primary)] mt-1">
        {value}
      </p>
    </>
  );
  const className =
    "block rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 transition-all hover:border-[var(--gold)]/50 hover:bg-[var(--bg-elevated)]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]";
  if (!href) {
    return <div className={className}>{inner}</div>;
  }
  if (external) {
    return (
      <Link href={href} className={className} aria-label={`Voir ${label}`}>
        {inner}
        <span
          aria-hidden
          className="block mt-1 text-[10px] text-[var(--text-disabled)] tracking-wider"
        >
          site public ↗
        </span>
      </Link>
    );
  }
  return (
    <Link href={href} className={className} aria-label={`Gérer ${label}`}>
      {inner}
    </Link>
  );
}
