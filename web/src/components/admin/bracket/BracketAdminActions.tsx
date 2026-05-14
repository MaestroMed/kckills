"use client";

/**
 * BracketAdminActions — Wave 31d admin controls for the bracket editor.
 *
 * Two actions exposed :
 *   * Seed monthly bracket : POST /api/admin/bracket/seed with monthYear
 *   * Close round N : POST /api/admin/bracket/close-round for the current
 *     active round of the given tournament
 *
 * Both buttons confirm before firing (destructive / state-changing).
 * After success the component reloads the page so the server-fetched
 * bracket state refreshes immediately.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface Props {
  /** Active tournament ID, when one exists. Null = no active tournament. */
  activeTournamentId: string | null;
  /** Active round number (lowest undecided round). Null = bracket fully resolved. */
  activeRound: number | null;
  /** Total rounds for the active tournament (5 for 32-bracket, 6 for 64). */
  totalRounds: number;
}

type Toast = { tone: "ok" | "err"; text: string } | null;

function defaultMonthYear(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function BracketAdminActions({
  activeTournamentId,
  activeRound,
  totalRounds,
}: Props) {
  const router = useRouter();
  const [monthYear, setMonthYear] = useState(defaultMonthYear());
  const [toast, setToast] = useState<Toast>(null);
  const [pending, startTransition] = useTransition();

  function flash(tone: "ok" | "err", text: string) {
    setToast({ tone, text });
    setTimeout(() => setToast(null), 4000);
  }

  function seedBracket() {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthYear)) {
      flash("err", "Format requis : YYYY-MM");
      return;
    }
    const ok = window.confirm(
      `Créer le tournoi du mois ${monthYear} ? La RPC pioche les top kills publiés sur cette période (avg_rating + highlight_score) et seed la Round 1.`,
    );
    if (!ok) return;
    startTransition(async () => {
      try {
        const r = await fetch("/api/admin/bracket/seed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ monthYear }),
        });
        const data = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          result?: { tournament_id?: string; seeded_count?: number; bracket_size?: number };
        };
        if (!r.ok || !data.ok) {
          flash("err", data.error ?? `HTTP ${r.status}`);
          return;
        }
        flash(
          "ok",
          `Tournoi créé · ${data.result?.seeded_count ?? "?"} kills seedés · bracket ${data.result?.bracket_size ?? "?"}`,
        );
        router.refresh();
      } catch (e) {
        flash("err", e instanceof Error ? e.message : "Network error");
      }
    });
  }

  function closeCurrentRound() {
    if (!activeTournamentId || !activeRound) {
      flash("err", "Pas de round actif à fermer.");
      return;
    }
    const isFinal = activeRound === totalRounds;
    const msg = isFinal
      ? "Fermer la FINALE ? Le winner sera couronné GOAT du Mois et le tournoi marqué clos."
      : `Fermer le round ${activeRound} ? Les gagnants seedent automatiquement le round ${activeRound + 1}.`;
    if (!window.confirm(msg)) return;
    startTransition(async () => {
      try {
        const r = await fetch("/api/admin/bracket/close-round", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tournamentId: activeTournamentId,
            round: activeRound,
          }),
        });
        const data = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!r.ok || !data.ok) {
          flash("err", data.error ?? `HTTP ${r.status}`);
          return;
        }
        flash("ok", `Round ${activeRound} fermé.`);
        router.refresh();
      } catch (e) {
        flash("err", e instanceof Error ? e.message : "Network error");
      }
    });
  }

  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-4">
      <header>
        <h3 className="font-display text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
          Actions admin
        </h3>
        <p className="text-[10px] text-[var(--text-muted)] mt-1">
          Seed du tournoi mensuel + fermeture des rounds. Idempotent côté RPC.
        </p>
      </header>

      {/* Seed form */}
      <div className="space-y-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            Mois à seed (YYYY-MM)
          </span>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{4}-\d{2}"
              maxLength={7}
              value={monthYear}
              onChange={(e) => setMonthYear(e.target.value.trim())}
              className="flex-1 rounded-md border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm font-data tabular-nums outline-none focus:border-[var(--gold)]"
              placeholder="2026-05"
            />
            <button
              type="button"
              onClick={seedBracket}
              disabled={pending}
              className="rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-[var(--gold)] hover:bg-[var(--gold)]/20 disabled:opacity-50"
            >
              {pending ? "…" : "Seed"}
            </button>
          </div>
        </label>
      </div>

      {/* Close round button */}
      {activeTournamentId && activeRound !== null && (
        <div className="pt-3 border-t border-[var(--border-subtle)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
            Round actif : {activeRound}
            {activeRound === totalRounds && (
              <span className="ml-2 text-[var(--gold)] font-bold">FINALE</span>
            )}
          </p>
          <button
            type="button"
            onClick={closeCurrentRound}
            disabled={pending}
            className="w-full rounded-md border border-[var(--orange)]/40 bg-[var(--orange)]/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--orange)] hover:bg-[var(--orange)]/20 disabled:opacity-50"
          >
            {pending
              ? "…"
              : activeRound === totalRounds
                ? "Fermer la FINALE"
                : `Fermer round ${activeRound}`}
          </button>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={`rounded-md border px-3 py-2 text-xs font-semibold ${
            toast.tone === "ok"
              ? "border-[var(--green)]/40 bg-[var(--green)]/10 text-[var(--green)]"
              : "border-[var(--red)]/40 bg-[var(--red)]/10 text-[var(--red)]"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
