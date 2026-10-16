"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Échecs regroupés par cause (type de job × code d'erreur), avec une
 * action pour tout le groupe. Chaque action demande une seconde
 * confirmation sur le bouton lui-même.
 */
interface Group {
  type: string;
  error_code: string | null;
  count: number;
  sample: string | null;
  last_failed_at: string;
}

type Action = "requeue" | "cancel" | "wont_fix";
const LABELS: Record<Action, string> = { requeue: "Remettre en file", cancel: "Abandonner", wont_fix: "Perte acceptée" };

export function DlqGroups() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/pipeline/dlq/group", { cache: "no-store" });
    const d = (await r.json().catch(() => ({}))) as { groups?: Group[]; total?: number; error?: string };
    if (!r.ok) return setError(d.error ?? `HTTP ${r.status}`);
    setError(null);
    setGroups(d.groups ?? []);
    setTotal(d.total ?? 0);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (g: Group, action: Action) => {
    const key = `${g.type}/${g.error_code}/${action}`;
    if (armed !== key) {
      setArmed(key);
      window.setTimeout(() => setArmed((a) => (a === key ? null : a)), 4000);
      return;
    }
    setArmed(null);
    setBusy(key);
    setMessage(null);
    try {
      const r = await fetch("/api/admin/pipeline/dlq/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: g.type, error_code: g.error_code, action }),
      });
      const d = (await r.json().catch(() => ({}))) as { resolved?: number; requeued?: number; failed?: number; more?: boolean; error?: string };
      if (!r.ok) setMessage(`Erreur : ${d.error ?? r.status}`);
      else
        setMessage(
          `${g.type} / ${g.error_code ?? "sans code"} : ${d.resolved ?? 0} ligne(s) traitée(s)` +
            (action === "requeue" ? `, ${d.requeued ?? 0} job(s) remis en file` : "") +
            (d.failed ? `, ${d.failed} en échec` : "") +
            (d.more ? ". Il en reste : relance l'action." : "."),
        );
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-bold uppercase tracking-widest text-[var(--gold)]">Échecs par cause</h2>
        {groups && <p className="font-data text-xs text-[var(--text-muted)]">{total.toLocaleString("fr-FR")} non résolus</p>}
      </div>
      {message && <p className="mb-3 rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">{message}</p>}
      {error && <p className="text-xs text-[var(--red)]">Lecture impossible : {error}</p>}
      {!groups && !error && <p className="text-xs text-[var(--text-muted)]">Chargement…</p>}
      {groups && groups.length === 0 && <p className="text-xs text-[var(--green)]">Aucun échec en attente.</p>}
      {groups && groups.length > 0 && (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {groups.map((g) => (
            <li key={`${g.type}/${g.error_code}`} className="flex flex-wrap items-start gap-3 py-2.5">
              <span className="w-16 shrink-0 text-right font-data text-base font-bold tabular-nums text-[var(--orange)]">
                {g.count.toLocaleString("fr-FR")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-[var(--text-primary)]">
                  {g.type} <span className="text-[var(--text-muted)]">·</span> {g.error_code ?? "sans code"}
                </p>
                {g.sample && <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]" title={g.sample}>{g.sample}</p>}
                <p className="text-[10px] text-[var(--text-disabled)]">dernier : {new Date(g.last_failed_at).toLocaleString("fr-FR")}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {(Object.keys(LABELS) as Action[]).map((a) => {
                  const key = `${g.type}/${g.error_code}/${a}`;
                  return (
                    <button
                      key={a}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => run(g, a)}
                      className={`rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                        armed === key
                          ? "border-[var(--red)] bg-[var(--red)]/15 text-[var(--red)]"
                          : "border-[var(--border-gold)] text-[var(--text-secondary)] hover:border-[var(--gold)]/50 hover:text-[var(--gold)]"
                      }`}
                    >
                      {busy === key ? "…" : armed === key ? `Confirmer (${g.count})` : LABELS[a]}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
