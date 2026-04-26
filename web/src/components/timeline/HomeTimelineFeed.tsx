"use client";

import { useCallback, useState, type ReactNode } from "react";
import { KCTimeline } from "@/components/KCTimeline";
import { EraKillsFeed } from "@/components/timeline/EraKillsFeed";
import { ERAS, getEraById } from "@/lib/eras";
import { track } from "@/lib/analytics/track";

/**
 * HomeTimelineFeed — owns the era-selection state on the homepage.
 *
 * Composes :
 *   1. KCTimeline (filter mode) — the horizontal era strip. Selecting
 *      a card calls `setSelectedEraId`.
 *   2. EraKillsFeed — mounted only when an era is selected. Pulls
 *      that era's clips from /api/kills/by-era.
 *   3. A "Toutes les eres" clear-filter button — surfaces only when
 *      a filter is active so the empty-state UI stays clean.
 *
 * The default feed (RSC : `<HomeRecentClips />` etc.) is passed as
 * `children` and rendered ONLY when no era is selected, per the task
 * spec : "When an era is selected, the existing feed BELOW is replaced
 * by EraKillsFeed". The RSC is server-rendered in the parent page.tsx,
 * we just decide whether to mount its already-streamed JSX.
 *
 * The selectedEra is intentionally NOT mirrored to the URL — keeping
 * the homepage URL stable means the heavy RSC stays cached for everyone
 * else. If the user wants a permalink, they tap a card in the era feed
 * and land on the per-era page (/era/[id]) which IS canonical.
 */
export interface HomeTimelineFeedProps {
  /** Default feed JSX, rendered when no era is selected. Server-component
   *  output is fine — it's already serialised by the parent. */
  children?: ReactNode;
}

export function HomeTimelineFeed({ children }: HomeTimelineFeedProps) {
  const [selectedEraId, setSelectedEraId] = useState<string | null>(null);
  const selectedEra = selectedEraId ? getEraById(selectedEraId) ?? null : null;

  const handleEraSelect = useCallback((nextEraId: string | null) => {
    setSelectedEraId(nextEraId);
    if (nextEraId) {
      const era = ERAS.find((e) => e.id === nextEraId);
      track("timeline.era_selected", {
        entityType: "era",
        entityId: nextEraId,
        metadata: era
          ? { era_id: era.id, era_label: era.label, era_phase: era.phase }
          : { era_id: nextEraId },
      });
    }
  }, []);

  const handleClear = useCallback(() => {
    setSelectedEraId(null);
  }, []);

  return (
    <>
      <KCTimeline
        mode="filter"
        selectedEraId={selectedEraId}
        onEraSelect={handleEraSelect}
      />

      {/* "Toutes les eres" clear button — only visible when a filter is
          active. Floats just below the timeline so the user always knows
          how to get back to the unfiltered view. */}
      {selectedEra && (
        <div className="max-w-7xl mx-auto px-4 md:px-6 -mt-4 mb-2 flex justify-center">
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)]/80 backdrop-blur-sm px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--gold)] transition-all hover:bg-[var(--gold)]/10 hover:border-[var(--gold)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
            aria-label="Effacer le filtre par ere"
          >
            <span aria-hidden>{"\u2715"}</span>
            Toutes les eres
          </button>
        </div>
      )}

      {selectedEra ? <EraKillsFeed era={selectedEra} /> : children}
    </>
  );
}
