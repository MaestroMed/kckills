import type { Metadata } from "next";
import { loadRealData, getMatchesSorted } from "@/lib/real-data";
// Audit compteurs 2026-08-12 — les KPI viennent du périmètre canonique
// « log détaillé » (stats-scopes.getTrackedGamesDetailed) et les libellés
// le disent : ce sont les games du snapshot statique (stats par game
// vérifiées), PAS la carrière toutes compétitions de la home.
import { getTrackedGamesDetailed } from "@/lib/stats-scopes";
import { ChampionLadders } from "@/components/home/ChampionLadders";
import { FormCalendar } from "@/components/home/FormCalendar";
import { StatCard } from "@/components/ui/StatCard";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getStaticT } from "@/lib/i18n/server-lang";

/**
 * /stats — team dashboard (Vague 5, audit 2026-07-05).
 *
 * This route was a redirect("/players") "until polished" — but every
 * building block already existed: ChampionLadders + FormCalendar were
 * homepage components and the aggregates come from the static
 * kc_matches.json (zero Supabase egress).
 */
export const revalidate = 3600;
export const metadata: Metadata = {
  title: "Stats",
  description:
    "La Karmine Corp en chiffres — picks, forme et tendances sur les games au log détaillé.",
  alternates: { canonical: "/stats" },
};

export default async function StatsPage() {
  const { t } = getStaticT();
  const data = loadRealData();
  const matches = getMatchesSorted(data);

  // Périmètre « log détaillé » — une seule implémentation (stats-scopes).
  // NB : le winrate par game est ESTIMÉ (proxy kc_kills > opp_kills, le
  // log ne porte pas le vainqueur par game) — le libellé KPI le précise.
  const detailed = getTrackedGamesDetailed();
  const winrate =
    detailed.gameWinratePct != null ? Math.round(detailed.gameWinratePct) : 0;

  return (
    <div className="space-y-10">
      <Breadcrumb items={[{ label: t("nav.home"), href: "/" }, { label: "Stats" }]} />
      <header>
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
          Karmine Corp
        </p>
        <h1 className="font-display text-4xl md:text-5xl font-black">
          <span className="text-shimmer">{t("p_stats.title")}</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-muted)]">
          {t("p_stats.subtitle")}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("p_stats.kpi_games")} value={String(detailed.games)} variant="gold" />
        <StatCard label={t("p_stats.kpi_winrate")} value={`${winrate}%`} variant="cyan" />
        <StatCard label={t("p_stats.kpi_kills")} value={String(detailed.kcKills)} variant="red" />
        <StatCard
          label={t("p_stats.kpi_matches")}
          value={`${detailed.matchWins}W — ${detailed.matchLosses}L`}
          variant="neutral"
        />
      </div>

      <FormCalendar matches={matches} />
      <ChampionLadders matches={matches} />
    </div>
  );
}
