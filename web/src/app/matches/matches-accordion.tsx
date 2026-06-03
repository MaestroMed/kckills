"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { KC_LOGO, TEAM_LOGOS } from "@/lib/kc-assets";
import { useT } from "@/lib/i18n/use-lang";

/** Small rotated gold square accent — copied from the /vs hextech surfaces. */
function CornerLosange({
  position,
}: {
  position: "tl" | "tr" | "bl" | "br";
}) {
  const map: Record<string, string> = {
    tl: "top-2 left-2",
    tr: "top-2 right-2",
    bl: "bottom-2 left-2",
    br: "bottom-2 right-2",
  };
  return (
    <span
      aria-hidden
      className={`absolute ${map[position]} z-10`}
      style={{
        width: 7,
        height: 7,
        transform: "rotate(45deg)",
        background: "rgba(200,170,110,0.45)",
      }}
    />
  );
}

interface MatchSummary {
  id: string;
  // null = unknown winner (upcoming / not yet resolved) → neutral "À venir",
  // excluded from the W/L tally and the W/L filters.
  kc_won: boolean | null;
  opponent: { code: string; name: string };
  kc_score: number;
  opp_score: number;
  stage: string;
  best_of: number;
  date: string;
  totalKc: number;
  totalOpp: number;
  hasGames: boolean;
  clipCount?: number;
}

interface YearGroup {
  year: string;
  matches: MatchSummary[];
}

