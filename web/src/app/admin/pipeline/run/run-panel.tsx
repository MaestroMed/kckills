"use client";

/**
 * /admin/pipeline/run — One-click trigger panel for whitelisted backfills.
 *
 * Each card maps to one POST endpoint that enqueues a `worker.backfill`
 * pipeline_job. The worker-side admin_job_runner (modules/admin_job_runner.py)
 * claims the job, validates the script against its whitelist, and shells
 * out via subprocess.run.
 *
 * Wave 12 EC polish :
 *   - Breadcrumbs + page title row
 *   - Each script as an AdminCard with description + form fields
 *   - Confirmation dialog before destructive (non dry-run) operations
 *   - Toast on submission + on error (replaces inline result strip)
 *   - Recent runs table at the bottom (worker.backfill jobs from
 *     pipeline_jobs, last 20)
 *
 * The whitelist enforcement is SERVER-SIDE on the worker AND on the
 * API endpoint — the UI is a convenience layer. See the route handlers
 * under api/admin/pipeline/run/* for the per-endpoint validation.
 */
import Link from "next/link";
import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { AdminButton } from "@/components/admin/ui/AdminButton";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";

type RunResult =
  | { status: "pending" }
  | { status: "ok"; jobId?: string; message: string }
  | { status: "error"; message: string };

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
  /** Whether to require an extra confirm step when dry_run=false. */
  destructive?: boolean;
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
    destructive: true,
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
    destructive: true,
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

interface RecentRun {
  id: string;
  type: string;
  payload: { script?: string } | null;
  status: string;
  created_at: string;
  finished_at: string | null;
  result: { exit_code?: number } | null;
  last_error: string | null;
}

interface Toast {
  id: number;
  tone: "success" | "error";
  text: string;
}

let toastSeq = 0;

