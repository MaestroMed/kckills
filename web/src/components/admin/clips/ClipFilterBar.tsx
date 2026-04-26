"use client";

/**
 * ClipFilterBar — unified filter row for /admin/clips.
 *
 * Owned by Agent ED. Mirrors the pattern of `JobsFilterBar` (Agent EC)
 * but adapted for the clip library taxonomy : status / KC role /
 * multi-kill / score range / date range / free-text.
 *
 * Defensive: consumes Agent EA's primitives (`AdminButton`) but ships its
 * own chip + range-slider markup so it stays useful even if EA's fuller
 * `AdminFilterChips` primitive lands later.
 */

import { AdminButton } from "@/components/admin/ui/AdminButton";

export type ClipStatusFilter =
  | "all"
  | "clipped"
  | "analyzed"
  | "published"
  | "clip_error"
  | "manual_review";

export type KcRoleFilter = "any" | "team_killer" | "team_victim" | "team_assist";

export type MultiKillFilter = "any" | "double" | "triple" | "quadra" | "penta";

export interface ClipFilterValue {
  q: string;
  status: ClipStatusFilter;
  role: KcRoleFilter;
  multiKill: MultiKillFilter;
  scoreMin: number;
  scoreMax: number;
  dateFrom: string;
  dateTo: string;
  hidden: "false" | "true" | "only";
  hasDescription: "" | "true" | "false";
  fightTypes: string[];
}

export const DEFAULT_CLIP_FILTERS: ClipFilterValue = {
  q: "",
  status: "all",
  role: "team_killer",
  multiKill: "any",
  scoreMin: 1,
  scoreMax: 10,
  dateFrom: "",
  dateTo: "",
  hidden: "false",
  hasDescription: "",
  fightTypes: [],
};

const STATUS_OPTIONS: { value: ClipStatusFilter; label: string }[] = [
  { value: "all", label: "Tous statuts" },
  { value: "clipped", label: "Clippé" },
  { value: "analyzed", label: "Analysé" },
  { value: "published", label: "Publié" },
  { value: "clip_error", label: "Erreur clip" },
  { value: "manual_review", label: "Revue manuelle" },
];

const ROLE_OPTIONS: { value: KcRoleFilter; label: string }[] = [
  { value: "team_killer", label: "KC kills" },
  { value: "team_victim", label: "KC deaths" },
  { value: "team_assist", label: "KC assists" },
  { value: "any", label: "Tous" },
];

const MULTI_OPTIONS: { value: MultiKillFilter; label: string }[] = [
  { value: "any", label: "Tous kills" },
  { value: "double", label: "Double" },
  { value: "triple", label: "Triple" },
  { value: "quadra", label: "Quadra" },
  { value: "penta", label: "Penta" },
];

const FIGHT_TYPES = [
  "solo_kill",
  "pick",
  "gank",
  "skirmish_2v2",
  "skirmish_3v3",
  "teamfight_4v4",
  "teamfight_5v5",
];

interface Props {
  value: ClipFilterValue;
  onChange: (next: ClipFilterValue) => void;
  onReset?: () => void;
}

export function ClipFilterBar({ value, onChange, onReset }: Props) {
  const update = (patch: Partial<ClipFilterValue>) => onChange({ ...value, ...patch });

  const toggleFightType = (ft: string) => {
    const next = value.fightTypes.includes(ft)
      ? value.fightTypes.filter((x) => x !== ft)
      : [...value.fightTypes, ft];
    update({ fightTypes: next });
  };

  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3 space-y-3">
      {/* Row 1 — search + main selects */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={value.q}
          onChange={(e) => update({ q: e.target.value })}
          placeholder="Rechercher (description, champion, tags)…"
          className="flex-1 min-w-[240px] rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
          aria-label="Recherche dans les clips"
        />

        <select
          value={value.status}
          onChange={(e) => update({ status: e.target.value as ClipStatusFilter })}
          className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
          aria-label="Statut du clip"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={value.role}
          onChange={(e) => update({ role: e.target.value as KcRoleFilter })}
          className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
          aria-label="Rôle KC"
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={value.multiKill}
          onChange={(e) => update({ multiKill: e.target.value as MultiKillFilter })}
          className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
          aria-label="Multi-kill"
        >
          {MULTI_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={value.hidden}
          onChange={(e) =>
            update({ hidden: e.target.value as "false" | "true" | "only" })
          }
          className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
          aria-label="Visibilité"
        >
          <option value="false">Visibles + masqués</option>
          <option value="true">Visibles uniquement</option>
          <option value="only">Masqués uniquement</option>
        </select>

        <select
          value={value.hasDescription}
          onChange={(e) =>
            update({ hasDescription: e.target.value as "" | "true" | "false" })
          }
          className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
          aria-label="Description"
        >
          <option value="">Avec/sans description</option>
          <option value="true">Avec description</option>
          <option value="false">Sans description</option>
        </select>

        {onReset && (
          <AdminButton variant="ghost" size="sm" onClick={onReset}>
            Réinitialiser
          </AdminButton>
        )}
      </div>

      {/* Row 2 — score range + date range */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 min-w-[260px]">
          <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] whitespace-nowrap">
            Score
          </label>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={value.scoreMin}
            onChange={(e) =>
              update({
                scoreMin: Math.min(Number(e.target.value), value.scoreMax),
              })
            }
            className="flex-1 accent-[var(--gold)]"
            aria-label="Score minimum"
          />
          <span className="font-mono text-[11px] text-[var(--gold)] min-w-[2.4rem] text-right">
            {value.scoreMin.toFixed(1)}
          </span>
          <span className="text-[var(--text-muted)] text-[10px]">→</span>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={value.scoreMax}
            onChange={(e) =>
              update({
                scoreMax: Math.max(Number(e.target.value), value.scoreMin),
              })
            }
            className="flex-1 accent-[var(--gold)]"
            aria-label="Score maximum"
          />
          <span className="font-mono text-[11px] text-[var(--gold)] min-w-[2.4rem] text-right">
            {value.scoreMax.toFixed(1)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] whitespace-nowrap">
            Date
          </label>
          <input
            type="date"
            value={value.dateFrom}
            onChange={(e) => update({ dateFrom: e.target.value })}
            className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
            aria-label="Date de début"
          />
          <span className="text-[var(--text-muted)] text-[10px]">→</span>
          <input
            type="date"
            value={value.dateTo}
            onChange={(e) => update({ dateTo: e.target.value })}
            className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
            aria-label="Date de fin"
          />
        </div>
      </div>

      {/* Row 3 — fight type chips */}
      <div className="flex flex-wrap gap-1">
        {FIGHT_TYPES.map((ft) => (
          <button
            key={ft}
            type="button"
            onClick={() => toggleFightType(ft)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold border transition-all ${
              value.fightTypes.includes(ft)
                ? "bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold)]"
                : "border-[var(--border-gold)]/50 text-[var(--text-disabled)] hover:text-[var(--text-muted)]"
            }`}
          >
            {ft}
          </button>
        ))}
      </div>
    </div>
  );
}
