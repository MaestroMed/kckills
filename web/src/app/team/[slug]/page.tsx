/**
 * /team/[slug] — Generic team hub page (PR-loltok BC).
 *
 * Renders a team header (logo, name, league, region) plus a recent-
 * kills feed for that team. Works for ANY team in the catalog, not
 * just KC — that's the whole point of the LoLTok rewrite path.
 *
 * KC pilot mode keeps `/` and `/scroll` as the canonical KC entry
 * points ; this page is purely additive. When NEXT_PUBLIC_LOLTOK_PUBLIC
 * is false the route still renders (we don't want deep-links to break)
 * but the LeagueNav chip strip at the top doesn't surface it.
 *
 * SSR + ISR (revalidate 300s) — same caching shape as the rest of
 * /matches and /player so the egress profile stays predictable.
 *
 * SEO : JSON-LD `SportsTeam` schema + canonical OG metadata. The
 * generic team page is intentionally self-canonical (we don't redirect
 * KC → / because that would break LoLTok's "every team has a hub"
 * contract).
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import {
  getTeamBySlug,
  getRecentKillsForTeam,
  type TeamKillCard,
} from "@/lib/teams-loader";
import { JsonLd, breadcrumbLD } from "@/lib/seo/jsonld";

export const revalidate = 1800; // Wave 13d : DB pressure

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) return { title: "Équipe introuvable — KCKILLS" };
  const title = `${team.name} — KCKILLS`;
  const descBits = [team.code];
  if (team.league) descBits.push(team.league.toUpperCase());
  if (team.region) descBits.push(team.region);
  const description = `${team.name} (${descBits.join(" · ")}) — clips, kills et stats sur KCKILLS.`;
  const canonicalPath = `/team/${team.slug}`;
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
      images: team.logo_url ? [{ url: team.logo_url, alt: team.name }] : undefined,
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: team.logo_url ? [team.logo_url] : undefined,
    },
  };
}

export default async function TeamPage({ params }: Props) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) notFound();

  const kills = await getRecentKillsForTeam(team.slug, 24);

  // ─── JSON-LD : SportsTeam ──────────────────────────────────────
  const teamJsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsTeam",
    name: team.name,
    alternateName: team.code !== team.name ? team.code : undefined,
    sport: "Esports — League of Legends",
    url: `/team/${team.slug}`,
    ...(team.logo_url ? { logo: team.logo_url } : {}),
    ...(team.region ? { location: team.region } : {}),
  };

  const crumbs = [
    { name: "Accueil", url: "/" },
    ...(team.league ? [{ name: team.league.toUpperCase(), url: `/league/${team.league}` }] : []),
    { name: team.name, url: `/team/${team.slug}` },
  ];

  return (
    <main className="min-h-screen bg-[var(--bg-primary)]">
      <JsonLd data={teamJsonLd} />
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
          <div className="flex items-start gap-5">
            <div className="flex-shrink-0">
              {team.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={team.logo_url}
                  alt={`Logo ${team.name}`}
                  className="h-20 w-20 md:h-24 md:w-24 object-contain"
                  loading="eager"
                />
              ) : (
                <div className="h-20 w-20 md:h-24 md:w-24 flex items-center justify-center rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-gold)] text-2xl font-display font-black text-[var(--gold)]">
                  {team.code.slice(0, 3)}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-data text-[10px] uppercase tracking-[0.2em] text-[var(--gold)]/70">
                {team.code}
              </p>
              <h1 className="mt-1 font-display text-3xl md:text-5xl font-black text-[var(--text-primary)]">
                {team.name}
              </h1>
              <div className="mt-3 flex flex-wrap gap-2">
                {team.league ? (
                  <Link
                    href={`/league/${team.league}`}
                    className="inline-flex items-center rounded-full border border-[var(--border-gold)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40 transition-colors"
                  >
                    {team.league.toUpperCase()}
                  </Link>
                ) : null}
                {team.region ? (
                  <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs font-medium text-[var(--text-muted)]">
                    {team.region}
                  </span>
                ) : null}
                {team.is_tracked ? (
                  <span className="inline-flex items-center rounded-full bg-[var(--gold)]/15 border border-[var(--gold)]/30 px-3 py-1 text-xs font-medium text-[var(--gold)]">
                    Suivi
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ─── Recent kills ─────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 py-10">
        <h2 className="font-display text-xl font-bold text-[var(--text-primary)] mb-4">
          Derniers clips
        </h2>
        {kills.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            Aucun clip publié pour {team.name} pour le moment.
          </p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {kills.map((k) => (
              <li key={k.id}>
                <KillThumb kill={k} />
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

interface KillThumbProps {
  kill: TeamKillCard;
}

function KillThumb({ kill }: KillThumbProps) {
  const desc =
    kill.ai_description_fr ??
    kill.ai_description ??
    (kill.killer_champion && kill.victim_champion
      ? `${kill.killer_champion} élimine ${kill.victim_champion}`
      : "Clip");
  return (
    <Link
      href={`/kill/${kill.id}`}
      className="group block aspect-[9/16] relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] transition-colors hover:border-[var(--gold)]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
    >
      {kill.thumbnail_url ? (
        <Image
          src={kill.thumbnail_url}
          alt={desc}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="object-cover transition-transform group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)] text-xs">
          {kill.killer_champion ?? "?"}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2">
        <p className="text-[11px] text-white font-medium line-clamp-2">{desc}</p>
        {kill.highlight_score != null ? (
          <p className="text-[10px] font-data text-[var(--gold)] mt-0.5">
            {kill.highlight_score.toFixed(1)} / 10
          </p>
        ) : null}
      </div>
    </Link>
  );
}
