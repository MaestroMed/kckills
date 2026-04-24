"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Result rendered under each button after the operator clicks.
 *
 * `status` differentiates the optimistic pending UI from the API
 * response so we can swap colours without rebuilding the layout.
 */
type RunResult =
  | { status: "pending" }
  | { status: "ok"; jobId?: string; message: string }
  | { status: "error"; message: string };

/** Button config — each entry maps to one POST endpoint. */
interface RunButton {
  key: string;
  label: string;
  desc: string;
  endpoint: string;
  /** Optional inline form fields rendered before the action button. */
  fields?: Array<{
    name: string;
    label: string;
    type: "text" | "number" | "checkbox" | "select";
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
    defaultValue?: string | boolean;
    help?: string;
  }>;
}

const RUN_BUTTONS: RunButton[] = [
  {
    key: "backfill_clip_errors",
    label: "Backfill clip_errors",
    desc:
      "Re-enqueue tous les kills coincés à status='clip_error' (retry_count<3) en jobs clip.create. " +
      "Idempotent grâce au unique-index sur (type, entity_type, entity_id) WHERE status IN ('pending','claimed'). " +
      "Score-based priority — les meilleurs clips repartent en premier.",
    endpoint: "/api/admin/pipeline/run/backfill-clip-errors",
    fields: [
      {
        name: "dry_run",
        label: "Dry run (count seulement, pas d'écriture)",
        type: "checkbox",
        defaultValue: true,
      },
      {
        name: "min_score",
        label: "Score minimum (0–10)",
        type: "number",
        placeholder: "0.0",
        help: "Seuls les kills avec highlight_score >= ce seuil sont re-enqueué. 0 = tous.",
      },
    ],
  },
  {
    key: "backfill_stuck_pipeline",
    label: "Backfill stuck pipeline",
    desc:
      "Re-enqueue les kills bloqués mid-pipeline : manual_review / vod_found / clipped / analyzed. " +
      "Pour manual_review, qc_status in {failed, rejected} est skippé (on ne ré-active pas ce que QC a tué). " +
      "Choisis 'all' pour vider les 4 buckets en un coup.",
    endpoint: "/api/admin/pipeline/run/backfill-stuck",
    fields: [
      {
        name: "state",
        label: "État",
        type: "select",
        options: [
          { value: "all", label: "all (les 4 buckets)" },
          { value: "manual_review", label: "manual_review (priority 30)" },
          { value: "vod_found", label: "vod_found (-> clip.create)" },
          { value: "clipped", label: "clipped (-> clip.analyze)" },
          { value: "analyzed", label: "analyzed (-> publish.check)" },
        ],
        defaultValue: "all",
      },
      {
        name: "dry_run",
        label: "Dry run",
        type: "checkbox",
        defaultValue: true,
      },
      {
        name: "since",
        label: "Depuis (jours)",
        type: "number",
        placeholder: "90",
        help: "Cap sur created_at pour ne pas réveiller des fossiles.",
      },
      {
        name: "min_score",
        label: "Score minimum",
        type: "number",
        placeholder: "0.0",
      },
    ],
  },
  {
    key: "recon_videos_now",
    label: "Run channel reconciler now",
    desc:
      "Force le channel_reconciler à matcher immédiatement les videos backfill (Kameto / @LCSEsports / etc.) " +
      "sans attendre le cycle horaire. Utile après avoir seedé un nouveau channel ou fixé un bug de matching.",
    endpoint: "/api/admin/pipeline/run/recon-channels",
    fields: [],
  },
];


