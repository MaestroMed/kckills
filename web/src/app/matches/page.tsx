import type { Metadata } from "next";
import { loadRealData, getMatchesSorted } from "@/lib/real-data";
import { getPublishedKills } from "@/lib/supabase/kills";
// Audit compteurs 2026-08-12 — la chip « clips » affichait
// `allClips.length` = le CAP de fetch (300), pas un total. Elle affiche
// désormais le compteur canonique partagé (kills KC publiés avec clip
// jouable — même chiffre que /scroll, /clips et la home).
import { getCachedPublishedClipsCount } from "@/lib/stats-scopes";
import { createAnonSupabase } from "@/lib/supabase/server";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getStaticT } from "@/lib/i18n/getServerLang";
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
  const { t } = getStaticT();
  // Audit 2026-07-02 : createAnonSupabase() throws when the Supabase
  // env is absent (this page was the ONLY one killing `next build` in
  // env-less contexts — every other page degrades). Null client →
  // static-JSON-only rendering, same as a Supabase outage.
  let sb: ReturnType<typeof createAnonSupabase> | null = null;
  try {
    sb = createAnonSupabase();
  } catch {
    console.warn("[matches] Supabase env missing — rendering static data only");
  }
  const emptyRes = { data: null, error: null } as const;
  // Wave 34 T2.2 — trim 500 → 300.
  // The list iterates `allClips` only to compute `clipsByMatch.size`
  // counters and a single total `allClips.length` for the header chip.
  // With ~80 matches in the history and ~1650 published rows, 300 covers
  // the published catalogue ranked by highlight_score DESC (the top 300
  // span virtually every match that has at least one notable clip).
  // Could be swapped for a HEAD count + group-by RPC later, but trimming
  // saves ~400KB egress per cache miss in the meantime.
  const [data, allClips, publishedClipsTotal, dbMatchesRes, dbTeamsRes, dbGamesRes] = await Promise.all([
    Promise.resolve(loadRealData()),
    getPublishedKills(300),
    getCachedPublishedClipsCount(),
    sb
      ? sb.from("matches").select("id,external_id,scheduled_at,stage,format,team_blue_id,team_red_id,winner_team_id")
      : Promise.resolve(emptyRes),
    sb ? sb.from("teams").select("id,code,name") : Promise.resolve(emptyRes),
    // 2026-09-24 : vainqueurs des games -> score des séries hors
    // kc_matches.json (ils s'affichaient sans score).
    sb ? sb.from("games").select("match_id,winner_team_id").limit(5000) : Promise.resolve(emptyRes),
  ]);
  const matches = getMatchesSorted(data);

  // Build team lookup
  const teams = new Map((dbTeamsRes.data ?? []).map((t) => [t.id, t]));
  const dbMatches = dbMatchesRes.data ?? [];

  // Score d'une série depuis ses games : seulement si TOUTES ont un
  // vainqueur (une série disputée à moitié connue donnerait un faux 1-0).
  const gamesByMatch = new Map<string, (string | null)[]>();
  for (const g of dbGamesRes.data ?? []) {
    const list = gamesByMatch.get(g.match_id) ?? [];
    list.push(g.winner_team_id);
    gamesByMatch.set(g.match_id, list);
  }

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
    const winners = gamesByMatch.get(m.id) ?? [];
    const complete = winners.length > 0 && winners.every(Boolean);
    const kcTeamId = isKcBlue ? m.team_blue_id : m.team_red_id;
    const kcGames = complete ? winners.filter((w) => w === kcTeamId).length : 0;
    return {
      id: m.external_id,
      date: (m.scheduled_at ?? "").slice(0, 10),
      stage: m.stage ?? "LEC",
      best_of: Number.isFinite(bestOfNum) && bestOfNum > 0 ? bestOfNum : 1,
      opponent: { code: opponent?.code ?? "?", name: opponent?.name ?? "?" },
      // Unknown winner (no winner_team_id yet) → null = neutral "À venir",
      // NOT a false (which would render a red Loss + skew the W/L tally).
      kc_won: m.winner_team_id ? winner?.code === "KC" : null,
      kc_score: kcGames,
      opp_score: complete ? winners.length - kcGames : 0,
      games: [],
    };
  });

  // 2026-09-24 : les matchs de la base s'ajoutaient APRÈS ceux du JSON,
  // donc hors de l'ordre chronologique dans chaque année. Tri global,
  // plus récent d'abord ; les matchs sans date passent en dernier.
  //
  // Les « matchs » gol.gg sont des games isolées (une ligne par game). Dès
  // qu'ils ont une date, ils doublonnaient la série officielle du même jour
  // (« KC vs GEN » deux fois le 15/07, TL + TLAW au MSI). Une ligne gol.gg
  // n'est gardée que si aucun match officiel n'existe à ±1 jour : c'est le
  // cas des saisons LFL 2021-2023, que seul gol.gg couvre.
  const dayOf = (d: string) => Math.floor(Date.parse(`${d}T12:00:00Z`) / 86_400_000);
  const officialDays = new Set<number>();
  for (const m of [...matches, ...dbOnly]) {
    if (m.date && !String(m.id).startsWith("golgg_")) officialDays.add(dayOf(m.date));
  }
  const coveredByOfficial = (m: { id: string; date: string }) => {
    if (!String(m.id).startsWith("golgg_") || !m.date) return false;
    const d = dayOf(m.date);
    return officialDays.has(d - 1) || officialDays.has(d) || officialDays.has(d + 1);
  };
  const allMatches = [...matches, ...dbOnly]
    .filter((m) => !coveredByOfficial(m))
    .sort((a, b) => (b.date || "0000").localeCompare(a.date || "0000"));

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
  // Audit compteurs 12/08 : le reliquat (matchs sans résultat connu) est
  // affiché en chip pour que V + D + sans-résultat = total listé (avant :
  // « 592 matchs » vs « 336V · 219D » qui ne sommaient pas).
  const totalWins = allMatches.filter((m) => m.kc_won === true).length;
  const totalLosses = allMatches.filter((m) => m.kc_won === false).length;
  const totalNoResult = allMatches.length - totalWins - totalLosses;
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
            items={[{ label: t("nav.home"), href: "/" }, { label: t("nav.matches") }]}
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
              {t("p_matches.n_matches", { n: allMatches.length })}
              {winRate != null && (
                <span>· {t("p_matches.winrate", { rate: winRate })}</span>
              )}
            </p>
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-black leading-none tracking-tight">
              <span className="text-shimmer">{t("p_matches.hero_title")}</span>
            </h1>
            <p className="mt-6 max-w-2xl mx-auto text-base md:text-lg text-[var(--text-muted)] leading-relaxed">
              {t("p_matches.subtitle")}
            </p>

            {/* Tally chips — V + D + sans-résultat = total du hero, games
                libellées « détaillées » (log statique), clips = compteur
                canonique (audit compteurs 12/08). */}
            <div className="mt-7 flex items-center justify-center gap-2.5 flex-wrap font-data text-[11px] uppercase tracking-widest">
              <span className="rounded-lg border border-[var(--green)]/30 bg-[var(--green)]/10 px-3 py-1.5 font-bold text-[var(--green)]">
                {t("p_matches.wins_short", { n: totalWins })}
              </span>
              <span className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/10 px-3 py-1.5 font-bold text-[var(--red)]">
                {t("p_matches.losses_short", { n: totalLosses })}
              </span>
              {totalNoResult > 0 && (
                <span className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-[var(--text-muted)]">
                  {t("p_matches.no_result_short", { n: totalNoResult })}
                </span>
              )}
              <span className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-1.5 text-[var(--text-muted)]">
                {t("p_matches.games_detail_count", { n: data.total_games })}
              </span>
              {publishedClipsTotal > 0 && (
                <span className="badge-glass rounded-lg px-3 py-1.5 font-bold text-[var(--gold)]">
                  {t("p_matches.clips_count", { n: publishedClipsTotal })}
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
