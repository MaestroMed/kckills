import type { Metadata } from "next";
import { loadRealData, getKCRoster, getPlayerStats } from "@/lib/real-data";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getServerT } from "@/lib/i18n/server-lang";
import { CompareClient, type ComparablePlayer } from "./compare-client";

/**
 * /compare — head-to-head player comparator (Vague 5, audit 2026-07-05).
 *
 * Was a redirect("/players"). All aggregates come from the static
 * kc_matches.json (zero Supabase egress) and are computed server-side
 * for every roster player; the client only switches which two are
 * displayed.
 */
export const revalidate = 3600;
export const metadata: Metadata = {
  title: "Comparateur",
  description:
    "Deux joueurs Karmine Corp face à face — carrière complète sur les games trackées.",
  alternates: { canonical: "/compare" },
};

export default async function ComparePage() {
  const { t } = await getServerT();
  const data = loadRealData();
  const roster = getKCRoster(data);

  const players: ComparablePlayer[] = roster.map((p) => {
    const s = getPlayerStats(data, p.name);
    const topChamps = Object.entries(s.champions)
      .map(([name, c]) => ({ name, games: c.games, wins: c.wins }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 5);
    return {
      name: p.name,
      role: p.role,
      games: s.gamesPlayed,
      wins: s.wins,
      kills: s.kills,
      deaths: s.deaths,
      assists: s.assists,
      topChamps,
    };
  });

  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: t("p_compare.title") }]} />
      <header>
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
          Karmine Corp
        </p>
        <h1 className="font-display text-4xl md:text-5xl font-black">
          <span className="text-shimmer">{t("p_compare.title")}</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-muted)]">
          {t("p_compare.subtitle")}
        </p>
      </header>
      <CompareClient players={players} />
    </div>
  );
}