export function MatchesAccordion({ years }: { years: YearGroup[] }) {
  const t = useT();
  // Most recent year open by default
  const [openYears, setOpenYears] = useState<Set<string>>(
    new Set(years.length > 0 ? [years[0].year] : [])
  );
  const [filter, setFilter] = useState("");
  const [resultFilter, setResultFilter] = useState<"all" | "win" | "loss">("all");
  const [clipsOnly, setClipsOnly] = useState(false);

  const hasAnyClips = years.some((y) => y.matches.some((m) => (m.clipCount ?? 0) > 0));
  const hasFilters = filter || resultFilter !== "all" || clipsOnly;

  const toggle = (year: string) => {
    setOpenYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  const resetAll = () => {
    setFilter("");
    setResultFilter("all");
    setClipsOnly(false);
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          aria-label={t("p_matches.filter_aria")}
          placeholder={t("p_matches.filter_placeholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--gold)]"
        />
        <div className="flex gap-1">
          {(["all", "win", "loss"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setResultFilter(v)}
              aria-pressed={resultFilter === v}
              aria-label={v === "all" ? t("p_matches.filter_all_aria") : v === "win" ? t("p_matches.filter_win_aria") : t("p_matches.filter_loss_aria")}
              className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                resultFilter === v
                  ? v === "win" ? "bg-[var(--green)]/20 text-[var(--green)] border border-[var(--green)]/40"
                    : v === "loss" ? "bg-[var(--red)]/20 text-[var(--red)] border border-[var(--red)]/40"
                    : "bg-[var(--gold)]/15 text-[var(--gold)] border border-[var(--gold)]/30"
                  : "bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-gold)] hover:bg-[var(--bg-elevated)]"
              }`}
            >
              {v === "all" ? t("p_matches.filter_all") : v === "win" ? "W" : "L"}
            </button>
          ))}
        </div>
        {hasAnyClips && (
          <button
            onClick={() => setClipsOnly(!clipsOnly)}
            aria-pressed={clipsOnly}
            className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
              clipsOnly
                ? "badge-glass text-[var(--gold)]"
                : "bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-gold)] hover:bg-[var(--bg-elevated)]"
            }`}
          >
            {t("p_matches.with_clips")}
          </button>
        )}
        {hasFilters && (
          <button
            onClick={resetAll}
            className="rounded-lg border border-[var(--red)]/30 px-3 py-2 text-xs text-[var(--red)] hover:bg-[var(--red)]/10"
          >
            {t("p_matches.reset")}
          </button>
        )}
      </div>

      {years.map(({ year, matches }) => {
        let filtered = matches;
        if (filter) {
          const q = filter.toLowerCase();
          filtered = filtered.filter((m) =>
            m.opponent.code.toLowerCase().includes(q) ||
            m.opponent.name.toLowerCase().includes(q)
          );
        }
        if (resultFilter === "win") filtered = filtered.filter((m) => m.kc_won === true);
        if (resultFilter === "loss") filtered = filtered.filter((m) => m.kc_won === false);
        if (clipsOnly) filtered = filtered.filter((m) => (m.clipCount ?? 0) > 0);

        if (hasFilters && filtered.length === 0) return null;

        const isOpen = openYears.has(year);
        const wins = filtered.filter((m) => m.kc_won === true).length;
        const losses = filtered.filter((m) => m.kc_won === false).length;

        return (
          <section key={year}>
            <button
              onClick={() => toggle(year)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-3 mb-3 group"
            >
              <div className="gold-line flex-1 opacity-40" />
              <div className="flex items-center gap-2">
                <h2 className="font-display text-xl font-bold text-[var(--gold)]">{year}</h2>
                <span className="font-data text-[10px] text-[var(--text-muted)]">
                  {t("p_matches.n_matches", { n: filtered.length })} &middot; {wins}W-{losses}L
                </span>
                <ChevronDown
                  aria-hidden
                  className={`h-4 w-4 text-[var(--text-muted)] transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </div>
              <div className="gold-line flex-1 opacity-40" />
            </button>

            {isOpen && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((match) => (
                  <Link
                    key={match.id}
                    href={`/match/${match.id}`}
                    className="group relative flex flex-col gap-3 overflow-hidden rounded-xl border border-[var(--border-gold)] glass p-4 transition-all duration-300 hover:border-[var(--gold)]/45 hover:gold-glow hover:-translate-y-0.5"
                  >
                    <CornerLosange position="tl" />
                    <CornerLosange position="br" />

                    {/* Result accent strip — gold on win, red on loss, muted upcoming */}
                    <span
                      aria-hidden
                      className={`absolute inset-y-0 left-0 w-[3px] ${
                        match.kc_won === null
                          ? "bg-[var(--text-disabled)]"
                          : match.kc_won
                            ? "bg-[var(--green)]"
                            : "bg-[var(--red)]"
                      }`}
                    />

                    {/* Header — teams + result */}
                    <div className="flex items-center justify-between gap-2 pl-1">
                      <div className="flex items-center gap-2">
                        <Image src={KC_LOGO} alt="KC" width={26} height={26} className="rounded" />
                        <span className="text-[10px] text-[var(--text-disabled)]">vs</span>
                        {TEAM_LOGOS[match.opponent.code] ? (
                          <Image src={TEAM_LOGOS[match.opponent.code]} alt={match.opponent.code} width={26} height={26} className="rounded" />
                        ) : (
                          <span className="text-xs font-bold text-[var(--text-muted)]">{match.opponent.code}</span>
                        )}
                      </div>
                      {match.kc_won === null ? (
                        <span className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          {t("p_matches.upcoming")}
                        </span>
                      ) : (
                        <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold ${match.kc_won ? "bg-[var(--green)]/20 text-[var(--green)]" : "bg-[var(--red)]/20 text-[var(--red)]"}`}>
                          {match.kc_won ? "W" : "L"}
                        </span>
                      )}
                    </div>

                    {/* Matchup + series score */}
                    <div className="pl-1">
                      <p className="font-display text-base font-bold leading-tight group-hover:text-[var(--gold)] transition-colors">
                        KC vs {match.opponent.code}
                        {match.kc_score + match.opp_score > 0 && (
                          <span className="ml-2 font-data text-sm text-[var(--text-muted)]">{match.kc_score}-{match.opp_score}</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{match.stage} &middot; Bo{match.best_of}</p>
                    </div>

                    {/* Footer — kills tally, clips, date */}
                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2.5 pl-1">
                      <div className="flex items-center gap-2">
                        {match.hasGames && (
                          <p className="font-data text-xs" title={t("p_matches.kills_tooltip")}>
                            <span className="text-[var(--green)]">{match.totalKc}</span>
                            <span className="text-[var(--text-muted)]">-</span>
                            <span className="text-[var(--red)]">{match.totalOpp}</span>
                          </p>
                        )}
                        {(match.clipCount ?? 0) > 0 && (
                          <span className="badge-glass rounded-md px-2 py-0.5 text-[9px] font-bold text-[var(--gold)]">
                            {t("p_matches.clips_count", { n: match.clipCount ?? 0 })}
                          </span>
                        )}
                      </div>
                      <p className="font-data text-[10px] text-[var(--text-muted)]">
                        {new Date(match.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