export function RunPanel() {
  const [results, setResults] = useState<Record<string, RunResult | undefined>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [formState, setFormState] = useState<Record<string, Record<string, unknown>>>({});
  const [pendingConfirm, setPendingConfirm] = useState<RunButton | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((tone: Toast["tone"], text: string) => {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, tone, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const sb = useMemo(() => createBrowserSupabase(), []);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const { data, error } = await sb
        .from("pipeline_jobs")
        .select("id, type, payload, status, created_at, finished_at, result, last_error")
        .eq("type", "worker.backfill")
        .order("created_at", { ascending: false })
        .limit(20);
      if (!error && data) {
        setRecentRuns(data as unknown as RecentRun[]);
      }
    } finally {
      setRecentLoading(false);
    }
  }, [sb]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const setField = (btnKey: string, name: string, value: unknown) => {
    setFormState((prev) => ({
      ...prev,
      [btnKey]: { ...(prev[btnKey] ?? {}), [name]: value },
    }));
  };

  const buildBody = (btn: RunButton): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    for (const f of btn.fields ?? []) {
      const stateVal = formState[btn.key]?.[f.name];
      if (stateVal !== undefined && stateVal !== "") {
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
    return body;
  };

  const isDestructiveCall = (btn: RunButton): boolean => {
    if (!btn.destructive) return false;
    // If the form has a dry_run field that's currently true, no confirm
    // is needed — the operator is just previewing.
    const stateVal = formState[btn.key]?.dry_run;
    const dry =
      stateVal !== undefined
        ? Boolean(stateVal)
        : btn.fields?.find((f) => f.name === "dry_run")?.defaultValue === true;
    return !dry;
  };

  const runButton = async (btn: RunButton) => {
    setPending(btn.key);
    setResults((prev) => ({ ...prev, [btn.key]: { status: "pending" } }));
    const body = buildBody(btn);

    try {
      const r = await fetch(btn.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (r.ok) {
        const jobId = data.job?.id;
        const message =
          `Job enqueué (${data.job?.type ?? "worker.backfill"}). ` +
          `Voir /admin/pipeline/jobs.`;
        setResults((prev) => ({
          ...prev,
          [btn.key]: { status: "ok", jobId, message },
        }));
        pushToast(
          "success",
          `${btn.label} : job enqueué${jobId ? ` (${jobId.slice(0, 8)})` : ""}.`,
        );
        void loadRecent();
      } else {
        const msg = data.error ?? `HTTP ${r.status}`;
        setResults((prev) => ({
          ...prev,
          [btn.key]: { status: "error", message: msg },
        }));
        pushToast("error", `${btn.label} : ${msg}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fetch failed";
      setResults((prev) => ({
        ...prev,
        [btn.key]: { status: "error", message: msg },
      }));
      pushToast("error", `${btn.label} : ${msg}`);
    } finally {
      setPending(null);
    }
  };

  const requestRun = (btn: RunButton) => {
    if (isDestructiveCall(btn)) {
      setPendingConfirm(btn);
      return;
    }
    void runButton(btn);
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <header>
        <nav
          aria-label="Fil d'Ariane"
          className="text-[10px] text-[var(--text-muted)] mb-1 flex items-center gap-1.5"
        >
          <Link href="/admin/pipeline" className="hover:text-[var(--gold)]">
            Pipeline
          </Link>
          <span aria-hidden>›</span>
          <span className="text-[var(--text-secondary)]">Run</span>
        </nav>
        <h1 className="font-display text-2xl font-black text-[var(--gold)] mt-1">
          Pipeline Run
        </h1>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          One-click triggers pour les scripts opérationnels. Chaque bouton
          insère un job <code className="font-mono">worker.backfill</code> dans
          la queue ; le worker exécute via un whitelist server-side.
        </p>
      </header>

      <div className="space-y-4">
        {RUN_BUTTONS.map((btn) => {
          const result = results[btn.key];
          const isPending = pending === btn.key;
          const lastRun = recentRuns.find(
            (r) => r.payload?.script === btn.key,
          );
          return (
            <AdminCard
              key={btn.key}
              title={
                <span className="flex items-center gap-2">
                  <span>{btn.label}</span>
                  {btn.destructive && (
                    <AdminBadge variant="danger" size="sm">
                      destructif
                    </AdminBadge>
                  )}
                </span>
              }
              titleAction={
                lastRun ? (
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">
                    last:{" "}
                    <Link
                      href={`/admin/pipeline/jobs/${lastRun.id}`}
                      className="hover:text-[var(--gold)] underline"
                    >
                      {lastRun.status}
                    </Link>{" "}
                    · {relativeTime(lastRun.created_at)}
                  </span>
                ) : null
              }
            >
              <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3">
                {btn.desc}
              </p>

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

              <div className="flex items-center gap-3 pt-3">
                <AdminButton
                  type="button"
                  variant="primary"
                  size="md"
                  loading={isPending}
                  onClick={() => requestRun(btn)}
                >
                  {btn.label}
                </AdminButton>
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
                <p className="rounded-lg bg-[var(--green)]/10 border border-[var(--green)]/30 px-3 py-2 text-xs text-[var(--green)] mt-3">
                  {result.message}
                </p>
              )}
              {result?.status === "error" && (
                <p className="rounded-lg bg-[var(--red)]/10 border border-[var(--red)]/30 px-3 py-2 text-xs text-[var(--red)] mt-3">
                  Erreur : {result.message}
                </p>
              )}
            </AdminCard>
          );
        })}
      </div>

      {/* Recent runs */}
      <AdminCard
        title="Recent runs (worker.backfill, last 20)"
        titleAction={
          <button
            type="button"
            onClick={() => void loadRecent()}
            className="text-[10px] text-[var(--gold)] hover:underline"
          >
            ↻ Rafraîchir
          </button>
        }
        variant="dense"
      >
        {recentLoading ? (
          <div className="p-6 text-center text-xs text-[var(--text-muted)]">
            Chargement…
          </div>
        ) : recentRuns.length === 0 ? (
          <div className="p-6 text-center text-xs text-[var(--text-muted)]">
            Aucun run récent.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-elevated)] border-b border-[var(--border-gold)] text-left">
              <tr>
                <th className="px-3 py-2 w-32">Script</th>
                <th className="px-3 py-2 w-24">Status</th>
                <th className="px-3 py-2 w-32">Created</th>
                <th className="px-3 py-2 w-20">Exit</th>
                <th className="px-3 py-2">Last error</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--border-gold)]/20 hover:bg-[var(--bg-elevated)]/40"
                >
                  <td className="px-3 py-2 font-mono">
                    <Link
                      href={`/admin/pipeline/jobs/${r.id}`}
                      className="text-[var(--gold)] hover:underline"
                    >
                      {r.payload?.script ?? "?"}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge variant={runStatusVariant(r.status)}>
                      {r.status}
                    </AdminBadge>
                  </td>
                  <td className="px-3 py-2 text-[10px] text-[var(--text-muted)]">
                    {relativeTime(r.created_at)}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px]">
                    {r.result?.exit_code ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-[var(--red)] truncate">
                    {r.last_error?.slice(0, 80) ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AdminCard>

      <div className="rounded-lg border border-[var(--orange)]/30 bg-[var(--orange)]/5 p-3 text-xs text-[var(--text-muted)]">
        <p className="font-bold text-[var(--orange)] mb-1">Sécurité</p>
        <p>
          Chaque endpoint vérifie <code className="font-mono">requireAdmin()</code>{" "}
          et logge dans <code className="font-mono">admin_actions</code>. Côté
          worker, le script name est validé contre une whitelist hard-codée
          (<code className="font-mono">admin_job_runner.SCRIPT_WHITELIST</code>) — un
          payload inattendu fail le job avec error_code=&quot;forbidden_script&quot;.
        </p>
      </div>

      <ConfirmDialog
        open={pendingConfirm !== null}
        title={`Lancer ${pendingConfirm?.label ?? ""} ?`}
        message={
          "Cette action va exécuter le script en mode réel (pas dry run). " +
          "Confirme pour insérer le job dans la queue."
        }
        confirmLabel="Lancer"
        cancelLabel="Annuler"
        destructive
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const btn = pendingConfirm;
          setPendingConfirm(null);
          if (btn) void runButton(btn);
        }}
      />

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

function runStatusVariant(
  status: string,
): "success" | "warn" | "danger" | "info" | "pending" | "neutral" {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "claimed":
      return "pending";
    case "pending":
      return "info";
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}j`;
}
