"use client";

/**
 * ClipBulkActions — sticky action bar shown when clips are selected.
 *
 * Owned by Agent ED. Wraps the bulk endpoints exposed by
 * /api/admin/clips/bulk so the editor can act on a multi-selection in
 * one click. Mirrors the JobsBulkActions pattern from Agent EC.
 */

import { useState } from "react";
import { AdminButton } from "@/components/admin/ui/AdminButton";

export type ClipBulkAction =
  | "hide"
  | "unhide"
  | "mark_reanalyze"
  | "mark_reclip"
  | "set_fight_type"
  | "approve_qc"
  | "set_featured";

export interface ClipBulkResult {
  ok: boolean;
  message?: string;
}

interface Props {
  selectedCount: number;
  onClear: () => void;
  /**
   * Callback executed for each action. Implementations should return a
   * promise resolving to whether the API call succeeded — used to surface
   * a toast.
   */
  onAction: (
    action: ClipBulkAction,
    payload?: Record<string, unknown>,
  ) => Promise<ClipBulkResult>;
}

const FIGHT_TYPES = [
  "solo_kill",
  "pick",
  "gank",
  "skirmish_2v2",
  "skirmish_3v3",
  "teamfight_4v4",
  "teamfight_5v5",
];

export function ClipBulkActions({ selectedCount, onClear, onAction }: Props) {
  const [pending, setPending] = useState<ClipBulkAction | null>(null);

  const run = async (
    action: ClipBulkAction,
    payload?: Record<string, unknown>,
    needsConfirm?: string,
  ) => {
    if (needsConfirm && !confirm(needsConfirm)) return;
    setPending(action);
    try {
      await onAction(action, payload);
    } finally {
      setPending(null);
    }
  };

  if (selectedCount === 0) return null;

  return (
    <div className="sticky top-14 z-10 rounded-xl border border-[var(--gold)]/40 bg-[var(--gold)]/10 backdrop-blur-md p-3 flex flex-wrap items-center gap-2">
      <span className="text-xs font-bold text-[var(--gold)]">
        {selectedCount} clip{selectedCount > 1 ? "s" : ""} sélectionné
        {selectedCount > 1 ? "s" : ""}
      </span>

      <AdminButton
        variant="secondary"
        size="sm"
        loading={pending === "mark_reclip"}
        disabled={pending !== null}
        onClick={() =>
          run("mark_reclip", { reason: "bulk admin flag" }, `Re-clipper ${selectedCount} clip(s) ?`)
        }
      >
        Re-clip
      </AdminButton>

      <AdminButton
        variant="secondary"
        size="sm"
        loading={pending === "mark_reanalyze"}
        disabled={pending !== null}
        onClick={() => run("mark_reanalyze", undefined, `Ré-analyser ${selectedCount} clip(s) ?`)}
      >
        Ré-analyser
      </AdminButton>

      <AdminButton
        variant="secondary"
        size="sm"
        loading={pending === "approve_qc"}
        disabled={pending !== null}
        onClick={() => run("approve_qc")}
      >
        Approuver QC
      </AdminButton>

      <AdminButton
        variant="secondary"
        size="sm"
        loading={pending === "set_featured"}
        disabled={pending !== null}
        onClick={() => run("set_featured", undefined, `Pin ${selectedCount} clip(s) en featured ?`)}
      >
        Set featured
      </AdminButton>

      <AdminButton
        variant="secondary"
        size="sm"
        loading={pending === "unhide"}
        disabled={pending !== null}
        onClick={() => run("unhide")}
      >
        Afficher
      </AdminButton>

      <AdminButton
        variant="danger"
        size="sm"
        loading={pending === "hide"}
        disabled={pending !== null}
        onClick={() => run("hide", undefined, `Masquer ${selectedCount} clip(s) du feed ?`)}
      >
        Masquer
      </AdminButton>

      <select
        onChange={(e) => {
          if (!e.target.value) return;
          run("set_fight_type", { fight_type: e.target.value });
          e.target.value = "";
        }}
        defaultValue=""
        disabled={pending !== null}
        className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
        aria-label="Affecter un type de combat"
      >
        <option value="">Fight type →</option>
        {FIGHT_TYPES.map((ft) => (
          <option key={ft} value={ft}>
            {ft}
          </option>
        ))}
      </select>

      <button
        onClick={onClear}
        disabled={pending !== null}
        className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--gold)] disabled:opacity-40"
      >
        Désélectionner
      </button>
    </div>
  );
}
