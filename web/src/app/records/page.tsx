import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getPublishedKills, type PublishedKillRow } from "@/lib/supabase/kills";
import { championIconUrl } from "@/lib/constants";
import { isDescriptionClean } from "@/lib/scroll/sanitize-description";
import { Breadcrumb } from "@/components/Breadcrumb";
import { JsonLd, breadcrumbLD, recordsCollectionLD } from "@/lib/seo/jsonld";
import { Description } from "@/components/i18n/Description";

/**
 * /records — "Records Absolus" hall-of-fame.
 *
 * Replaces the old stub redirect with an editorial view of the catalog's
 * top performers across 6 curated categories. Each category surfaces its
 * top 3 clips; a "voir tout" chip deep-links into /clips with the right
 * sort/filter params so the user can go deeper.
 *
 * Server component — data pulled once via `getPublishedKills(500)` which
 * is cached() across the session, so this page adds zero egress when
 * another SSR on the same user hit the cache within 30s.
 *
 * Categories:
 *   🏆 Score IA absolu          (all-time top highlight_score)
 *   💥 Pentakills & quadras     (multi_kill == penta / quadra)
 *   ⚡ First bloods             (is_first_blood = true)
 *   🎯 1v3+ outplays            (ai_tags contains "1v3" / "1v2" / "clutch")
 *   🔥 Teamfight highlights     (fight_type = teamfight_5v5)
 *   🎪 Snipes longue distance   (ai_tags contains "snipe" / "flash_predict")
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Records Absolus — KCKILLS",
  description:
    "Hall of fame des plus gros moments Karmine Corp en LEC : pentakills, outplays, teamfights, clutch, first bloods. Le best-of absolu.",
  alternates: { canonical: "/records" },
  openGraph: {
    title: "Records Absolus — KCKILLS",
    description:
      "Le best-of absolu Karmine Corp : pentakills, outplays, teamfights, clutch.",
    type: "website",
    siteName: "KCKILLS",
    locale: "fr_FR",
    url: "/records",
  },
  twitter: {
    card: "summary_large_image",
    title: "Records Absolus — KCKILLS",
    description: "Le best-of absolu Karmine Corp.",
  },
};

interface Category {
  title: string;
  kicker: string;
  icon: string;
  accent: string;
  /** Filter predicate applied over getPublishedKills(500). */
  filter: (k: PublishedKillRow) => boolean;
  /** Sort — default is highlight_score desc. */
  sort?: (a: PublishedKillRow, b: PublishedKillRow) => number;
  /** Where the "voir tout" chip links. */
  allHref: string;
}

const hasTag = (k: PublishedKillRow, ...tags: string[]): boolean =>
  (k.ai_tags ?? []).some((t) => tags.includes(t));

const CATEGORIES: Category[] = [
  {
    title: "Score IA absolu",
    kicker: "🏆 Les plus gros moments",
    icon: "🏆",
    accent: "var(--gold)",
    filter: (k) =>
      k.tracked_team_involvement === "team_killer" && (k.highlight_score ?? 0) >= 7,
    allHref: "/clips?sort=score",
  },
  {
    title: "Pentakills & quadras",
    kicker: "💥 Multi-kills historiques",
    icon: "💥",
    accent: "var(--orange)",
    filter: (k) =>
      k.tracked_team_involvement === "team_killer" &&
      (k.multi_kill === "penta" || k.multi_kill === "quadra"),
    allHref: "/clips?multi=1&sort=score",
  },
  {
    title: "First bloods",
    kicker: "⚡ Le premier sang",
    icon: "⚡",
    accent: "var(--red)",
    filter: (k) =>
      k.tracked_team_involvement === "team_killer" && k.is_first_blood === true,
    allHref: "/clips?fb=1&sort=score",
  },
  {
    title: "1v3 & clutch",
    kicker: "🎯 Outplays solo",
    icon: "🎯",
    accent: "var(--cyan)",
    filter: (k) =>
      k.tracked_team_involvement === "team_killer" &&
      hasTag(k, "1v2", "1v3", "clutch", "outplay"),
    allHref: "/clips?sort=score",
  },
  {
    title: "Teamfights",
    kicker: "🔥 Gros combats",
    icon: "🔥",
    accent: "var(--green)",
    filter: (k) =>
      k.tracked_team_involvement === "team_killer" &&
      (k.fight_type === "teamfight_5v5" || k.fight_type === "teamfight_4v4"),
    allHref: "/clips?fight=teamfight_5v5&sort=score",
  },
  {
    title: "Snipes & skillshots",
    kicker: "🎪 Précision chirurgicale",
    icon: "🎪",
    accent: "var(--gold)",
    filter: (k) =>
      k.tracked_team_involvement === "team_killer" &&
      hasTag(k, "snipe", "flash_predict", "mechanical"),
    allHref: "/clips?sort=score",
  },
];

