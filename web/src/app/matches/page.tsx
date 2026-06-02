import type { Metadata } from "next";
import { loadRealData, getMatchesSorted } from "@/lib/real-data";
import { getPublishedKills } from "@/lib/supabase/kills";
import { createAnonSupabase } from "@/lib/supabase/server";
import { Breadcrumb } from "@/components/Breadcrumb";
import { MatchesAccordion } from "./matches-accordion";

export const revalidate = 600; // Wave 13d : new match every 1-3 days

export const metadata: Metadata = {
  title: "Matchs KC",
  description:
    "Tous les matchs Karmine Corp en LEC. Scores, résultats, timeline des kills et clips vidéo par game.",
  alternates: { canonical: "/matches" },
  openGraph: {
    title: "Matchs Karmine Corp — KCKILLS",
    description:
      "Historique complet des matchs KC en LEC avec scores, timelines et clips.",
    type: "website",
    siteName: "KCKILLS",
    locale: "fr_FR",
  },
};

export default async function MatchesPage() {
  const sb = await createAnonSupabase();
  // Wave 34 T2.2 — trim 500 → 300.
  // The list iterates `allClips` only to compute `clipsByMatch.size`
  // counters and a single total `allClips.length` for the header chip.
  // With ~80 matches in the history and ~1650 published rows, 300 covers
  // the published catalogue ranked by highlight_score DESC (the top 300
  // span virtually every match that has at least one notable clip).
  // Could be swapped for a HEAD count + group-by RPC later, but trimming
  // saves ~400KB egress per cache miss in the meantime.
  const [data, allClips, dbMatchesRes, dbTeamsRes] = await Promise.all([
    Promise.resolve(loadRealData()),
    getPublishedKills(300),
    sb.from("matches").select("external_id,scheduled_at,stage,format,team_blue_id,team_red_id,winner_team_id"),
    sb.from("teams").select("id,code,name"),
  ]);
  const matches = getMatchesSorted(data);

  // Build team lookup
  const teams = new Map((dbTeamsRes.data ?? []).map((t) => [t.id, t]));
  const dbMatches = dbMatchesRes.data ?? [];

  // Merge: matches NOT in static JSON but in DB → add as "DB-only"
  const jsonIds = new Set(matches.map((m) => m.id));
  const dbOnly = dbMatches.filter((m) => !jsonIds.has(m.external_id)).map((m) => {
    const blue = teams.get(m.team_blue_id ?? "");
    const red = teams.get(m.team_red_id ?? "");
    const winner = teams.get(m.winner_team_id ?? "");
    const isKcBlue = blue?.code === "KC";
    const opponent = isKcBlue ? red : blue;
    // Normalize "bo1"/"bo3"/"bo5" → numeric best_of so the card renders
    // "Bo1" (not "Bobo1" by prefixing "Bo" onto the raw "bo1" string).
    const bestOfNum = Number.parseInt(String(m.format ?? "").replace(/\D/g, ""), 10);
    return {
      id: m.external_id,
      date: (m.scheduled_at ?? "").slice(0, 10),
      stage: m.stage ?? "LEC",
      best_of: Number.isFinite(bestOfNum) && bestOfNum > 0 ? bestOfNum : 1,
      opponent: { code: opponent?.code ?? "?", name: opponent?.name ?? "?" },
      // Unknown winner (no winner_team_id yet) → null = neutral "À venir",
      // NOT a false (which would render a red Loss + skew the W/L tally).
      kc_won: m.winner_team_id ? winner?.code === "KC" : null,
      kc_score: 0,  // unknown without games detail
      opp_score: 0,
      games: [],
    };
  });

  const allMatches = [...matches, ...dbOnly];

  // Count clips per match
  const clipsByMatch = new Map<string, number>();
  for (const clip of allClips) {
    const matchId = clip.games?.matches?.external_id;
    if (matchId) {
      clipsByMatch.set(matchId, (clipsByMatch.get(matchId) ?? 0) + 1);
    }
  }

  // Group by year
  const byYear: Record<string, typeof allMatches> = {};
  for (const m of allMatches) {
    const year = m.date.slice(0, 4);
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(m);
  }

  const years = Object.entries(byYear)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([year, yearMatches]) => ({
      year,
      matches: yearMatches.map((match) => ({
        id: match.id,
        opponent: match.opponent,
        kc_won: match.kc_won,
        kc_score: match.kc_score,
        opp_score: match.opp_score,
        stage: match.stage,
        best_of: match.best_of,
        date: match.date,
        totalKc: match.games.reduce((a, g) => a + g.kc_kills, 0),
        totalOpp: match.games.reduce((a, g) => a + g.opp_kills, 0),
        hasGames: match.games.length > 0,
        clipCount: clipsByMatch.get(match.id) ?? 0,
      })),
    }));

  // Overall W/L tally for the hero eyebrow. Mirrors the accordion's logic:
  // null winner (upcoming / unresolved) is excluded from both counters.
  const totalWins = allMatches.filter((m) => m.kc_won === true).length;
  const totalLosses = allMatches.filter((m) => m.kc_won === false).length;
  const winRate =
    totalWins + totalLosses > 0
      ? Math.round((totalWins / (totalWins + totalLosses)) * 100)
      : null;

  return (
    <div
      className="-mt-6"
      style={{
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      {/* \u2500\u2500\u2500 HERO \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
      <section
        className="relative overflow-hidden border-b border-[var(--border-gold)] py-14 px-6 md:py-20"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 32%, rgba(200,170,110,0.16) 0%, transparent 62%), linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-primary) 100%)",
        }}
      >
        {/* Scanlines */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.13] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.08) 3px, transparent 4px)",
          }}
        />
        {/* Floating gold rhombus accents */}
        <div
          aria-hidden
          className="absolute left-[6%] top-12 hidden md:block"
          style={{
            width: 13,
            height: 13,
            transform: "rotate(45deg)",
            background: "linear-gradient(135deg, var(--gold), var(--gold-dark))",
            opacity: 0.5,
            boxShadow: "0 0 20px rgba(200,170,110,0.45)",
          }}
        />
        <div
          aria-hidden
          className="absolute right-[8%] top-24 hidden md:block"
          style={{
            width: 9,
            height: 9,
            transform: "rotate(45deg)",
            background: "var(--gold)",
            opacity: 0.4,
            boxShadow: "0 0 14px rgba(200,170,110,0.4)",
          }}
        />

        <div className="relative z-10 mx-auto max-w-7xl">
          <Breadcrumb
            items={[{ label: "Accueil", href: "/" }, { label: "Matchs" }]}
          />

          <div className="mt-10 text-center">
            <p className="font-data text-[10px] md:text-[11px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-4 flex items-center justify-center gap-3">
              <span
                aria-hidden
                className="inline-block"
                style={{
                  width: 8,
                  height: 8,
                  transform: "rotate(45deg)",
                  background:
                    "linear-gradient(135deg, var(--gold), var(--gold-dark))",
                  boxShadow: "0 0 10px rgba(200,170,110,0.5)",
                }}
              />
              {allMatches.length} matchs
              {winRate != null && <span>\u00B7 {winRate}% winrate</span>}
            </p>
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-black leading-none tracking-tight">
              <span className="text-shimmer">MATCHS</span>
            </h1>
            <p className="mt-6 max-w-2xl mx-auto text-base md:text-lg text-[var(--text-muted)] leading-relaxed">
              Tout l&apos;historique Karmine Corp, saison par saison. Scores,
              r\u00E9sultats, kills par game et clips vid\u00E9o. Clique un match pour
              ouvrir sa timeline compl\u00E8te.
            </p>

            {/* Tally chips */}
            <div className="mt-7 flex items-center justify-center gap-2.5 flex-wrap font-data text-[11px] uppercase tracking-widest">
              <span className="rounded-lg border border-[var(--green)]/30 bg-[var(--green)]/10 px-3 py-1.5 font-bold text-[var(--green)]">
                {totalWins}V
              </span>
              <span className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/10 px-3 py-1.5 font-bold text-[var(--red)]">
                {totalLosses}D
              </span>
              <span className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-1.5 text-[var(--text-muted)]">
                {data.total_games} games
              </span>
              {allClips.length > 0 && (
                <span className="badge-glass rounded-lg px-3 py-1.5 font-bold text-[var(--gold)]">
                  {allClips.length} clips
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* \u2500\u2500\u2500 MATCH LIST \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
      <section className="mx-auto max-w-7xl px-4 md:px-6 py-12">
        <MatchesAccordion years={years} />
      </section>

      {/* \u2500\u2500\u2500 Disclaimer Riot \u2014 required on every public page \u2500\u2500\u2500\u2500\u2500\u2500 */}
      <p
        aria-label="Riot Games disclaimer"
        className="px-4 pb-6 text-center text-[9px] uppercase tracking-widest text-[var(--text-muted)]"
      >
        Not endorsed by Riot Games. League of Legends \u00A9 Riot Games.
      </p>
    </div>
  );
}
