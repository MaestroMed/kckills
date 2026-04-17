"use client";

import Link from "next/link";
import Image from "next/image";
import { KCTimeline } from "./KCTimeline";
import { championSplashUrl } from "@/lib/constants";
import { KC_LOGO, TEAM_LOGOS } from "@/lib/kc-assets";
import type { RealMatch } from "@/lib/real-data";

interface Props {
  allMatches: RealMatch[];
}

export function HomeFilteredContent({ allMatches }: Props) {
  const displayedMatches = allMatches.slice(0, 6);

  return (
    <>
      {/* Timeline — FULL WIDTH */}
      <section id="timeline" className="py-12 overflow-hidden">
        <div className="flex items-center gap-3 mb-3 px-4 max-w-7xl mx-auto">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--gold)]/20 to-transparent" />
          <h2 className="font-display text-2xl md:text-3xl font-black whitespace-nowrap">
            L&apos;histoire <span className="text-gold-gradient">Karmine Corp</span>
          </h2>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--gold)]/20 to-transparent" />
        </div>
        <p className="text-center text-xs text-[var(--text-muted)] mb-8 uppercase tracking-[0.25em]">
          Cliquez sur une &eacute;poque pour d&eacute;couvrir les clips associ&eacute;s
        </p>
        <div className="w-full">
          <KCTimeline />
        </div>
      </section>

      {/* Matches */}
      {displayedMatches.length > 0 && (
        <section className="py-4">
          <div className="px-4 max-w-7xl mx-auto flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-bold">
              Matchs <span className="text-gold-gradient">r&eacute;cents</span>
            </h2>
            <Link
              href="/matches"
              className="text-sm text-[var(--text-muted)] hover:text-[var(--gold)]"
            >
              Tous les matchs &rarr;
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {displayedMatches.map((match) => {
              const totalKc = match.games.reduce((a, g) => a + g.kc_kills, 0);
              const totalOpp = match.games.reduce((a, g) => a + g.opp_kills, 0);
              const date = new Date(match.date);
              const oppLogo = TEAM_LOGOS[match.opponent.code];
              const bgChamp =
                match.games[0]?.kc_players?.find((p) => p.name.startsWith("KC "))?.champion ??
                "Jhin";

              return (
                <Link
                  key={match.id}
                  href={`/match/${match.id}`}
                  className="match-card group relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all hover:border-[var(--gold)]/50 hover:scale-[1.02] hover:shadow-2xl hover:shadow-[var(--gold)]/10"
                  style={{ aspectRatio: "4/3" }}
                >
                  {/* Splash bg */}
                  <Image
                    src={championSplashUrl(bgChamp)}
                    alt=""
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover opacity-25 group-hover:opacity-50 group-hover:scale-110 transition-all duration-700"
                  />
                  {/* Gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/30" />
                  <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/70" />

                  {/* Top bar — W/L + stage */}
                  <div className="absolute top-0 left-0 right-0 p-4 flex items-start justify-between z-10">
                    <div
                      className={`rounded-lg px-3 py-1 text-[10px] font-black uppercase tracking-widest backdrop-blur-sm ${
                        match.kc_won
                          ? "bg-[var(--green)]/20 border border-[var(--green)]/40 text-[var(--green)]"
                          : "bg-[var(--red)]/20 border border-[var(--red)]/40 text-[var(--red)]"
                      }`}
                    >
                      {match.kc_won ? "Victoire" : "D\u00e9faite"}
                    </div>
                    <span className="text-[10px] text-white/50 font-medium">
                      {date.toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>

                  {/* Bottom — teams + score */}
                  <div className="absolute bottom-0 left-0 right-0 p-5 z-10">
                    <div className="flex items-center justify-between mb-3">
                      {/* KC */}
                      <div className="flex flex-col items-center gap-1">
                        <Image
                          src={KC_LOGO}
                          alt="KC"
                          width={44}
                          height={44}
                          className="rounded-xl"
                        />
                        <span className="font-display text-xs font-bold text-[var(--gold)]">
                          KC
                        </span>
                      </div>

                      {/* Score */}
                      <div className="text-center">
                        <p className="font-data text-3xl font-black">
                          <span
                            className={match.kc_won ? "text-[var(--green)]" : "text-white/50"}
                          >
                            {match.kc_score}
                          </span>
                          <span className="text-white/20 mx-2">-</span>
                          <span
                            className={!match.kc_won ? "text-[var(--red)]" : "text-white/50"}
                          >
                            {match.opp_score}
                          </span>
                        </p>
                        <p className="font-data text-[10px] text-white/40 mt-1">
                          Kills : <span className="text-[var(--green)]">{totalKc}</span>-
                          <span className="text-[var(--red)]">{totalOpp}</span>
                        </p>
                      </div>

                      {/* Opponent */}
                      <div className="flex flex-col items-center gap-1">
                        {oppLogo ? (
                          <Image
                            src={oppLogo}
                            alt={match.opponent.code}
                            width={44}
                            height={44}
                            className="rounded-xl grayscale group-hover:grayscale-0 transition-all"
                          />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--bg-elevated)] text-sm font-bold">
                            {match.opponent.code}
                          </div>
                        )}
                        <span className="font-display text-xs font-bold text-white/70">
                          {match.opponent.code}
                        </span>
                      </div>
                    </div>

                    {/* Stage info */}
                    <div className="flex items-center justify-center gap-2 text-[10px] text-white/50">
                      <span>{match.stage}</span>
                      <span className="text-white/20">&middot;</span>
                      <span>Bo{match.best_of}</span>
                    </div>
                  </div>

                  {/* Hover arrow */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none">
                    <div className="h-14 w-14 rounded-full bg-[var(--gold)]/20 backdrop-blur-sm border border-[var(--gold)]/40 flex items-center justify-center">
                      <svg
                        className="h-6 w-6 text-[var(--gold)]"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
