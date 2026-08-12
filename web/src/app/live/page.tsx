/**
 * /live — dedicated live-match feed page.
 *
 * Server shell that :
 *   1. Resolves the current live match via getCurrentLiveMatch()
 *   2. If no match is live → renders an explicit "hors live" state
 *      (audit 2026-08-12 : l'ancien redirect /scroll?from=live&reason=
 *      no-match n'était consommé par personne — l'utilisateur atterrissait
 *      sur un clip quelconque sans explication). Le prochain RDV connu
 *      (registre statique lib/next-match) est affiché quand il existe.
 *   3. Otherwise renders <LiveScroll /> which polls the same
 *      /api/live/state endpoint as the global LiveHotNow banner
 *
 * Why this can't be statically rendered :
 *   * the live-match identity is by definition transient (changes
 *     every match day)
 *   * the recent-kills list is a write-heavy resource updated mid-match
 *
 * Hence `dynamic = 'force-dynamic'`. We DO accept a tiny CDN cache via
 * the /api/live/state endpoint's `revalidate = 10` so visitor pileups
 * during a match still go to the CDN, not all the way down to Supabase.
 */

import Link from "next/link";
import {
  getCurrentLiveMatch,
  getLiveMatchScore,
  getRecentLiveKills,
  type LiveMatchRow,
  type LiveKillRow,
} from "@/lib/supabase/live";
import { getNextMatch } from "@/lib/next-match";
import { getServerT } from "@/lib/i18n/server-lang";
import { formatDate } from "@/lib/i18n/lang";
import { LiveScroll } from "./LiveScroll";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "KC Live — kills en direct",
  description:
    "Les kills de Karmine Corp en direct pendant le match LEC. Clips, score live, et notifs push.",
  alternates: { canonical: "/live" },
  robots: { index: false, follow: true },
  openGraph: {
    title: "KC Live — kills en direct",
    description: "Suis le match KC kill par kill, en temps réel.",
    type: "website" as const,
    url: "/live",
    siteName: "KCKILLS",
    locale: "fr_FR",
  },
};

export default async function LivePage() {
  const liveMatch = await getCurrentLiveMatch();

  if (!liveMatch) {
    // État hors-match explicite (audit 2026-08-12). Sobre : badge gris,
    // titre, prochain RDV si le registre statique en connaît un, et deux
    // sorties (scroll / historique). Le jour de match, cette branche
    // n'est jamais atteinte — LiveScroll reste inchangé.
    const { lang, t } = await getServerT();
    const next = getNextMatch();
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-1.5 font-data text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full bg-[var(--text-disabled)]"
          />
          {t("p_live.offline_badge")}
        </p>
        <h1 className="mt-6 font-display text-3xl font-black text-[var(--text-primary)] sm:text-4xl">
          {t("p_live.offline_title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
          {t("p_live.offline_body")}
        </p>

        {next && (
          <div className="mx-auto mt-8 max-w-md rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
            <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70">
              {t("p_live.offline_next_label")}
            </p>
            <p className="mt-2 font-display text-xl font-black text-[var(--text-primary)]">
              KC <span className="text-[var(--gold)]">vs</span> {next.opponentCode}
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {next.stage} · {next.format.toUpperCase()}
            </p>
            <p className="mt-1 font-data text-xs text-[var(--text-muted)]">
              {formatDate(lang, next.kickoffISO, {
                weekday: "long",
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Europe/Paris",
              })}
            </p>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/scroll"
            className="inline-block rounded-full bg-[var(--gold)] px-5 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90"
          >
            {t("p_live.offline_cta_scroll")}
          </Link>
          <Link
            href="/matches"
            className="inline-block rounded-full border border-[var(--border-gold)] px-5 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/60 hover:text-[var(--gold)]"
          >
            {t("p_live.offline_cta_matches")}
          </Link>
        </div>
      </div>
    );
  }

  // SSR the first chunk so the LCP isn't a spinner. The client will
  // take over polling from here.
  const [recentKills, score]: [LiveKillRow[], { kc: number; opp: number }] =
    await Promise.all([
      getRecentLiveKills(liveMatch.id, { limit: 30 }),
      getLiveMatchScore(liveMatch.id),
    ]);

  return (
    <LiveScroll
      initialMatch={liveMatch as LiveMatchRow}
      initialKills={recentKills}
      initialScore={score}
    />
  );
}
