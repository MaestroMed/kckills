/**
 * /bracket/[slug] — Archived tournament view (Wave 30h).
 *
 * Read-only bracket page. Shows the full path the champion took
 * (R1 → R2 → … → Final) plus the standard tree with all winners
 * crowned. No vote buttons — pure history.
 *
 * Cache strategy : revalidate=3600 (1h). Past tournaments are immutable
 * — they only change when fn_close_round backfills the final winner,
 * and at that point status flips to 'closed' and never moves again.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JsonLd, breadcrumbLD } from "@/lib/seo/jsonld";
import {
  getBracketBySlug,
  getPastWinners,
  roundLabel,
  roundsForSize,
  type BracketBundle,
} from "@/lib/supabase/bracket";

import { BracketView } from "../BracketView";

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getBracketBySlug(slug);
  const name = bundle.tournament?.name ?? "Tournoi archivé — KCKILLS";
  const description = bundle.tournament
    ? `Le bracket complet du ${bundle.tournament.name.toLowerCase()}. Revis le parcours du champion et les votes communautaires.`
    : "Archives du tournoi mensuel KCKILLS.";
  return {
    title: `${name} — Bracket`,
    description,
    alternates: { canonical: `/bracket/${encodeURIComponent(slug)}` },
    openGraph: {
      title: name,
      description,
      type: "website",
      url: `/bracket/${encodeURIComponent(slug)}`,
      siteName: "KCKILLS",
      locale: "fr_FR",
    },
    twitter: {
      card: "summary_large_image",
      title: name,
      description,
    },
  };
}

export default async function BracketArchivePage({ params }: PageProps) {
  const { slug } = await params;
  const [bundle, pastWinners] = await Promise.all([
    getBracketBySlug(slug),
    getPastWinners(12),
  ]);

  if (!bundle.tournament) {
    notFound();
  }

  const championPath = computeChampionPath(bundle);

  const breadcrumb = breadcrumbLD([
    { name: "Accueil", url: "/" },
    { name: "Tournoi du Mois", url: "/bracket" },
    { name: bundle.tournament.name, url: `/bracket/${encodeURIComponent(slug)}` },
  ]);

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
      <JsonLd data={breadcrumb} />

      <nav
        aria-label="Fil d'Ariane"
        className="mx-auto max-w-6xl px-5 pt-6 flex items-center justify-start gap-2 text-xs text-white/55 flex-wrap"
      >
        <Link href="/" className="hover:text-[var(--gold)] transition-colors">
          Accueil
        </Link>
        <span aria-hidden className="text-white/25">
          ◆
        </span>
        <Link href="/bracket" className="hover:text-[var(--gold)] transition-colors">
          Tournoi du Mois
        </Link>
        <span aria-hidden className="text-white/25">
          ◆
        </span>
        <span className="text-[var(--gold)]">{bundle.tournament.name}</span>
      </nav>

      {championPath && (
        <section
          className="relative mx-auto max-w-6xl px-4 md:px-6 pt-6"
          aria-label="Parcours du champion"
        >
          <div
            className="rounded-2xl border bg-[var(--bg-surface)]/80 backdrop-blur-md p-4 md:p-5"
            style={{
              borderColor: "rgba(200,170,110,0.35)",
              boxShadow: "0 18px 38px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(200,170,110,0.06)",
            }}
          >
            <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/85 mb-3">
              ♛ Parcours du champion
            </p>
            <div className="flex items-center flex-wrap gap-2 text-[11px] md:text-xs">
              {championPath.map((step, i) => (
                <span key={`${step.round}-${i}`} className="flex items-center gap-2">
                  <span className="font-data uppercase tracking-widest text-white/45">
                    {step.label}
                  </span>
                  <span
                    className="font-display font-bold"
                    style={{ color: step.isFinal ? "var(--gold-bright)" : "var(--gold)" }}
                  >
                    {step.winnerName ?? "?"}{" "}
                    <span className="text-white/45">vs {step.loserName ?? "?"}</span>
                    <span className="text-white/35"> · {step.votesWinner}-{step.votesLoser}</span>
                  </span>
                  {i < championPath.length - 1 && (
                    <span aria-hidden className="text-[var(--gold)]/45">
                      →
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      <BracketView bundle={bundle} pastWinners={pastWinners} readOnly />

      <p
        aria-label="Riot Games disclaimer"
        className="px-4 pb-6 text-center text-[9px] uppercase tracking-widest text-white/30"
      >
        Not endorsed by Riot Games. League of Legends © Riot Games.
      </p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Champion path — walk from R1 to the final following the winner
// ════════════════════════════════════════════════════════════════════

interface ChampionStep {
  round: number;
  label: string;
  winnerName: string | null;
  loserName: string | null;
  votesWinner: number;
  votesLoser: number;
  isFinal: boolean;
}

function computeChampionPath(bundle: BracketBundle): ChampionStep[] | null {
  if (!bundle.tournament?.champion_kill_id) return null;
  const championKillId = bundle.tournament.champion_kill_id;
  const totalRounds = roundsForSize(bundle.tournament.bracket_size);

  const path: ChampionStep[] = [];
  for (let r = 1; r <= totalRounds; r += 1) {
    const matchesInRound = bundle.matches.filter((m) => m.round === r);
    // The match in this round where the champion appears is the one
    // whose winner == championKillId.
    const match = matchesInRound.find((m) => m.winner_kill_id === championKillId);
    if (!match) {
      // If the champion didn't compete in this round (e.g. BYE'd), skip silently.
      continue;
    }
    const championIsA = match.kill_a_id === championKillId;
    const winnerName = championIsA ? match.kill_a_killer_name : match.kill_b_killer_name;
    const loserName = championIsA ? match.kill_b_killer_name : match.kill_a_killer_name;
    const votesWinner = championIsA ? match.votes_a : match.votes_b;
    const votesLoser = championIsA ? match.votes_b : match.votes_a;
    path.push({
      round: r,
      label: roundLabel(r, totalRounds),
      winnerName: winnerName ?? (championIsA ? match.kill_a_killer_champion : match.kill_b_killer_champion),
      loserName: loserName ?? (championIsA ? match.kill_b_killer_champion : match.kill_a_killer_champion),
      votesWinner,
      votesLoser,
      isFinal: r === totalRounds,
    });
  }
  return path.length > 0 ? path : null;
}
