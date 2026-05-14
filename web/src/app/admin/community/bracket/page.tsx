/**
 * /admin/community/bracket — Bracket tournament admin.
 *
 * Wave 31a — surfaces the bracket tournaments table for monthly setup.
 * Reuses the public-facing data layer (getCurrentBracket, getPastWinners)
 * so the admin sees the same state the users do. Creation/editing of new
 * brackets is done via SQL for now — a full editor is follow-up work.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { AdminPage } from "@/components/admin/ui/AdminPage";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import {
  getCurrentBracket,
  getPastWinners,
  currentRound,
  openMatchCount,
  nextCloseAt,
  roundsForSize,
  roundLabel,
} from "@/lib/supabase/bracket";
import { BracketAdminActions } from "@/components/admin/bracket/BracketAdminActions";

export const metadata: Metadata = {
  title: "Bracket Admin — KCKILLS",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function BracketAdminPage() {
  const [bracket, pastWinners] = await Promise.all([
    getCurrentBracket(),
    getPastWinners(8),
  ]);

  const activeRound = currentRound(bracket.matches);
  const openCount = openMatchCount(bracket.matches);
  const totalRounds = bracket.tournament
    ? roundsForSize(bracket.tournament.bracket_size)
    : 0;
  const nextClose = nextCloseAt(bracket.matches);

  return (
    <AdminPage
      title="Bracket — Tournois"
      subtitle="État du tournoi mensuel + archives. Création via SQL pour l'instant."
      breadcrumbs={[
        { label: "Admin", href: "/admin" },
        { label: "Community", href: "/admin/community" },
        { label: "Bracket" },
      ]}
      actions={
        bracket.tournament ? (
          <Link
            href={`/bracket/${bracket.tournament.slug}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--gold)] hover:bg-[var(--gold)]/20"
          >
            Voir sur le site public →
          </Link>
        ) : null
      }
    >
      {/* Side-by-side : tournament status (left) + admin actions (right) */}
      <div className="grid gap-6 md:grid-cols-[1fr_auto] mb-6">
        <AdminCard title="Tournoi actif">
          {bracket.tournament ? (
            <div className="space-y-4">
              <div>
                <p className="font-display text-2xl font-bold text-[var(--text-primary)]">
                  {bracket.tournament.name}
                </p>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  Du {bracket.tournament.start_date} au {bracket.tournament.end_date} ·{" "}
                  <span className="text-[var(--gold)]">{bracket.tournament.status}</span>
                  {" · "}
                  Bracket size {bracket.tournament.bracket_size} ({totalRounds} rounds)
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-[var(--border-subtle)]">
                <Stat
                  label="Matchs total"
                  value={String(bracket.matches.length)}
                />
                <Stat
                  label="Round actif"
                  value={
                    activeRound !== null
                      ? roundLabel(activeRound, totalRounds)
                      : "Terminé"
                  }
                />
                <Stat label="Matchs ouverts" value={String(openCount)} />
                <Stat
                  label="Prochaine fermeture"
                  value={
                    nextClose
                      ? new Date(nextClose).toLocaleString("fr-FR", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"
                  }
                />
              </div>
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-[var(--text-muted)]">
                Aucun tournoi actif.
              </p>
              <p className="text-xs text-[var(--text-disabled)] mt-2 max-w-md mx-auto">
                Saisis un mois (YYYY-MM) dans le panneau de droite pour en créer
                un. La RPC pioche les top kills publiés sur cette période.
              </p>
            </div>
          )}
        </AdminCard>

        {/* Wave 31d — admin actions panel (client component). */}
        <div className="md:w-[320px] shrink-0">
          <BracketAdminActions
            activeTournamentId={bracket.tournament?.id ?? null}
            activeRound={activeRound}
            totalRounds={totalRounds}
          />
        </div>
      </div>

      {/* Matches list */}
      {bracket.matches.length > 0 && (
        <AdminCard title={`Tableau (${bracket.matches.length} matchs)`} className="mb-6">
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {bracket.matches
              .sort((a, b) => a.round - b.round || a.match_index - b.match_index)
              .map((m) => {
                const decided = m.winner_kill_id != null;
                const open = !decided && m.kill_a_id && m.kill_b_id;
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 text-xs py-1.5 px-2 rounded hover:bg-[var(--bg-elevated)]/40"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-data text-[10px] text-[var(--text-muted)] tabular-nums w-16 shrink-0">
                        R{m.round}/M{m.match_index}
                      </span>
                      <span className="text-[var(--text-secondary)] truncate">
                        {m.kill_a_killer_name ?? "—"}{" "}
                        <span className="text-[var(--text-muted)]">vs</span>{" "}
                        {m.kill_b_killer_name ?? "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-data text-[10px] tabular-nums text-[var(--text-muted)]">
                        {m.votes_a} - {m.votes_b}
                      </span>
                      <span
                        className={`text-[9px] uppercase tracking-widest font-bold ${
                          decided
                            ? "text-[var(--gold)]"
                            : open
                              ? "text-[var(--green)]"
                              : "text-[var(--text-disabled)]"
                        }`}
                      >
                        {decided ? "✓" : open ? "OPEN" : "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </AdminCard>
      )}

      {/* Past winners */}
      <AdminCard title={`Archives (${pastWinners.length} tournois)`}>
        {pastWinners.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] italic text-center py-6">
            Pas encore de tournoi terminé.
          </p>
        ) : (
          <ul className="space-y-2">
            {pastWinners.map((w) => (
              <li
                key={w.tournament_id}
                className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] last:border-b-0 pb-2 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm text-[var(--text-primary)] truncate">
                    {w.name}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Champion :{" "}
                    {w.champion_killer_name ?? "—"}{" "}
                    {w.champion_killer_champion ? `(${w.champion_killer_champion})` : ""}
                  </p>
                </div>
                <Link
                  href={`/bracket/${w.slug}`}
                  className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)] shrink-0"
                >
                  Voir →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </AdminPage>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <p className="font-data text-base font-bold tabular-nums text-[var(--text-primary)] mt-0.5">
        {value}
      </p>
    </div>
  );
}