export function RunPanel() {
  // results keyed by button key — independent state so 3 buttons
  // can show 3 different messages without colliding.
  const [results, setResults] = useState<Record<string, RunResult | undefined>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [formState, setFormState] = useState<Record<string, Record<string, unknown>>>({});

  const setField = (btnKey: string, name: string, value: unknown) => {
    setFormState((prev) => ({
      ...prev,
      [btnKey]: { ...(prev[btnKey] ?? {}), [name]: value },
    }));
  };

  const runButton = async (btn: RunButton) => {
    setPending(btn.key);
    setResults((prev) => ({ ...prev, [btn.key]: { status: "pending" } }));

    // Compose the body from per-field state, applying defaults so
    // the operator doesn't have to touch every field every time.
    const body: Record<string, unknown> = {};
    for (const f of btn.fields ?? []) {
      const stateVal = formState[btn.key]?.[f.name];
      if (stateVal !== undefined && stateVal !== "") {
        // Coerce numeric fields server-side too, but client coercion
        // means the JSON arrives as a number not a string.
        if (f.type === "number") {
          const n = Number(stateVal);
          if (!Number.isNaN(n)) body[f.name] = n;
        } else if (f.type === "checkbox") {
          body[f.name] = Boolean(stateVal);
        } else {
          body[f.name] = stateVal;
        }
      } else if (f.defaultValue !== undefined) {
        body[f.name] = f.defaultValue;
      }
    }

    try {
      const r = await fetch(btn.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (r.ok) {
        setResults((prev) => ({
          ...prev,
          [btn.key]: {
            status: "ok",
            jobId: data.job?.id,
            message:
              `Job enqueué (${data.job?.type ?? "worker.backfill"}). ` +
              `Le worker l'execute au prochain cycle (~30s). ` +
              `Suivre l'avancement sur /admin/pipeline/jobs.`,
          },
        }));
      } else {
        setResults((prev) => ({
          ...prev,
          [btn.key]: {
            status: "error",
            message: data.error ?? `HTTP ${r.status}`,
          },
        }));
      }
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [btn.key]: {
          status: "error",
          message: err instanceof Error ? err.message : "fetch failed",
        },
      }));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <header>
        <Link
          href="/admin/pipeline"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--gold)]"
        >
          ← Pipeline
        </Link>
        <h1 className="font-display text-2xl font-black text-[var(--gold)] mt-1">
          Pipeline Run
        </h1>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          One-click triggers pour les scripts opérationnels. Chaque bouton
          insère un job <code className="font-mono">worker.backfill</code> dans la queue ;
          le worker exécute via un whitelist server-side.
        </p>
      </header>

      <div className="space-y-4">
        {RUN_BUTTONS.map((btn) => {
          const result = results[btn.key];
          const isPending = pending === btn.key;
          return (
            <section
              key={btn.key}
              className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 space-y-3"
            >
              <header>
                <h2 className="font-display text-base font-bold text-[var(--gold)]">
                  {btn.label}
                </h2>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {btn.desc}
                </p>
              </header>

              {(btn.fields?.length ?? 0) > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {btn.fields!.map((f) => {
                    const stateVal = formState[btn.key]?.[f.name];
                    const value =
                      stateVal !== undefined ? stateVal : f.defaultValue;
                    return (
                      <div key={f.name}>
                        <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                          {f.label}
                        </label>
                        {f.type === "checkbox" ? (
                          <div className="mt-1 flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={Boolean(value)}
                              onChange={(e) =>
                                setField(btn.key, f.name, e.target.checked)
                              }
                              className="h-4 w-4 rounded border-[var(--border-gold)] bg-[var(--bg-primary)]"
                            />
                            <span className="text-xs text-[var(--text-secondary)]">
                              {value ? "activé" : "désactivé"}
                            </span>
                          </div>
                        ) : f.type === "select" ? (
                          <select
                            value={String(value ?? "")}
                            onChange={(e) =>
                              setField(btn.key, f.name, e.target.value)
                            }
                            className="mt-1 w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                          >
                            {f.options?.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={f.type}
                            placeholder={f.placeholder}
                            value={String(value ?? "")}
                            onChange={(e) =>
                              setField(btn.key, f.name, e.target.value)
                            }
                            className="mt-1 w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-mono"
                          />
                        )}
                        {f.help && (
                          <p className="text-[10px] text-[var(--text-muted)] mt-1">
                            {f.help}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => runButton(btn)}
                  className="rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-bold text-black hover:bg-[var(--gold-bright)] disabled:opacity-50"
                >
                  {isPending ? "Enqueue…" : btn.label}
                </button>
                {result?.status === "ok" && result.jobId && (
                  <Link
                    href={`/admin/pipeline/jobs/${result.jobId}`}
                    className="text-xs text-[var(--gold)] hover:underline"
                  >
                    Voir le job →
                  </Link>
                )}
              </div>

              {result?.status === "ok" && (
                <p className="rounded-lg bg-[var(--green)]/10 border border-[var(--green)]/30 px-3 py-2 text-xs text-[var(--green)]">
                  {result.message}
                </p>
              )}
              {result?.status === "error" && (
                <p className="rounded-lg bg-[var(--red)]/10 border border-[var(--red)]/30 px-3 py-2 text-xs text-[var(--red)]">
                  Erreur : {result.message}
                </p>
              )}
            </section>
          );
        })}
      </div>

      <div className="rounded-lg border border-[var(--orange)]/30 bg-[var(--orange)]/5 p-3 text-xs text-[var(--text-muted)]">
        <p className="font-bold text-[var(--orange)] mb-1">Sécurité</p>
        <p>
          Chaque endpoint vérifie <code className="font-mono">requireAdmin()</code> et logge
          dans <code className="font-mono">admin_actions</code>. Côté worker, le script
          name est validé contre une whitelist hard-codée
          (<code className="font-mono">admin_job_runner.SCRIPT_WHITELIST</code>) — un payload
          inattendu fail le job avec error_code=&quot;forbidden_script&quot;.
        </p>
      </div>
    </div>
  );
}
