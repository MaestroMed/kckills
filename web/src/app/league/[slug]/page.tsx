/**
 * /league/[slug] — League hub (PR-loltok BC).
 *
 * Lists every team in the league with a link to /team/{slug}, plus a
 * recent matches table across the league. Powers the LeagueNav chip
 * strip in LoLTok mode.
 *
 * KC pilot mode (NEXT_PUBLIC_LOLTOK_PUBLIC=false) :
 *   * Only `lec` is reachable (LeagueNav hides the other chips).
 *   * The page itself still renders for direct links — we don't 404
 *     LCK / LCS deep-links so backlinks survive the env flip.
 *
 * SSR + ISR (revalidate 300s). JSON-LD `SportsOrganization`.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  getLeagueBySlug,
} from "@/lib/leagues-loader";
import {
  getTeamsByLeague,
  getRecentMatchesForLeague,
  type LeagueMatchCard,
  type TeamRow,
} from "@/lib/teams-loader";
import { JsonLd, breadcrumbLD } from "@/lib/seo/jsonld";

export const revalidate = 300;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const league = await getLeagueBySlug(slug);
  if (!league) return { title: "Ligue introuvable — KCKILLS" };
  const title = `${league.short_name} (${league.name}) — KCKILLS`;
  const description = `Toutes les équipes et matchs de la ${league.name} (${league.region}) sur KCKILLS.`;
  const canonicalPath = `/league/${league.slug}`;
  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonicalPath,
      siteName: "KCKILLS",
      locale: "fr_FR",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function LeaguePage({ params }: Props) {
  const { slug } = await params;
  const league = await getLeagueBySlug(slug);
  if (!league) notFound();

  const [teams, matches] = await Promise.all([
    getTeamsByLeague(league.slug),
    getRecentMatchesForLeague(league.slug, 24),
  ]);

  // ─── JSON-LD : SportsOrganization (esports leagues fit here) ─────
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    name: league.name,
    alternateName: league.short_name,
    sport: "Esports — League of Legends",
    url: `/league/${league.slug}`,
    location: league.region,
  };

  const crumbs = [
    { name: "Accueil", url: "/" },
    { name: league.short_name, url: `/league/${league.slug}` },
  ];

  return (
    <main className="min-h-screen bg-[var(--bg-primary)]">
      <JsonLd data={orgJsonLd} />
      <JsonLd data={breadcrumbLD(crumbs)} />

      {/* ─── Header ───────────────────────────────────────────── */}
      <header className="border-b border-[var(--border-gold)]/40 bg-gradient-to-b from-[var(--bg-elevated)] to-[var(--bg-primary)]">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <nav aria-label="Fil d'Ariane" className="mb-4">
            <ol className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              {crumbs.map((c, i) => (
                <li key={c.url} className="flex items-center gap-1.5">
                  {i > 0 ? <span aria-hidden="true">/</span> : null}
                  {i === crumbs.length - 1 ? (
                    <span className="text-[var(--text-secondary)]">{c.name}</span>
                  ) : (
                    <Link href={c.url} className="hover:text-[var(--gold)] transition-colors">
                      {c.name}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <p className="font-data text-[10px] uppercase tracking-[0.2em] text-[var(--gold)]/70">
            {league.region}
          </p>
          <h1 className="mt-1 font-display text-3xl md:text-5xl font-black text-[var(--text-primary)]">
            {league.short_name}
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{league.name}</p>
        </div>
      </header>

      {/* ─── Teams ────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 py-10">
        <h2 className="font-display text-xl font-bold text-[var(--text-primary)] mb-4">
          Équipes
        </h2>
        {teams.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            Aucune équipe rattachée à {league.short_name} pour le moment.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr className="border-b border-[var(--border-gold)]/40">
                  <th className="font-data text-[10px] uppercase tracking-widest text-[var(--gold)]/70 py-2 pr-3">
                    Code
                  </th>
                  <th className="font-data text-[10px] uppercase tracking-widest text-[var(--gold)]/70 py-2 pr-3">
                    Équipe
                  </th>
                  <th className="font-data text-[10px] uppercase tracking-widest text-[var(--gold)]/70 py-2 pr-3 hidden sm:table-cell">
                    Région
                  </th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t: TeamRow) => (
                  <tr
                    key={t.slug}
                    className="border-b border-[var(--border-subtle)] hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-2 pr-3 font-data font-bold text-[var(--gold)]">{t.code}</td>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/team/${t.slug}`}
                        className="text-[var(--text-primary)] hover:text-[var(--gold)] transition-colors flex items-center gap-2"
                      >
                        {t.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={t.logo_url}
                            alt=""
                            className="h-6 w-6 object-contain"
                            loading="lazy"
                          />
                        ) : null}
                        {t.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-muted)] hidden sm:table-cell">
                      {t.region ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Recent matches ───────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 pb-10">
        <h2 className="font-display text-xl font-bold text-[var(--text-primary)] mb-4">
          Derniers matchs
        </h2>
        {matches.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            Aucun match programmé pour {league.short_name} pour le moment.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            {matches.map((m: LeagueMatchCard) => (
              <li key={m.external_id}>
                <MatchRow match={m} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Riot disclaimer — required on every public page (CLAUDE.md §7.6) */}
      <footer className="mx-auto max-w-5xl px-4 pb-10">
        <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
          KCKILLS was created under Riot Games&apos; &quot;Legal Jibber Jabber&quot;
          policy using assets owned by Riot Games. Riot Games does not endorse
          or sponsor this project.
        </p>
      </footer>
    </main>
  );
}

function MatchRow({ match }: { match: LeagueMatchCard }) {
  const date = match.scheduled_at ? new Date(match.scheduled_at) : null;
  const dateLabel = date
    ? date.toLocaleDateString("fr-FR", { year: "numeric", month: "short", day: "numeric" })
    : "—";
  const blue = match.team_blue;
  const red = match.team_red;
  return (
    <Link
      href={`/match/${match.external_id}`}
      className="block px-4 py-3 hover:bg-white/[0.02] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
            <TeamBadge team={blue} winner={match.winner_code === blue?.code} />
            <span className="text-[var(--text-muted)] text-xs">vs</span>
            <TeamBadge team={red} winner={match.winner_code === red?.code} />
          </div>
        </div>
        <div className="text-right text-xs text-[var(--text-muted)] flex-shrink-0">
          <p>{dateLabel}</p>
          {match.stage ? <p className="mt-0.5">{match.stage}</p> : null}
        </div>
      </div>
    </Link>
  );
}

function TeamBadge({
  team,
  winner,
}: {
  team: { code: string; name: string; slug: string } | null;
  winner: boolean;
}) {
  if (!team) return <span className="text-[var(--text-muted)] text-xs">?</span>;
  return (
    <span
      className={`inline-flex items-center gap-1 ${
        winner ? "text-[var(--gold)] font-bold" : "text-[var(--text-secondary)]"
      }`}
    >
      <span className="font-data">{team.code}</span>
    </span>
  );
}
