"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Matrice de la file : pour chaque type de job, combien attendent, sont en
 * cours, ont échoué. Un chiffre ouvre la liste filtrée juste en dessous.
 * Rafraîchie toutes les 30 s.
 */
interface Row {
  type: string;
  pending: number;
  claimed: number;
  failed: number;
}

const COLS = [
  { key: "pending", label: "En attente", tone: "text-[var(--cyan)]" },
  { key: "claimed", label: "En cours", tone: "text-[var(--gold)]" },
  { key: "failed", label: "Échoués", tone: "text-[var(--red)]" },
] as const;

export function QueueMatrix() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/admin/pipeline/queue?summary=1", { cache: "no-store" });
        const d = (await r.json()) as { rows?: Row[]; error?: string };
        if (!alive) return;
        if (!r.ok) setError(d.error ?? `HTTP ${r.status}`);
        else {
          setError(null);
          setRows((d.rows ?? []).sort((a, b) => b.pending + b.failed - (a.pending + a.failed)));
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const totals = COLS.map((c) => (rows ?? []).reduce((n, r) => n + r[c.key], 0));

  return (
    <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-bold uppercase tracking-widest text-[var(--gold)]">File par type</h2>
        {rows && (
          <p className="font-data text-xs text-[var(--text-muted)]">
            {totals[0].toLocaleString("fr-FR")} en attente · {totals[1].toLocaleString("fr-FR")} en cours ·{" "}
            {totals[2].toLocaleString("fr-FR")} échoués
          </p>
        )}
      </div>
      {error && <p className="text-xs text-[var(--red)]">Lecture impossible : {error}</p>}
      {!rows && !error && <p className="text-xs text-[var(--text-muted)]">Chargement…</p>}
      {rows && rows.length === 0 && <p className="text-xs text-[var(--text-muted)]">File vide.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                <th className="py-1.5 pr-4 font-normal">Type</th>
                {COLS.map((c) => (
                  <th key={c.key} className="py-1.5 pr-4 text-right font-normal">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.type} className="border-t border-[var(--border-subtle)]">
                  <td className="py-1.5 pr-4 font-mono text-[var(--text-secondary)]">{r.type}</td>
                  {COLS.map((c) => (
                    <td key={c.key} className="py-1.5 pr-4 text-right font-data tabular-nums">
                      {r[c.key] > 0 ? (
                        <Link
                          href={`/admin/pipeline/jobs?kind=${encodeURIComponent(r.type)}&status=${c.key}&age=all`}
                          className={`${c.tone} hover:underline`}
                        >
                          {r[c.key].toLocaleString("fr-FR")}
                        </Link>
                      ) : (
                        <span className="text-[var(--text-disabled)]">0</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
