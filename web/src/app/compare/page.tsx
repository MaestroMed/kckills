import { loadRealData, getPlayerStats, getCurrentRoster } from "@/lib/real-data";
import { championIconUrl } from "@/lib/constants";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";
import { PageHero } from "@/components/ui/PageHero";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Comparateur joueurs",
  description: "Compare les stats de deux joueurs KC c\u00f4te \u00e0 c\u00f4te.",
};

export default function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ p1?: string; p2?: string }>;
}) {
  return <CompareContent paramsPromise={searchParams} />;
}

async function CompareContent({
  paramsPromise,
}: {
  paramsPromise: Promise<{ p1?: string; p2?: string }>;
}) {
  const params = await paramsPromise;
  const data = loadRealData();
  const roster = getCurrentRoster(data);

  const p1Name = params.p1 ? decodeURIComponent(params.p1) : null;
  const p2Name = params.p2 ? decodeURIComponent(params.p2) : null;

  const p1Stats = p1Name ? getPlayerStats(data, p1Name) : null;
  const p2Stats = p2Name ? getPlayerStats(data, p2Name) : null;

  return (
    <div className="-mt-6">
      <PageHero
        variant="compact"
        crumbs={[
          { label: "Accueil", href: "/" },
          { label: "Comparateur" },
        ]}
        badge="Karmine Corp · Roster"
        title="COMPARATEUR"
        subtitle="Compare deux joueurs Karmine Corp cote a cote. Kills, deaths, KDA, champion pool, gold, CS — tout est aligne."
        backgroundSrc="/images/hero-bg.jpg"
      />

      <div className="mx-auto max-w-5xl space-y-8 py-12 px-4 md:px-0">
      {/* Player selectors */}
      <div className="grid grid-cols-2 gap-4">
        <PlayerSelector
          label="Joueur 1"
          roster={roster}
          selected={p1Name}
          otherSelected={p2Name}
          paramKey="p1"
          otherParam={p2Name ? `&p2=${encodeURIComponent(p2Name)}` : ""}
        />
        <PlayerSelector
          label="Joueur 2"
          roster={roster}
          selected={p2Name}
          otherSelected={p1Name}
          paramKey="p2"
          otherParam={p1Name ? `&p1=${encodeURIComponent(p1Name)}` : ""}
        />
      </div>

      {/* Comparison table */}
      {p1Stats && p2Stats && p1Stats.gamesPlayed > 0 && p2Stats.gamesPlayed > 0 && (
        <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="grid grid-cols-3 border-b border-[var(--border-gold)] bg-[var(--bg-primary)]">
            <div className="p-4 text-center">
              <p className="font-display text-lg font-bold text-[var(--gold)]">{p1Name}</p>
            </div>
            <div className="p-4 text-center">
              <p className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">vs</p>
            </div>
            <div className="p-4 text-center">
              <p className="font-display text-lg font-bold text-[var(--cyan)]">{p2Name}</p>
            </div>
          </div>

          <CompareRow label="Games" v1={p1Stats.gamesPlayed} v2={p2Stats.gamesPlayed} />
          <CompareRow label="Kills total" v1={p1Stats.kills} v2={p2Stats.kills} />
          <CompareRow label="Deaths total" v1={p1Stats.deaths} v2={p2Stats.deaths} inverted />
          <CompareRow label="Assists total" v1={p1Stats.assists} v2={p2Stats.assists} />
          <CompareRow label="KDA" v1={parseFloat(p1Stats.kda) || 0} v2={parseFloat(p2Stats.kda) || 0} decimal />
          <CompareRow label="Avg Kills" v1={parseFloat(p1Stats.avgKills)} v2={parseFloat(p2Stats.avgKills)} decimal />
          <CompareRow label="Avg Deaths" v1={parseFloat(p1Stats.avgDeaths)} v2={parseFloat(p2Stats.avgDeaths)} inverted decimal />
          <CompareRow label="Avg Assists" v1={parseFloat(p1Stats.avgAssists)} v2={parseFloat(p2Stats.avgAssists)} decimal />
          <CompareRow label="Champions" v1={p1Stats.champions.length} v2={p2Stats.champions.length} />
          <CompareRow label="Gold total" v1={Math.round(p1Stats.totalGold / 1000)} v2={Math.round(p2Stats.totalGold / 1000)} suffix="k" />
          <CompareRow label="CS total" v1={p1Stats.totalCS} v2={p2Stats.totalCS} />
        </div>
      )}

      {(!p1Name || !p2Name) && (
        <div className="rounded-xl border border-dashed border-[var(--border-gold)] p-12 text-center">
          <p className="text-lg text-[var(--text-muted)]">
            S&eacute;lectionne deux joueurs pour comparer leurs stats
          </p>
        </div>
      )}
      </div>
    </div>
  );
}

function PlayerSelector({
  label,
  roster,
  selected,
  otherSelected,
  paramKey,
  otherParam,
}: {
  label: string;
  roster: { name: string; role: string }[];
  selected: string | null;
  otherSelected: string | null;
  paramKey: string;
  otherParam: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <p className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">{label}</p>
      <div className="flex flex-wrap gap-2">
        {roster.map((p) => {
          const isSelected = p.name === selected;
          const isOther = p.name === otherSelected;
          const photo = PLAYER_PHOTOS[p.name];
          return (
            <Link
              key={p.name}
              href={`/compare?${paramKey}=${encodeURIComponent(p.name)}${otherParam}`}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${
                isSelected
                  ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)] font-bold"
                  : isOther
                  ? "border-[var(--border-gold)] opacity-40 cursor-not-allowed"
                  : "border-[var(--border-gold)] hover:border-[var(--gold)]/40 text-[var(--text-secondary)]"
              }`}
            >
              {photo && (
                <Image src={photo} alt={p.name} width={20} height={20} className="rounded-full" />
              )}
              {p.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function CompareRow({
  label,
  v1,
  v2,
  inverted = false,
  decimal = false,
  suffix = "",
}: {
  label: string;
  v1: number;
  v2: number;
  inverted?: boolean;
  decimal?: boolean;
  suffix?: string;
}) {
  const better1 = inverted ? v1 < v2 : v1 > v2;
  const better2 = inverted ? v2 < v1 : v2 > v1;
  const fmt = (v: number) => (decimal ? v.toFixed(1) : String(v)) + suffix;

  return (
    <div className="grid grid-cols-3 border-b border-[var(--border-gold)] last:border-b-0">
      <div className={`p-3 text-center font-data text-sm ${better1 ? "text-[var(--gold)] font-bold" : "text-[var(--text-secondary)]"}`}>
        {fmt(v1)}
      </div>
      <div className="p-3 text-center text-[10px] text-[var(--text-muted)] uppercase tracking-wider self-center">
        {label}
      </div>
      <div className={`p-3 text-center font-data text-sm ${better2 ? "text-[var(--cyan)] font-bold" : "text-[var(--text-secondary)]"}`}>
        {fmt(v2)}
      </div>
    </div>
  );
}
