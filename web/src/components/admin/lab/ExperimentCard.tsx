"use client";

/**
 * ExperimentCard — single A/B (or A/B/n) experiment summary card
 * (PR-loltok EE).
 *
 * The /admin/lab page lists active and historical experiments. Each
 * experiment has a name, hypothesis, variants with allocation %, sample
 * size, lift % and a significance indicator. The card supports running /
 * paused / concluded states with appropriate badges + actions.
 *
 * Currently no experiment infrastructure is wired in production — this
 * is the surface for when we wire pgvector recommendation, scroll feed
 * algorithm tweaks, notification copy A/Bs, etc. The card is built so
 * the lab page can render mock data today and real data tomorrow.
 */

import { AdminButton } from "@/components/admin/ui/AdminButton";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";

export type ExperimentStatus = "running" | "paused" | "concluded" | "draft";

export interface ExperimentVariant {
  name: string;
  allocation: number; // 0–100 (%)
  sample_size: number;
  metric_value?: number; // primary metric (e.g. CTR or session length)
  is_winner?: boolean;
}

export interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  status: ExperimentStatus;
  variants: ExperimentVariant[];
  start_date: string; // ISO
  duration_days?: number;
  /** Lift of the leading variant vs control, in %. Negative means worse. */
  lift_pct?: number;
  /** p-value or significance indicator. < 0.05 = significant. */
  p_value?: number;
  /** Primary metric label (e.g. "CTR clip detail"). */
  metric_label?: string;
}

interface Props {
  experiment: Experiment;
  onPause?: () => void;
  onConclude?: () => void;
  onResume?: () => void;
  onView?: () => void;
}

const STATUS_VARIANT: Record<
  ExperimentStatus,
  { variant: "success" | "warn" | "neutral" | "info"; label: string }
> = {
  running: { variant: "success", label: "En cours" },
  paused: { variant: "warn", label: "En pause" },
  concluded: { variant: "neutral", label: "Terminée" },
  draft: { variant: "info", label: "Brouillon" },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function ExperimentCard({
  experiment,
  onPause,
  onConclude,
  onResume,
  onView,
}: Props) {
  const status = STATUS_VARIANT[experiment.status];
  const isSignificant =
    experiment.p_value != null && experiment.p_value < 0.05;
  const totalSample = experiment.variants.reduce(
    (acc, v) => acc + v.sample_size,
    0,
  );

  return (
    <article className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 space-y-3">
      {/* Header */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <AdminBadge
              variant={status.variant}
              pulse={experiment.status === "running"}
            >
              {status.label}
            </AdminBadge>
            {isSignificant && (
              <AdminBadge variant="success" icon="★">
                Significatif
              </AdminBadge>
            )}
          </div>
          <h3 className="font-display text-base font-bold text-[var(--gold)]">
            {experiment.name}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            « {experiment.hypothesis} »
          </p>
        </div>
      </header>

      {/* Dates + sample */}
      <div className="flex flex-wrap gap-3 text-[11px] text-[var(--text-muted)]">
        <span>
          Début :{" "}
          <span className="font-mono text-[var(--text-secondary)]">
            {formatDate(experiment.start_date)}
          </span>
        </span>
        {experiment.duration_days && (
          <span>
            Durée :{" "}
            <span className="font-mono text-[var(--text-secondary)]">
              {experiment.duration_days}j
            </span>
          </span>
        )}
        <span>
          Échantillon :{" "}
          <span className="font-mono text-[var(--text-secondary)]">
            {formatNumber(totalSample)}
          </span>
        </span>
      </div>

      {/* Variant allocation bar */}
      <div className="space-y-1.5">
        <p className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          Allocation
        </p>
        <div className="flex h-2 w-full overflow-hidden rounded-full border border-[var(--border-gold)]/40 bg-[var(--bg-primary)]">
          {experiment.variants.map((v, i) => (
            <div
              key={v.name}
              className="border-r border-[var(--bg-primary)] last:border-r-0"
              style={{
                width: `${v.allocation}%`,
                background:
                  i === 0
                    ? "var(--gold)"
                    : i === 1
                      ? "var(--cyan)"
                      : "var(--orange)",
              }}
              title={`${v.name} : ${v.allocation}%`}
            />
          ))}
        </div>
      </div>

      {/* Variants table */}
      <ul className="space-y-1.5">
        {experiment.variants.map((v, i) => (
          <li
            key={v.name}
            className="flex items-center gap-2 text-[11px]"
          >
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background:
                  i === 0
                    ? "var(--gold)"
                    : i === 1
                      ? "var(--cyan)"
                      : "var(--orange)",
              }}
            />
            <span
              className={`flex-1 ${v.is_winner ? "font-bold text-[var(--green)]" : "text-[var(--text-secondary)]"}`}
            >
              {v.name}
              {v.is_winner && (
                <span className="ml-1.5 text-[var(--green)]" aria-hidden="true">
                  ★
                </span>
              )}
            </span>
            <span className="font-mono text-[var(--text-disabled)]">
              {v.allocation}%
            </span>
            <span className="font-mono text-[var(--text-muted)]">
              n={formatNumber(v.sample_size)}
            </span>
            {v.metric_value != null && (
              <span className="font-mono text-[var(--text-primary)]">
                {v.metric_value.toFixed(2)}
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* Lift + significance */}
      {experiment.lift_pct != null && (
        <div className="flex items-baseline gap-3 rounded-lg border border-[var(--border-gold)]/40 bg-[var(--bg-primary)] p-2.5">
          <div>
            <p className="font-display text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
              Lift
            </p>
            <p
              className={`font-data text-lg font-black ${
                experiment.lift_pct > 0
                  ? "text-[var(--green)]"
                  : experiment.lift_pct < 0
                    ? "text-[var(--red)]"
                    : "text-[var(--text-secondary)]"
              }`}
            >
              {experiment.lift_pct > 0 ? "+" : ""}
              {experiment.lift_pct.toFixed(1)}%
            </p>
          </div>
          {experiment.metric_label && (
            <p className="text-[10px] text-[var(--text-disabled)]">
              vs control sur{" "}
              <span className="text-[var(--text-secondary)]">
                {experiment.metric_label}
              </span>
            </p>
          )}
          {experiment.p_value != null && (
            <p className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">
              p={experiment.p_value.toFixed(3)}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {experiment.status === "running" && onPause && (
          <AdminButton size="sm" variant="secondary" onClick={onPause}>
            Pause
          </AdminButton>
        )}
        {experiment.status === "paused" && onResume && (
          <AdminButton size="sm" variant="primary" onClick={onResume}>
            Reprendre
          </AdminButton>
        )}
        {(experiment.status === "running" || experiment.status === "paused") &&
          onConclude && (
            <AdminButton size="sm" variant="danger" onClick={onConclude}>
              Conclure
            </AdminButton>
          )}
        {onView && (
          <AdminButton size="sm" variant="ghost" onClick={onView}>
            Détails →
          </AdminButton>
        )}
      </div>
    </article>
  );
}
