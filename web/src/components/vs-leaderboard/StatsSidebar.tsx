"use client";

/**
 * /vs/leaderboard — right-rail stats sidebar.
 *
 * Desktop : sticky right column, four cards.
 * Mobile  : collapsible accordion below the table — see <StatsAccordion />.
 *
 * Cards :
 *   - "Le plus actif"     : highest battles_count
 *   - "Le plus contesté"  : win_rate closest to 50% (battles >= 20)
 *   - "Le plus dominant"  : highest win_rate (battles >= 20)
 *   - "Vos votes"         : count of vs_battles for the session hash
 *
 * Each featured kill shows a tiny 9:16 thumb + matchup + the metric the
 * card highlights. Click → /scroll?kill=<id>.
 */

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";

import { championLoadingUrl } from "@/lib/constants";
import { winRatePct } from "@/lib/vs-roulette";
import type {
  EloLeaderboardStats,
  FeaturedEloKill,
} from "@/lib/supabase/vs-leaderboard";

interface StatsSidebarProps {
  stats: EloLeaderboardStats;
  sessionVoteCount: number;
}

// ════════════════════════════════════════════════════════════════════
// Desktop right rail
// ════════════════════════════════════════════════════════════════════

export function StatsSidebar({ stats, sessionVoteCount }: StatsSidebarProps) {
  return (
    <aside
      aria-label="Statistiques du classement"
      className="hidden lg:block sticky top-32 self-start space-y-3"
    >
      <SummaryCard
        totalBattles={stats.total_battles}
        totalKills={stats.total_kills_with_battles}
      />
      <FeaturedCard
        title="Vos votes"
        subtitle="Sur cette session"
        accent="var(--cyan)"
        bigNumber={String(sessionVoteCount)}
        bigLabel={sessionVoteCount === 1 ? "duel voté" : "duels votés"}
        cta={
          <Link
            href="/vs"
            className="rounded-md border border-[var(--cyan)]/45 bg-[var(--cyan)]/10 px-3 py-1 font-display text-[9px] font-bold uppercase tracking-[0.25em] text-[var(--cyan)] hover:border-[var(--cyan)]"
          >
            Voter encore
          </Link>
        }
      />
      <FeaturedCard
        title="Le plus actif"
        subtitle="Le kill le plus joué"
        accent="var(--gold)"
        kill={stats.most_active}
        metric={(k) => ({
          label: "Batailles",
          value: String(k.battles_count),
        })}
      />
      <FeaturedCard
        title="Le plus contesté"
        subtitle="Win rate proche de 50%"
        accent="var(--orange)"
        kill={stats.most_contested}
        metric={(k) => ({
          label: "Win rate",
          value: `${winRatePct(k.wins, k.battles_count)}%`,
        })}
      />
      <FeaturedCard
        title="Le plus dominant"
        subtitle="Win rate max (min 20 batailles)"
        accent="var(--green)"
        kill={stats.most_dominant}
        metric={(k) => ({
          label: "Win rate",
          value: `${winRatePct(k.wins, k.battles_count)}%`,
        })}
      />
    </aside>
  );
}

// ════════════════════════════════════════════════════════════════════
// Mobile collapsible accordion
// ════════════════════════════════════════════════════════════════════

