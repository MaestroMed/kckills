"use client";

/**
 * Legacy ad-hoc trigger form (Wave 4). Kept for the per-kill ops actions
 * (reanalyze_kill, regen_og, etc.) that haven't been migrated to the new
 * pipeline_jobs flow yet.
 *
 * Wave 12 EC adds :
 *   - Breadcrumbs + deprecation banner pointing operators at /run for
 *     orchestration-level commands
 *   - Toast feedback on submission
 *
 * The endpoint behind it (POST /api/admin/pipeline/jobs) still writes to
 * the legacy `worker_jobs` table — see job kinds whitelist there.
 */
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { AdminButton } from "@/components/admin/ui/AdminButton";

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

interface Toast {
  id: number;
  tone: "success" | "error";
  text: string;
}

let toastSeq = 0;

export function TriggerForm() {
  const [selectedKind, setSelectedKind] = useState(JOB_KINDS[0].kind);
  const [payload, setPayload] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((tone: Toast["tone"], text: string) => {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, tone, text }]);
  }, []);
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = window.setTimeout(() => setToasts((prev) => prev.slice(1)), 4000);
    return () => window.clearTimeout(t);
  }, [toasts]);

  const job = JOB_KINDS.find((j) => j.kind === selectedKind)!;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch("/api/admin/pipeline/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: selectedKind, payload }),
      });
      const data = await r.json();
      if (r.ok) {
        pushToast(
          "success",
          `Job enqueued (${data.job?.id?.slice(0, 8) ?? "ok"}). Worker traitera au prochain cycle.`,
        );
        setPayload({});
      } else {
        pushToast("error", `Erreur : ${data.error ?? `HTTP ${r.status}`}`);
      }
    } catch (err) {
      pushToast(
        "error",
        `Erreur : ${err instanceof Error ? err.message : "request failed"}`,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <header>
        <nav
          aria-label="Fil d'Ariane"
          className="text-[10px] text-[var(--text-muted)] mb-1 flex items-center gap-1.5"
        >
          <Link href="/admin/pipeline" className="hover:text-[var(--gold)]">
            Pipeline
          </Link>
          <span aria-hidden>›</span>
          <span className="text-[var(--text-secondary)]">Trigger (legacy)</span>
        </nav>
        <h1 className="font-display text-2xl font-black text-[var(--gold)] mt-1">
          Trigger Job (legacy)
        </h1>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Insère un job dans la queue legacy <code className="font-mono">worker_jobs</code>.
          Le worker daemon le traite au prochain cycle (~30s).
        </p>
      </header>

      {/* Deprecation banner */}
      <div className="rounded-xl border border-[var(--orange)]/40 bg-[var(--orange)]/10 p-4">
        <p className="text-sm font-bold text-[var(--orange)]">
          Page legacy — préfère{" "}
          <Link
            href="/admin/pipeline/run"
            className="underline hover:text-[var(--gold-bright)]"
          >
            /admin/pipeline/run
          </Link>{" "}
          pour les nouvelles opérations.
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Les actions ad-hoc per-kill (reanalyze, regen_og, …) restent ici en
          attendant leur migration vers le nouveau flow{" "}
          <code className="font-mono">pipeline_jobs</code>.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
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
              <option key={j.kind} value={j.kind}>
                {j.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--text-muted)] mt-1">{job.desc}</p>
        </div>

        {job.fields.map((f) => (
          <div key={f.name}>
            <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              {f.label}
            </label>
            <input
              type={f.type}
              required={f.required}
              value={payload[f.name] ?? ""}
              onChange={(e) =>
                setPayload((prev) => ({ ...prev, [f.name]: e.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-mono"
            />
          </div>
        ))}

        {job.fields.length === 0 && (
          <p className="rounded-lg border border-[var(--text-muted)]/30 bg-[var(--bg-elevated)]/50 px-3 py-2 text-xs text-[var(--text-muted)]">
            Aucun paramètre requis.
          </p>
        )}

        <div className="flex gap-2 items-center">
          <AdminButton
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
          >
            Insérer dans la queue
          </AdminButton>
          <Link
            href="/admin/pipeline/jobs"
            className="rounded-lg border border-[var(--border-gold)] px-4 py-2.5 text-sm text-[var(--text-muted)] hover:text-[var(--gold)]"
          >
            Voir la queue
          </Link>
        </div>
      </form>

      <div className="rounded-lg border border-[var(--orange)]/30 bg-[var(--orange)]/5 p-3 text-xs text-[var(--text-muted)]">
        <p className="font-bold text-[var(--orange)] mb-1">Worker side</p>
        <p>
          Le worker daemon doit être configuré pour poller la table{" "}
          <code className="font-mono">worker_jobs</code>. Si le job reste en
          &apos;pending&apos; plus de 5 min, le worker n&apos;est pas connecté à
          cette table.
        </p>
      </div>

      {/* Toast stack */}
      <div
        className="fixed top-20 right-4 z-50 space-y-2 pointer-events-none"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-3 py-2 text-xs font-medium shadow-2xl shadow-black/40 max-w-sm ${
              t.tone === "success"
                ? "border-[var(--green)]/60 bg-[var(--green)]/15 text-[var(--green)]"
                : "border-[var(--red)]/60 bg-[var(--red)]/15 text-[var(--red)]"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
