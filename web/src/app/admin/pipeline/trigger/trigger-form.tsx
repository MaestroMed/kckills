"use client";

import { useState } from "react";
import Link from "next/link";

const JOB_KINDS = [
  {
    kind: "reanalyze_kill",
    label: "Re-analyser un kill",
    desc: "Force le worker à re-faire l'analyse Gemini sur un clip (avec vidéo).",
    fields: [{ name: "kill_id", label: "Kill ID (UUID)", type: "text", required: true }],
  },
  {
    kind: "reclip_kill",
    label: "Re-clipper un kill",
    desc: "Force le worker à re-télécharger le VOD et re-couper le clip.",
    fields: [{ name: "kill_id", label: "Kill ID (UUID)", type: "text", required: true }],
  },
  {
    kind: "regen_og",
    label: "Régénérer l'OG image",
    desc: "Recrée la thumbnail OG (1200×630) pour le partage social.",
    fields: [{ name: "kill_id", label: "Kill ID (UUID)", type: "text", required: true }],
  },
  {
    kind: "regen_audit_targets",
    label: "Régénérer les 45 descriptions audit",
    desc: "Reset + re-analyse les 45 clips identifiés par l'audit Opus 4.7.",
    fields: [],
  },
  {
    kind: "backfill_assists_game",
    label: "Backfill assists pour une game",
    desc: "Re-harvest les assists depuis le livestats feed (game récente uniquement).",
    fields: [{ name: "game_id", label: "Game external ID", type: "text", required: true }],
  },
  {
    kind: "reanalyze_backlog",
    label: "Re-analyser le backlog",
    desc: "Re-passe Gemini sur tous les clips marqués 'needs_reclip'.",
    fields: [],
  },
];

export function TriggerForm() {
  const [selectedKind, setSelectedKind] = useState(JOB_KINDS[0].kind);
  const [payload, setPayload] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const job = JOB_KINDS.find((j) => j.kind === selectedKind)!;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/admin/pipeline/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: selectedKind, payload }),
      });
      const data = await r.json();
      if (r.ok) {
        setResult(`Job enqueued: ${data.job?.id ?? "ok"}. Le worker le traitera au prochain cycle (~30s-5min).`);
        setPayload({});
      } else {
        setError(data.error ?? "Erreur");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <header>
        <Link href="/admin/pipeline" className="text-xs text-[var(--text-muted)] hover:text-[var(--gold)]">
          ← Pipeline
        </Link>
        <h1 className="font-display text-2xl font-black text-[var(--gold)] mt-1">Trigger Job</h1>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Insère un job dans la queue. Le worker daemon le traite dès qu&apos;il polle (toutes les ~30s).
        </p>
      </header>

      <form onSubmit={submit} className="space-y-4">
        {/* Job kind selector */}
        <div>
          <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            Type de job
          </label>
          <select
            value={selectedKind}
            onChange={(e) => {
              setSelectedKind(e.target.value);
              setPayload({});
            }}
            className="mt-1 w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
          >
            {JOB_KINDS.map((j) => (
              <option key={j.kind} value={j.kind}>{j.label}</option>
            ))}
          </select>
          <p className="text-xs text-[var(--text-muted)] mt-1">{job.desc}</p>
        </div>

        {/* Dynamic payload fields */}
        {job.fields.map((f) => (
          <div key={f.name}>
            <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              {f.label}
            </label>
            <input
              type={f.type}
              required={f.required}
              value={payload[f.name] ?? ""}
              onChange={(e) => setPayload((prev) => ({ ...prev, [f.name]: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-mono"
            />
          </div>
        ))}

        {job.fields.length === 0 && (
          <p className="rounded-lg border border-[var(--text-muted)]/30 bg-[var(--bg-elevated)]/50 px-3 py-2 text-xs text-[var(--text-muted)]">
            Aucun paramètre requis.
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-[var(--gold)] px-4 py-2.5 text-sm font-bold text-black hover:bg-[var(--gold-bright)] disabled:opacity-50"
          >
            {submitting ? "Enqueue..." : "Insérer dans la queue"}
          </button>
          <Link
            href="/admin/pipeline/jobs"
            className="rounded-lg border border-[var(--border-gold)] px-4 py-2.5 text-sm text-[var(--text-muted)] hover:text-[var(--gold)]"
          >
            Voir la queue
          </Link>
        </div>

        {result && <p className="rounded-lg bg-[var(--green)]/10 border border-[var(--green)]/30 px-3 py-2 text-xs text-[var(--green)]">{result}</p>}
        {error && <p className="rounded-lg bg-[var(--red)]/10 border border-[var(--red)]/30 px-3 py-2 text-xs text-[var(--red)]">{error}</p>}
      </form>

      <div className="rounded-lg border border-[var(--orange)]/30 bg-[var(--orange)]/5 p-3 text-xs text-[var(--text-muted)]">
        <p className="font-bold text-[var(--orange)] mb-1">⚠ Worker side</p>
        <p>
          Le worker daemon doit être configuré pour poller la table <code className="font-mono">worker_jobs</code>.
          Si le job reste en &apos;pending&apos; plus de 5 min, le worker n&apos;est pas connecté à cette table.
        </p>
      </div>
    </div>
  );
}