export function StatsAccordion({ stats, sessionVoteCount }: StatsSidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <section
      aria-label="Statistiques du classement (mobile)"
      className="lg:hidden mx-auto max-w-3xl px-3 md:px-6 mt-4 mb-8"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/60 backdrop-blur-md px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block"
            style={{
              width: 10,
              height: 10,
              transform: "rotate(45deg)",
              background: "linear-gradient(135deg, var(--gold-bright), var(--gold))",
            }}
          />
          <span className="font-display text-sm font-black uppercase tracking-[0.15em] text-[var(--gold-bright)]">
            Insights & ta progression
          </span>
        </div>
        <span aria-hidden className="text-[var(--gold)] text-sm">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SummaryCard
            totalBattles={stats.total_battles}
            totalKills={stats.total_kills_with_battles}
          />
          <FeaturedCard
            title="Vos votes"
            subtitle="Sur cette session"
            accent="var(--cyan)"
            bigNumber={String(sessionVoteCount)}
            bigLabel={sessionVoteCount === 1 ? "duel voté" : "duels votés"}
            cta={
              <Link
                href="/vs"
                className="rounded-md border border-[var(--cyan)]/45 bg-[var(--cyan)]/10 px-3 py-1 font-display text-[9px] font-bold uppercase tracking-[0.25em] text-[var(--cyan)]"
              >
                Voter
              </Link>
            }
          />
          <FeaturedCard
            title="Le plus actif"
            subtitle="Le kill le plus joué"
            accent="var(--gold)"
            kill={stats.most_active}
            metric={(k) => ({ label: "Batailles", value: String(k.battles_count) })}
          />
          <FeaturedCard
            title="Le plus contesté"
            subtitle="Win rate proche de 50%"
            accent="var(--orange)"
            kill={stats.most_contested}
            metric={(k) => ({
              label: "Win rate",
              value: `${winRatePct(k.wins, k.battles_count)}%`,
            })}
          />
          <FeaturedCard
            title="Le plus dominant"
            subtitle="Win rate max"
            accent="var(--green)"
            kill={stats.most_dominant}
            metric={(k) => ({
              label: "Win rate",
              value: `${winRatePct(k.wins, k.battles_count)}%`,
            })}
          />
        </div>
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Summary card — total battles + qualifying kills
// ════════════════════════════════════════════════════════════════════

function SummaryCard({
  totalBattles,
  totalKills,
}: {
  totalBattles: number;
  totalKills: number;
}) {
  return (
    <div
      className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/65 backdrop-blur-md p-4"
      style={{
        boxShadow: "0 18px 36px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(200,170,110,0.06)",
      }}
    >
      <p className="font-data text-[9px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
        Bilan global
      </p>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="font-display text-3xl font-black tabular-nums text-[var(--gold-bright)]">
            {totalBattles.toLocaleString("fr-FR")}
          </p>
          <p className="font-data text-[10px] uppercase tracking-widest text-white/55">
            duels au total
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-black tabular-nums text-white">
            {totalKills.toLocaleString("fr-FR")}
          </p>
          <p className="font-data text-[10px] uppercase tracking-widest text-white/55">
            kills classés
          </p>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Featured card — either a kill spotlight or a big-number stat
// ════════════════════════════════════════════════════════════════════

function FeaturedCard({
  title,
  subtitle,
  accent,
  kill,
  metric,
  bigNumber,
  bigLabel,
  cta,
}: {
  title: string;
  subtitle: string;
  accent: string;
  kill?: FeaturedEloKill | null;
  metric?: (kill: FeaturedEloKill) => { label: string; value: string };
  bigNumber?: string;
  bigLabel?: string;
  cta?: React.ReactNode;
}) {
  const isKill = kill && metric;

  return (
    <div
      className="rounded-2xl border bg-[var(--bg-surface)]/65 backdrop-blur-md p-4 transition-all hover:border-[var(--gold)]/40"
      style={{
        borderColor: `${accent}33`,
        boxShadow: `0 14px 28px rgba(0,0,0,0.35), inset 0 0 0 1px ${accent}10`,
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p
            className="font-data text-[10px] uppercase tracking-[0.3em] font-bold truncate"
            style={{ color: accent }}
          >
            {title}
          </p>
          <p className="font-data text-[9px] uppercase tracking-widest text-white/40 truncate">
            {subtitle}
          </p>
        </div>
        {cta}
      </div>

      {isKill ? <KillSpotlight kill={kill} accent={accent} metric={metric(kill)} /> : null}

      {!isKill && bigNumber !== undefined ? (
        <p className="font-display text-3xl font-black tabular-nums" style={{ color: accent }}>
          {bigNumber}
          {bigLabel ? (
            <span className="ml-2 font-data text-[10px] uppercase tracking-widest text-white/50">
              {bigLabel}
            </span>
          ) : null}
        </p>
      ) : null}

      {!isKill && bigNumber === undefined && !kill ? (
        <p className="font-data text-[10px] uppercase tracking-widest text-white/35 py-4 text-center">
          Pas encore assez de données
        </p>
      ) : null}
    </div>
  );
}

function KillSpotlight({
  kill,
  accent,
  metric,
}: {
  kill: FeaturedEloKill;
  accent: string;
  metric: { label: string; value: string };
}) {
  const killerName = kill.killer_name ?? kill.killer_champion ?? "?";
  const victimName = kill.victim_name ?? kill.victim_champion ?? "?";
  const thumb =
    kill.thumbnail_url ?? (kill.killer_champion ? championLoadingUrl(kill.killer_champion) : null);

  return (
    <Link
      href={`/scroll?kill=${kill.kill_id}`}
      className="flex items-center gap-3 -m-1 p-1 rounded-lg hover:bg-white/[0.03] transition-colors group"
      aria-label={`Voir le clip ${killerName} contre ${victimName}`}
    >
      <span
        className="relative flex-shrink-0 rounded-md overflow-hidden border border-white/10 group-hover:border-[var(--gold)]/50 transition-colors"
        style={{
          width: 44,
          height: 78,
          boxShadow: "0 6px 14px rgba(0,0,0,0.35)",
        }}
      >
        {thumb ? (
          <Image src={thumb} alt="" fill sizes="44px" className="object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-[var(--bg-elevated)]">
            <span className="font-display text-[10px] text-[var(--gold-dark)]">KC</span>
          </div>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold text-white leading-tight truncate">
          <span style={{ color: accent }}>{killerName}</span>
          <span className="text-white/50"> → </span>
          {victimName}
        </p>
        <p className="font-data text-[9px] uppercase tracking-widest text-white/45 truncate">
          {kill.killer_champion ?? "?"} vs {kill.victim_champion ?? "?"}
        </p>
        <div className="mt-1.5 flex items-center gap-3">
          <span className="font-data text-[9px] uppercase tracking-widest text-white/55">
            {metric.label}
          </span>
          <span
            className="font-data text-[13px] font-black tabular-nums"
            style={{ color: accent }}
          >
            {metric.value}
          </span>
          <span className="font-data text-[9px] uppercase tracking-widest text-white/40 ml-auto">
            ELO {Math.round(kill.elo_rating)}
          </span>
        </div>
      </div>
    </Link>
  );
}
