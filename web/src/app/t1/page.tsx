import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getKillsByMatchExternalId, type PublishedKillRow } from "@/lib/supabase/kills";
import { pickAssetUrl } from "@/lib/kill-assets";
import { FullKillsGrid } from "@/components/match/FullKillsGrid";
import { KC_LOGO } from "@/lib/kc-assets";
import { SITE_URL } from "@/lib/site-url";
import { T1_MATCH } from "@/lib/t1-match";

/**
 * /t1 — la rivalité KC × T1.
 *
 * Toutes les séries KC–T1 de l'histoire présentes en base (07/11/2026) :
 *   - Worlds 2026, quart de finale, Bo5 : T1 3-1 KC (Riot 115660540726095103,
 *     KC gagne la game 3 ; vainqueurs lus dans games.winner_team_id)
 *   - MSI 2026, Play-In Knockouts, Bo5 : T1 3-0 KC   (Riot 115570934355614509)
 *   - EWC 2026, demi-finale, Bo3      : KC 2-1 T1   (Riot 116855104460702372)
 * Les lignes gol.gg 79534-79536 sont les mêmes games du MSI (doublons
 * gol.gg/feed, cf. pièges de données) : volontairement ignorées.
 */

export const revalidate = 604800; // saison 2026 close : données figées (08/11)

const SERIES = [
  {
    externalId: "115660540726095103",
    title: "Worlds 2026 · Quart de finale",
    date: "6 novembre 2026",
    score: "T1 3 – 1 KC",
    kcWon: false,
    blurb: "Le Bo5 des Worlds. KC arrache la game 3, T1 referme la série au quatrième match.",
  },
  {
    externalId: "116855104460702372",
    title: "EWC 2026 · Demi-finale",
    date: "18 juillet 2026",
    score: "KC 2 – 1 T1",
    kcWon: true,
    blurb: "La première victoire de la Karmine Corp contre T1. Riyad, Bo3, qualification pour la finale.",
  },
  {
    externalId: "115570934355614509",
    title: "MSI 2026 · Play-In Knockouts",
    date: "29 juin 2026",
    score: "T1 3 – 0 KC",
    kcWon: false,
    blurb: "Le premier choc. T1 ne laisse rien passer en Bo5 : KC repart du MSI avec une leçon.",
  },
] as const;

export const metadata: Metadata = {
  title: "KC × T1 — tous les kills de la rivalité",
  description:
    "Revois tous les kills des séries Karmine Corp contre T1 : MSI 2026, EWC 2026 et le quart de finale des Worlds 2026.",
  alternates: { canonical: `${SITE_URL}/t1` },
  openGraph: {
    title: "KC × T1 — tous les kills de la rivalité",
    description: "MSI, EWC, Worlds : chaque kill KC contre T1.",
    url: `${SITE_URL}/t1`,
  },
};

const hasClip = (k: PublishedKillRow) => Boolean(pickAssetUrl(k, "thumbnail") || k.clip_url_vertical);

export default async function T1RivalryPage() {
  const perSeries = await Promise.all(
    SERIES.map(async (s) => ({ ...s, kills: (await getKillsByMatchExternalId(s.externalId)).filter(hasClip) })),
  );
  const all = perSeries.flatMap((s) => s.kills);
  const best = all
    .filter((k) => k.tracked_team_involvement === "team_killer")
    .sort((a, b) => (b.highlight_score ?? 0) - (a.highlight_score ?? 0))
    .slice(0, 8);
  const upcoming = Date.now() < Date.parse(T1_MATCH.endsAt);

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-gradient-to-br from-[#2a0008] via-[var(--bg-surface)] to-[#001a4d] px-5 py-10 text-center md:py-14">
        <p className="font-data text-[11px] uppercase tracking-[0.3em] text-[var(--gold)]">
          {upcoming ? "Worlds 2026 · Quart de finale · Bo5" : "La rivalité"}
        </p>
        <div className="mt-6 flex items-center justify-center gap-6 md:gap-12">
          <Image src={KC_LOGO} alt="Karmine Corp" width={96} height={96} className="h-16 w-16 object-contain md:h-24 md:w-24" unoptimized />
          <span className="font-display text-3xl font-black text-[var(--gold-bright)] md:text-5xl">×</span>
          <Image src="/images/teams/T1.png" alt="T1" width={96} height={96} className="h-16 w-16 object-contain md:h-24 md:w-24" unoptimized />
        </div>
        <h1 className="mt-6 font-display text-3xl font-black uppercase tracking-wide text-[var(--text-primary)] md:text-5xl">
          KC contre T1
        </h1>
        {upcoming ? (
          <p className="mt-3 text-base text-[var(--text-secondary)] md:text-lg">
            <strong className="text-[var(--gold-bright)]">{T1_MATCH.label}</strong> — revois chaque kill de la rivalité avant le choc.
          </p>
        ) : (
          <p className="mt-3 text-base text-[var(--text-secondary)]">Chaque kill de chaque série entre la Karmine Corp et T1.</p>
        )}
        <dl className="mx-auto mt-8 grid max-w-md grid-cols-3 gap-3 font-data">
          <div className="rounded-xl bg-black/30 p-3">
            <dt className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Séries</dt>
            <dd className="mt-1 text-xl font-bold text-[var(--gold-bright)]">1 – 2</dd>
          </div>
          <div className="rounded-xl bg-black/30 p-3">
            <dt className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Games</dt>
            <dd className="mt-1 text-xl font-bold text-[var(--gold-bright)]">3 – 7</dd>
          </div>
          <div className="rounded-xl bg-black/30 p-3">
            <dt className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Clips</dt>
            <dd className="mt-1 text-xl font-bold text-[var(--gold-bright)]">{all.length}</dd>
          </div>
        </dl>
      </section>

      {/* Best KC kills */}
      {best.length > 0 && (
        <FullKillsGrid kills={best} opponentCode="T1" anchorId="best-kc-kills" title="Les meilleurs kills KC sur T1" />
      )}

      {/* Every series */}
      {perSeries.map((s) => (
        <section key={s.externalId} className="space-y-4">
          <header className="flex flex-col gap-2 border-l-2 border-[var(--gold)] pl-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-data text-[11px] uppercase tracking-widest text-[var(--text-muted)]">{s.date}</p>
              <h2 className="font-display text-2xl font-black uppercase text-[var(--text-primary)]">{s.title}</h2>
              <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">{s.blurb}</p>
            </div>
            <div className="flex items-center gap-4">
              <span className={`font-data text-lg font-bold ${s.kcWon ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{s.score}</span>
              <Link href={`/match/${s.externalId}`} className="text-xs uppercase tracking-widest text-[var(--gold)] hover:underline">
                Le match →
              </Link>
            </div>
          </header>
          <FullKillsGrid kills={s.kills} opponentCode="T1" anchorId={`series-${s.externalId}`} />
        </section>
      ))}
    </div>
  );
}
