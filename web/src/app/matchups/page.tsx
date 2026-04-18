import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { championIconUrl, championLoadingUrl } from "@/lib/constants";
import { PageHero } from "@/components/ui/PageHero";
import { getPublishedKills } from "@/lib/supabase/kills";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Match-ups",
  description:
    "Toutes les confrontations champion contre champion vues dans les clips KC. Browse les match-ups par fr\u00e9quence et plonge dans le d\u00e9tail.",
  alternates: { canonical: "/matchups" },
  openGraph: {
    title: "Match-ups \u2014 KCKILLS",
    description: "Toutes les confrontations champion contre champion vues dans les clips KC.",
    type: "website",
  },
};

interface MatchupStat {
  /** Alphabetically-sorted pair so the same matchup never duplicates. */
  a: string;
  b: string;
  /** Total clips where these two champions face each other (either side). */
  total: number;
  /** Top highlight score across all clips of this matchup — story signal. */
  topHighlight: number;
  /** KC-on-top count: KC's killer champion is one of {a,b}, victim is the other. */
  kcWins: number;
  /** KC-down count: opposite. */
  kcLosses: number;
}

export default async function MatchupsIndexPage() {
  const all = await getPublishedKills(500);

  // Aggregate per (alpha-sorted) champion pair. Order-independent so a
  // single page lives at the canonical /matchup/A/vs/B URL no matter
  // which way around it was filmed.
  const stats = new Map<string, MatchupStat>();
  for (const k of all) {
    if (!k.killer_champion || !k.victim_champion) continue;
    if (k.killer_champion === k.victim_champion) continue; // mirror match-ups are noise here
    const [a, b] = [k.killer_champion, k.victim_champion].sort();
    const key = `${a}|${b}`;
    const e =
      stats.get(key) ??
      ({
        a,
        b,
        total: 0,
        topHighlight: 0,
        kcWins: 0,
        kcLosses: 0,
      } as MatchupStat);
    e.total += 1;
    if ((k.highlight_score ?? 0) > e.topHighlight) {
      e.topHighlight = k.highlight_score ?? 0;
    }
    if (k.tracked_team_involvement === "team_killer") e.kcWins += 1;
    if (k.tracked_team_involvement === "team_victim") e.kcLosses += 1;
    stats.set(key, e);
  }

  // Sort by total volume descending — the chunky rivalries first.
  const ordered = [...stats.values()].sort((x, y) => y.total - x.total);

  // Top 3 get the cinematic split-portrait treatment; everyone else is
  // in the dense grid underneath.
  const featured = ordered.slice(0, 3);
  const rest = ordered.slice(3);

  return (
    <div className="-mt-6">
      <PageHero
        crumbs={[
          { label: "Accueil", href: "/" },
          { label: "Match-ups" },
        ]}
        badge={`${ordered.length} match-ups`}
        title="MATCH-UPS"
        subtitle="Toutes les confrontations champion contre champion vues dans le catalogue. Tri\u00e9es par fr\u00e9quence : les rivalit\u00e9s chaudes en haut."
        backgroundSrc="/images/hero-bg.jpg"
      />

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 space-y-12">
        {/* ─── Hot rivalries ─── */}
        {featured.length > 0 && (
          <section className="space-y-4">
            <header className="flex items-center gap-3">
              <span className="h-px flex-1 bg-[var(--border-gold)]" />
              <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
                Rivalités chaudes
              </span>
              <span className="h-px flex-1 bg-[var(--border-gold)]" />
            </header>

            <div className="grid gap-4 md:grid-cols-3">
              {featured.map((m) => (
                <FeaturedMatchupCard key={`${m.a}|${m.b}`} m={m} />
              ))}
            </div>
          </section>
        )}

        {/* ─── Full grid ─── */}
        {rest.length > 0 && (
          <section className="space-y-4">
            <header className="flex items-center gap-3">
              <span className="h-px flex-1 bg-[var(--border-gold)]" />
              <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
                Toutes les confrontations
              </span>
              <span className="h-px flex-1 bg-[var(--border-gold)]" />
            </header>

            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {rest.map((m) => (
                <MatchupCard key={`${m.a}|${m.b}`} m={m} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ─── Components ────────────────────────────────────────────────────────

function FeaturedMatchupCard({ m }: { m: MatchupStat }) {
  return (
    <Link
      href={`/matchup/${encodeURIComponent(m.a)}/vs/${encodeURIComponent(m.b)}`}
      className="group relative block overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all hover:border-[var(--gold)]/55 hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-[var(--gold)]/20"
    >
      {/* Split-portrait background using loading-art for both champs. */}
      <div className="relative aspect-[16/9] overflow-hidden">
        <div className="absolute inset-0 grid grid-cols-2">
          <div className="relative">
            <Image
              src={championLoadingUrl(m.a)}
              alt=""
              fill
              sizes="(max-width: 768px) 50vw, 16vw"
              className="object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[var(--bg-primary)]/85" />
          </div>
          <div className="relative">
            <Image
              src={championLoadingUrl(m.b)}
              alt=""
              fill
              sizes="(max-width: 768px) 50vw, 16vw"
              className="object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-l from-transparent to-[var(--bg-primary)]/85" />
          </div>
        </div>
        {/* Center "vs" badge */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-3xl md:text-4xl font-black text-white drop-shadow-[0_0_24px_rgba(200,170,110,0.6)]">
            VS
          </span>
        </div>
        {/* Bottom gradient for legibility */}
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[var(--bg-primary)] to-transparent" />
      </div>

      <div className="p-4 space-y-2">
        <p className="font-display text-lg md:text-xl font-black text-white truncate group-hover:text-[var(--gold)] transition-colors">
          {m.a} <span className="text-white/40">vs</span> {m.b}
        </p>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-data uppercase tracking-widest text-[var(--gold)]/85">
            {m.total} clip{m.total > 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-2 font-data tabular-nums">
            {m.kcWins > 0 && (
              <span className="text-[var(--green)]">+{m.kcWins}</span>
            )}
            {m.kcLosses > 0 && (
              <span className="text-[var(--red)]">-{m.kcLosses}</span>
            )}
            {m.topHighlight >= 8 && (
              <span className="rounded-md bg-[var(--gold)]/15 border border-[var(--gold)]/45 px-1.5 py-0.5 text-[10px] text-[var(--gold)]">
                {m.topHighlight.toFixed(1)}
              </span>
            )}
          </span>
        </div>
      </div>
    </Link>
  );
}

function MatchupCard({ m }: { m: MatchupStat }) {
  return (
    <Link
      href={`/matchup/${encodeURIComponent(m.a)}/vs/${encodeURIComponent(m.b)}`}
      className="group flex items-center gap-3 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3 transition-all hover:border-[var(--gold)]/55 hover:-translate-y-0.5"
    >
      <div className="relative h-12 w-12 rounded-xl overflow-hidden border border-[var(--gold)]/30 flex-shrink-0">
        <Image
          src={championIconUrl(m.a)}
          alt={m.a}
          fill
          sizes="48px"
          className="object-cover"
        />
      </div>
      <span className="text-[var(--gold)]/55 text-xl font-display">vs</span>
      <div className="relative h-12 w-12 rounded-xl overflow-hidden border border-[var(--gold)]/30 flex-shrink-0">
        <Image
          src={championIconUrl(m.b)}
          alt={m.b}
          fill
          sizes="48px"
          className="object-cover"
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-display text-sm font-bold text-white truncate group-hover:text-[var(--gold)] transition-colors">
          {m.a} <span className="text-white/35">vs</span> {m.b}
        </p>
        <p className="font-data text-[10px] uppercase tracking-widest text-white/50">
          {m.total} clip{m.total > 1 ? "s" : ""}
          {m.topHighlight >= 8 && (
            <span className="ml-2 text-[var(--gold)]">{m.topHighlight.toFixed(1)}</span>
          )}
        </p>
      </div>
    </Link>
  );
}
