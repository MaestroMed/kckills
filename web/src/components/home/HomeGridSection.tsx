import { getGridCells } from "@/lib/supabase/grid";
import { getTrackedRoster } from "@/lib/supabase/players";
import {
  FIGHT_TYPES,
  MINUTE_BUCKETS,
  type GridAxisId,
} from "@/lib/grid/axis-config";
import { getStaticT } from "@/lib/i18n/server-lang";
import { HomeGridClient } from "./home-grid-client";

/**
 * HomeGridSection — the resurrected « Scroll Vivant » grid (Vague 3).
 *
 * RSC wrapper: fetches the default axis pair killer × opponent ("who
 * kills who" — the most immediately readable pairing) plus the KC
 * roster for UUID → IGN labels, then hands off to the client engine.
 * Reads ride the cached anon client (30 min Data Cache) so the
 * homepage's traffic costs one Supabase call per window.
 *
 * Graceful fallback: under 4 populated cells (fresh deploy, worker
 * behind, migration 087 not applied) the section renders NOTHING and
 * the homepage is exactly what it was before this wave.
 */
const AXIS_X: GridAxisId = "killer_player_id";
const AXIS_Y: GridAxisId = "opponent_team_code";
const MIN_CELLS = 4;

export async function HomeGridSection() {
  // Traducteur statique : `getServerT()` lit cookies() + headers() et sort
  // la page hôte du pré-rendu. Il n'a rien à faire dans un Promise.all de
  // requêtes DB — ce n'est pas une lecture asynchrone.
  const { t } = getStaticT();
  const [cells, roster] = await Promise.all([
    getGridCells(AXIS_X, AXIS_Y),
    getTrackedRoster(),
  ]);

  if (cells.length < MIN_CELLS || roster.length === 0) {
    return null;
  }

  // Opponent codes present in the data → the Y axis value set.
  const opponentSet = new Set<string>();
  for (const c of cells) {
    if (c.cell_y) opponentSet.add(c.cell_y);
  }

  const axisValues: Record<GridAxisId, { value: string; label: string }[]> = {
    game_minute_bucket: [...MINUTE_BUCKETS],
    killer_player_id: roster.map((p) => ({ value: p.id, label: p.ign })),
    opponent_team_code: [...opponentSet].sort().map((code) => ({
      value: code,
      label: code,
    })),
    fight_type: [...FIGHT_TYPES],
  };

  return (
    <section className="relative mx-auto max-w-7xl px-4 py-14 md:py-20">
      <div className="mb-8 text-center">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
          Scroll Vivant
        </p>
        <h2 className="font-display text-4xl md:text-5xl font-black">
          <span className="text-shimmer">{t("p_grid.heading")}</span>
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[var(--text-muted)]">
          {t("p_grid.sub")}
        </p>
      </div>
      <HomeGridClient
        cells={cells}
        axisXInitial={AXIS_X}
        axisYInitial={AXIS_Y}
        axisValues={axisValues}
      />
    </section>
  );
}
