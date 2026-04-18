"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { SphereAxis, SphereFilter, SphereTile } from "./SphereScene";

/**
 * Thin client-component wrapper around the heavy three.js scene.
 * Lives in a "use client" file so Next 15 lets us use `ssr: false` on
 * the dynamic import — three.js touches `window` and WebGL contexts at
 * module-eval time and would crash during SSR otherwise.
 *
 * Owns the axis-selector HUD: switching axis re-clusters every tile
 * into spatial bands aligned with that semantic dimension. This is the
 * V0.5 step toward gesture-based semantic navigation — instead of
 * gestures meaning something, the LAYOUT itself means something. Drag
 * "down" on the time axis really takes you later in the game.
 */
const SphereScene = dynamic(
  () => import("./SphereScene").then((m) => m.SphereScene),
  { ssr: false, loading: () => <SphereLoading /> },
);

interface Props {
  tiles: SphereTile[];
  cameraZ?: number;
  debug?: boolean;
  initialAxis?: SphereAxis;
}

const AXES: { id: SphereAxis; label: string; hint: string }[] = [
  { id: "fibonacci", label: "Aleatoire", hint: "Distribution uniforme (golden ratio)" },
  { id: "time",      label: "Temps",     hint: "Top = early, bas = late game" },
  { id: "player",    label: "Joueur",    hint: "Chaque joueur sur son meridien" },
  { id: "fight",     label: "Type",      hint: "Solo \u2192 teamfight 5v5" },
  { id: "opponent",  label: "Adversaire", hint: "Wedge par equipe rivale" },
];

export function SphereSceneClient({ tiles, cameraZ, debug, initialAxis = "fibonacci" }: Props) {
  const [axis, setAxis] = useState<SphereAxis>(initialAxis);
  const [filter, setFilter] = useState<SphereFilter | null>(null);

  // Count tiles passing the filter — surfaced in the active-filter chip
  // so the user knows immediately how much they narrowed.
  const filteredCount = filter
    ? tiles.filter((t) => {
        switch (filter.key) {
          case "player":   return t.killerPlayerId === filter.value;
          case "opponent": return t.opponentCode === filter.value;
          case "fight":    return t.fightType === filter.value;
          case "time":     return t.minuteBucket === filter.value;
          default:         return true;
        }
      }).length
    : tiles.length;

  return (
    <div className="relative h-full w-full">
      <SphereScene
        tiles={tiles}
        cameraZ={cameraZ}
        debug={debug}
        axis={axis}
        filter={filter}
        onFilterChange={setFilter}
      />

      {/* Active filter chip — top right, dismissable */}
      {filter && (
        <div className="pointer-events-none absolute top-4 right-4 z-30">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--gold)]/45 bg-black/80 backdrop-blur-md px-3 py-1.5 shadow-2xl shadow-black/40">
            <span className="font-data text-[10px] uppercase tracking-[0.22em] text-[var(--gold)]">
              {filterKeyLabel(filter.key)} : {filter.label}
            </span>
            <span className="font-data text-[9px] text-white/55">
              {filteredCount}/{tiles.length}
            </span>
            <button
              type="button"
              onClick={() => setFilter(null)}
              aria-label="Retirer le filtre"
              className="flex h-5 w-5 items-center justify-center rounded-full bg-white/8 text-white/65 hover:bg-white/15 hover:text-white transition-colors"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Axis selector — bottom centre, glassmorphism */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4"
        aria-label="Selecteur d'axe semantique"
      >
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-[var(--gold)]/30 bg-black/65 backdrop-blur-xl px-2 py-1.5 shadow-2xl shadow-black/40">
          {AXES.map((a) => {
            const active = axis === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAxis(a.id)}
                title={a.hint}
                className={
                  "rounded-full px-3 py-1.5 text-[10px] font-data font-bold uppercase tracking-[0.18em] transition-all " +
                  (active
                    ? "bg-[var(--gold)] text-black shadow-md shadow-[var(--gold)]/30"
                    : "text-white/65 hover:text-white hover:bg-white/8")
                }
              >
                {a.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Axis hint bar — top centre */}
      <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 z-30">
        <span className="rounded-full bg-black/60 backdrop-blur-md border border-[var(--gold)]/25 px-4 py-1.5 text-[10px] font-data uppercase tracking-[0.22em] text-[var(--gold)]/80">
          {AXES.find((a) => a.id === axis)?.hint ?? ""}
        </span>
      </div>
    </div>
  );
}

function filterKeyLabel(k: SphereFilter["key"]): string {
  switch (k) {
    case "player":   return "Joueur";
    case "opponent": return "Adversaire";
    case "fight":    return "Type fight";
    case "time":     return "Minute";
  }
}

function SphereLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="kc-spinner" aria-label="Chargement de la sphere 3D" />
        <p className="font-data text-[11px] uppercase tracking-[0.3em] text-[var(--gold)]/70">
          Initialisation WebGL
        </p>
      </div>
    </div>
  );
}