const PER_CATEGORY = 3;

export default async function RecordsPage() {
  const all = await getPublishedKills(500);
  const scored = all.filter((k) => k.kill_visible !== false);

  const categories = CATEGORIES.map((cat) => {
    const rows = scored.filter(cat.filter);
    rows.sort(
      cat.sort ?? ((a, b) => (b.highlight_score ?? 0) - (a.highlight_score ?? 0)),
    );
    return { cat, rows: rows.slice(0, PER_CATEGORY) };
  }).filter((c) => c.rows.length > 0);

  // JSON-LD — CollectionPage aggregating the 6 sub-lists helps Google
  // understand this is a curated hall-of-fame rather than a random grid.
  // Two payloads :
  //   1. recordsCollectionLD : describes the 6 categories as nested lists
  //   2. breadcrumbLD : Accueil > Records Absolus
  const collectionLD = recordsCollectionLD({
    categories: categories.map(({ cat, rows }) => ({
      name: cat.title,
      href: cat.allHref,
      count: rows.length,
    })),
  });
  const crumbLD = breadcrumbLD([
    { name: "Accueil", url: "/" },
    { name: "Records Absolus", url: "/records" },
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
      <JsonLd data={collectionLD} />
      <JsonLd data={crumbLD} />

      {/* Breadcrumb — discreet top-left overlay */}
      <div className="relative z-20 max-w-7xl mx-auto px-6 pt-6">
        <Breadcrumb
          items={[
            { label: "Accueil", href: "/" },
            { label: "Records Absolus" },
          ]}
        />
      </div>

      {/* ─── HERO ──────────────────────────────────────────────────── */}
      <section className="relative py-16 px-6 md:py-24 bg-gradient-to-b from-[var(--bg-primary)] via-[var(--bg-surface)] to-[var(--bg-primary)] overflow-hidden">
        {/* Subtle gold radial */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(200,170,110,0.15) 0%, transparent 60%)",
          }}
        />

        <div className="relative max-w-5xl mx-auto text-center">
          <p className="font-data text-[10px] uppercase tracking-[0.35em] text-[var(--gold)]/70 mb-4">
            ★ Hall of Fame
          </p>
          <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-black leading-none">
            <span className="text-shimmer">RECORDS</span>
            <br />
            <span className="text-white">ABSOLUS</span>
          </h1>
          <p className="mt-6 max-w-2xl mx-auto text-base md:text-lg text-white/70 leading-relaxed">
            Les plus gros moments de la Karmine Corp en LEC. Classés par catégorie.
            Score IA · Multi-kills · First bloods · Clutch plays.
          </p>

          {/* Category quick-nav */}
          <nav className="mt-10 flex flex-wrap gap-2 justify-center">
            {categories.map(({ cat }) => (
              <a
                key={cat.title}
                href={`#cat-${cat.title.toLowerCase().replace(/\s+/g, "-")}`}
                className="group rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)]/70 backdrop-blur-sm px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white/70 hover:border-[var(--gold)]/60 hover:text-[var(--gold)] transition-all"
              >
                <span className="mr-1.5">{cat.icon}</span>
                {cat.title}
              </a>
            ))}
          </nav>

          {/* Weekly recap cross-link — "records absolus" is all-time, but
              users looking for "what's new" need the 7-day window. */}
          <div className="mt-6">
            <Link
              href="/week"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--cyan)]/30 bg-[var(--cyan)]/5 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[var(--cyan)] hover:bg-[var(--cyan)]/15 transition-all"
            >
              <span>▽ Voir cette semaine</span>
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ─── CATEGORIES ────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-12 space-y-16">
        {categories.map(({ cat, rows }) => (
          <section
            key={cat.title}
            id={`cat-${cat.title.toLowerCase().replace(/\s+/g, "-")}`}
            className="scroll-mt-24"
          >
            <header className="flex items-end justify-between gap-4 mb-6 flex-wrap">
              <div>
                <p
                  className="font-data text-[10px] uppercase tracking-[0.3em] font-bold mb-1.5"
                  style={{ color: cat.accent }}
                >
                  {cat.kicker}
                </p>
                <h2 className="font-display text-3xl md:text-4xl font-black text-white">
                  {cat.title}
                </h2>
              </div>
              <Link
                href={cat.allHref}
                className="rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)] px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:border-[var(--gold)]/60 hover:text-[var(--gold)] transition-all"
              >
                Voir tout &rarr;
              </Link>
            </header>

            <div className="grid gap-4 md:grid-cols-3">
              {rows.map((k, i) => (
                <RecordCard key={k.id} kill={k} rank={i + 1} accent={cat.accent} />
              ))}
            </div>
          </section>
        ))}

        {categories.length === 0 && (
          <section className="text-center py-20">
            <p className="text-sm text-[var(--text-muted)]">
              Pas encore assez de clips analysés pour remplir le hall of fame.
              Le pipeline automatique tourne — reviens dans quelques heures.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────

function RecordCard({
  kill,
  rank,
  accent,
}: {
  kill: PublishedKillRow;
  rank: number;
  accent: string;
}) {
  return (
    <Link
      href={`/scroll?kill=${kill.id}`}
      className="group relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all hover:border-[var(--gold)]/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-[var(--gold)]/10"
      style={{ aspectRatio: "9/16" }}
    >
      {kill.thumbnail_url && (
        <Image
          src={kill.thumbnail_url}
          alt={`${kill.killer_champion} → ${kill.victim_champion}`}
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
      )}

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/70" />

      {/* Rank medal */}
      <div className="absolute top-3 left-3 z-10">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full font-display text-lg font-black"
          style={{
            background:
              rank === 1
                ? "linear-gradient(135deg, #FFD700, #FFA500)"
                : rank === 2
                  ? "linear-gradient(135deg, #C0C0C0, #909090)"
                  : "linear-gradient(135deg, #CD7F32, #8B4513)",
            color: "black",
            boxShadow:
              rank === 1
                ? "0 0 30px rgba(255,215,0,0.5)"
                : rank === 2
                  ? "0 0 20px rgba(192,192,192,0.4)"
                  : "0 0 20px rgba(205,127,50,0.4)",
          }}
        >
          #{rank}
        </div>
      </div>

      {/* Score pill top right */}
      {kill.highlight_score !== null && (
        <div
          className="absolute top-3 right-3 rounded-md border px-2 py-0.5 text-[10px] font-data font-black backdrop-blur-sm z-10"
          style={{
            borderColor: `${accent}66`,
            color: accent,
            background: "rgba(0,0,0,0.6)",
          }}
        >
          {kill.highlight_score.toFixed(1)}/10
        </div>
      )}

      {/* Badges */}
      <div className="absolute top-14 left-3 z-10 flex flex-col gap-1">
        {kill.multi_kill && (
          <span className="rounded-md bg-[var(--orange)]/90 px-1.5 py-0.5 text-[9px] font-black uppercase text-black">
            ⚡ {kill.multi_kill}
          </span>
        )}
        {kill.is_first_blood && (
          <span className="rounded-md bg-[var(--red)]/90 px-1.5 py-0.5 text-[9px] font-black uppercase text-white">
            FB
          </span>
        )}
      </div>

      {/* Bottom — champions + description */}
      <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Image
            src={championIconUrl(kill.killer_champion ?? "Aatrox")}
            alt={kill.killer_champion ?? ""}
            width={24}
            height={24}
            className="rounded-full border border-[var(--gold)]/60"
          />
          <span className="text-[var(--gold)] text-sm">&rarr;</span>
          <Image
            src={championIconUrl(kill.victim_champion ?? "Aatrox")}
            alt={kill.victim_champion ?? ""}
            width={20}
            height={20}
            className="rounded-full border border-white/20 opacity-70"
          />
        </div>

        {isDescriptionClean(kill.ai_description) && (
          <Description
            kill={kill}
            as="p"
            quoted
            className="text-[11px] text-white/80 italic line-clamp-2 leading-tight"
          />
        )}
      </div>

      {/* Hover play icon */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none z-10">
        <div className="h-14 w-14 rounded-full bg-[var(--gold)]/30 backdrop-blur-md border border-[var(--gold)]/60 flex items-center justify-center">
          <svg
            className="h-5 w-5 text-[var(--gold)] translate-x-0.5"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
