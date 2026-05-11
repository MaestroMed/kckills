/**
 * PlayerStatsHero — the 4-up KDA bar in the active-player hero
 * (KDA ratio, games, winrate, K/D/A). Extracted from the inline
 * page implementation so it can be reused and respected as a unit.
 *
 * Server component. The colour decisions (green/red KDA/WR) follow
 * the existing player-page palette logic.
 */
export function PlayerStatsHero({
  stats,
  accent = "var(--gold)",
}: {
  stats: {
    kda: string;
    gamesPlayed: number;
    avgKills: string;
    avgDeaths: string;
    avgAssists: string;
    winRate: number;
  };
  accent?: string;
}) {
  return (
    <div className="flex items-end gap-6 md:gap-8 mt-8 flex-wrap">
      <StatBlock label="KDA ratio">
        <p
          className="font-data text-5xl md:text-6xl lg:text-7xl font-black leading-none"
          style={{
            color: accent,
            textShadow: `0 0 40px ${accent}55`,
          }}
        >
          {stats.kda}
        </p>
      </StatBlock>

      <Divider />

      <StatBlock label="Games">
        <p className="font-data text-3xl md:text-4xl lg:text-5xl font-black text-white leading-none">
          {stats.gamesPlayed}
        </p>
      </StatBlock>

      <Divider />

      <StatBlock label="Winrate">
        <p
          className="font-data text-3xl md:text-4xl lg:text-5xl font-black leading-none"
          style={{ color: stats.winRate >= 50 ? "var(--green)" : "var(--red)" }}
        >
          {stats.winRate}%
        </p>
      </StatBlock>

      <Divider />

      <StatBlock label="K / D / A moyens">
        <p className="font-data text-xl md:text-2xl lg:text-3xl font-black leading-none">
          <span className="text-[var(--green)]">{stats.avgKills}</span>
          <span className="text-white/30 mx-1">/</span>
          <span className="text-[var(--red)]">{stats.avgDeaths}</span>
          <span className="text-white/30 mx-1">/</span>
          <span className="text-white">{stats.avgAssists}</span>
        </p>
      </StatBlock>
    </div>
  );
}

function StatBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-data text-[10px] uppercase tracking-[0.3em] text-white/40 mb-1.5">
        {label}
      </p>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-14 md:h-16 w-px bg-white/10 hidden sm:block" aria-hidden />;
}
