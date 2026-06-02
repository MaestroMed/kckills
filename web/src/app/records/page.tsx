import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import {
  Trophy,
  Swords,
  Droplet,
  Crosshair,
  Flame,
  Target,
  ChevronRight,
  CalendarDays,
  Zap,
  Play,
  type LucideIcon,
} from "lucide-react";
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
 * Categories (Wave 36 — OS emoji marks swapped for lucide hextech icons):
 *   Trophy    Score IA absolu      (all-time top highlight_score)
 *   Swords    Pentakills & quadras (multi_kill == penta / quadra)
 *   Droplet   First bloods         (is_first_blood = true)
 *   Crosshair 1v3+ outplays        (ai_tags contains "1v3" / "1v2" / "clutch")
 *   Flame     Teamfight highlights (fight_type = teamfight_5v5)
 *   Target    Snipes longue dist.  (ai_tags contains "snipe" / "flash_predict")
 */

export const revalidate = 3600; // Wave 13d : records change rarely

export const metadata: Metadata = {
  title: "Records Absolus",
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
  /** lucide-react icon used as the category's primary hextech mark. */
  Icon: LucideIcon;
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
    kicker: "Les plus gros moments",
    Icon: Trophy,
    accent: "var(--gold)",
    filter: (k) =>
      k.tracked_team_involvement === "team_killer" && (k.highlight_score ?? 0) >= 7,
    allHref: "/clips?sort=score",
  },
  {
    title: "Pentakills & quadras",
    kicker: "Multi-kills historiques",
    Icon: Swords,
    accent: "var(--orange)",
    filter: (k) =>
      k.tracked_team_involvement === "team_killer" &&
      (k.multi_kill === "penta" || k.multi_kill === "quadra"),
    allHref: "/clips?multi=1&sort=score",
  },
  {
    title: "First bloods",
    kicker: "Le premier sang",
    Icon: Droplet,
    accent: "var(--red)",
    filter: (k) =>
      k.tracked_team_involvement === "team_killer" && k.is_first_blood === true,
    allHref: "/clips?fb=1&sort=score",
  },
  {
    title: "1v3 & clutch",
    kicker: "Outplays solo",
    Icon: Crosshair,
    accent: "var(--cyan)",
    filter: (k) =>
      k.tracked_team_involvement === "team_killer" &&
      hasTag(k, "1v2", "1v3", "clutch", "outplay"),
    allHref: "/clips?sort=score",
  },
  {
    title: "Teamfights",
    kicker: "Gros combats",
    Icon: Flame,
    accent: "var(--green)",
    filter: (k) =>
      k.tracked_team_involvement === "team_killer" &&
      (k.fight_type === "teamfight_5v5" || k.fight_type === "teamfight_4v4"),
    allHref: "/clips?fight=teamfight_5v5&sort=score",
  },
  {
    title: "Snipes & skillshots",
    kicker: "Précision chirurgicale",
    Icon: Target,
    accent: "var(--gold)",
    filter: (k) =>
      k.tracked_team_involvement === "team_killer" &&
      hasTag(k, "snipe", "flash_predict", "mechanical"),
    allHref: "/clips?sort=score",
  },
];

const PER_CATEGORY = 3;

export default async function RecordsPage() {
  // Wave 34 T2.2 — kept at 500 (with justification).
  // This page aggregates 6 hall-of-fame categories across ALL-TIME KC
  // history. Some are rare (pentakills/quadras, snipes) and need the
  // wider pool to surface even 3 entries. With ~1650 published rows in
  // DB, 500 caps the egress at ~1MB per cache miss while still pulling
  // the full top-by-highlight_score slice. Revalidate=3600 keeps this
  // pre-rendered for 99%+ of traffic, so the egress hit is amortised
  // across thousands of pageviews.
  const all = await getPublishedKills(500, { buildTime: true });
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
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(200,170,110,0.15) 0%, transparent 60%)",
          }}
        />
        {/* Faint hextech scanlines — matches /players + /vs heroes */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.14] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.08) 3px, transparent 4px)",
          }}
        />
        {/* Floating gold rhombus accents */}
        <span
          aria-hidden
          className="absolute left-[6%] top-12 hidden md:block"
          style={{
            width: 14,
            height: 14,
            transform: "rotate(45deg)",
            background: "linear-gradient(135deg, var(--gold), var(--gold-dark))",
            opacity: 0.55,
            boxShadow: "0 0 22px rgba(200,170,110,0.5)",
          }}
        />
        <span
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

        <div className="relative max-w-5xl mx-auto text-center">
          <p className="font-data text-[10px] uppercase tracking-[0.35em] text-[var(--gold)]/70 mb-4 flex items-center justify-center gap-2.5">
            <Losange />
            Hall of Fame
          </p>
          <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-black leading-none">
            <span className="text-shimmer">RECORDS</span>
            <br />
            <span className="text-white">ABSOLUS</span>
          </h1>
          <p className="mt-6 max-w-2xl mx-auto text-base md:text-lg text-[var(--text-muted)] leading-relaxed">
            Les plus gros moments de la Karmine Corp en LEC. Classés par catégorie.
            Score IA · Multi-kills · First bloods · Clutch plays.
          </p>

          {/* Category quick-nav */}
          <nav className="mt-10 flex flex-wrap gap-2 justify-center">
            {categories.map(({ cat }) => (
              <a
                key={cat.title}
                href={`#cat-${cat.title.toLowerCase().replace(/\s+/g, "-")}`}
                className="group inline-flex items-center gap-1.5 rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)]/70 backdrop-blur-sm px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white/70 hover:border-[var(--gold)]/60 hover:text-[var(--gold)] transition-all"
              >
                <cat.Icon
                  className="h-3.5 w-3.5"
                  style={{ color: cat.accent }}
                  strokeWidth={2.25}
                  aria-hidden
                />
                {cat.title}
              </a>
            ))}
          </nav>

          {/* Weekly recap cross-link — "records absolus" is all-time, but
              users looking for "what's new" need the 7-day window. */}
          <div className="mt-6">
            <Link
              href="/week"
              className="group inline-flex items-center gap-2 rounded-full border border-[var(--cyan)]/30 bg-[var(--cyan)]/5 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[var(--cyan)] hover:bg-[var(--cyan)]/15 transition-all"
            >
              <CalendarDays className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
              <span>Voir cette semaine</span>
              <ChevronRight
                className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                strokeWidth={3}
                aria-hidden
              />
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
            <header className="mb-6">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <p
                    className="font-data text-[10px] uppercase tracking-[0.3em] font-bold mb-2 flex items-center gap-2"
                    style={{ color: cat.accent }}
                  >
                    <cat.Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
                    {cat.kicker}
                  </p>
                  <h2 className="font-display text-3xl md:text-4xl font-black text-white">
                    {cat.title}
                  </h2>
                </div>
                <Link
                  href={cat.allHref}
                  className="group inline-flex items-center gap-1.5 rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)] px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:border-[var(--gold)]/60 hover:text-[var(--gold)] transition-all"
                >
                  Voir tout
                  <ChevronRight
                    className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                    strokeWidth={3}
                    aria-hidden
                  />
                </Link>
              </div>
              {/* Hextech divider */}
              <div className="gold-line mt-4" aria-hidden />
            </header>

            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
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
      className="group glass relative overflow-hidden rounded-2xl border border-[var(--border-gold)] transition-all duration-300 hover:border-[var(--gold)]/60 hover:-translate-y-1 hover:gold-glow aspect-[3/4]"
    >
      {kill.thumbnail_url && (
        <Image
          src={kill.thumbnail_url}
          alt={`${kill.killer_champion ?? "?"} élimine ${kill.victim_champion ?? "?"}`}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
      )}

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/70" />

      {/* Rank badge — hextech gold frame for #1, slim dark chip otherwise */}
      <div className="absolute top-2.5 left-2.5 z-10">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg font-display text-base font-black backdrop-blur-sm"
          style={{
            color: rank === 1 ? "var(--bg-primary)" : "var(--gold-bright)",
            background:
              rank === 1
                ? "linear-gradient(135deg, var(--gold-bright), var(--gold) 55%, var(--gold-dark))"
                : "rgba(1,10,19,0.62)",
            border:
              rank === 1
                ? "1px solid var(--gold-bright)"
                : "1px solid var(--border-gold)",
            boxShadow:
              rank === 1
                ? "0 0 24px rgba(240,230,210,0.45)"
                : "0 6px 16px rgba(0,0,0,0.4)",
          }}
        >
          {rank}
        </div>
      </div>

      {/* Score pill top right */}
      {kill.highlight_score !== null && (
        <div
          className="absolute top-2.5 right-2.5 rounded-md border px-2 py-0.5 text-[10px] font-data font-black backdrop-blur-sm z-10"
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
      <div className="absolute top-[3.25rem] left-2.5 z-10 flex flex-col gap-1">
        {kill.multi_kill && (
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--orange)]/90 px-1.5 py-0.5 text-[9px] font-black uppercase text-black">
            <Zap className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
            {kill.multi_kill}
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
          <Play
            className="h-5 w-5 translate-x-0.5 text-[var(--gold)] fill-[var(--gold)]"
            strokeWidth={1.5}
            aria-hidden
          />
        </div>
      </div>

      {/* Single corner losange — bottom-right stays clear of the rank badge
          (top-left), score pill (top-right) and left-aligned info panel. */}
      <CornerLosange position="br" />
    </Link>
  );
}

// ─── Hextech ornaments ─────────────────────────────────────────────────

/** Small rotated-square gold accent — the Losange that precedes eyebrows. */
function Losange() {
  return (
    <span
      aria-hidden
      className="inline-block"
      style={{
        width: 11,
        height: 11,
        transform: "rotate(45deg)",
        background: "linear-gradient(135deg, var(--gold-bright), var(--gold))",
        boxShadow: "0 0 12px rgba(200,170,110,0.5)",
      }}
    />
  );
}

/** Corner accent losange — copied from the VSRoulette card pattern. */
function CornerLosange({
  position,
}: {
  position: "tl" | "tr" | "bl" | "br";
}) {
  const map: Record<string, string> = {
    tl: "top-2 left-2",
    tr: "top-2 right-2",
    bl: "bottom-2 left-2",
    br: "bottom-2 right-2",
  };
  return (
    <span
      aria-hidden
      className={`absolute ${map[position]} z-10`}
      style={{
        width: 8,
        height: 8,
        transform: "rotate(45deg)",
        background: "linear-gradient(135deg, var(--gold-bright), var(--gold))",
        boxShadow: "0 0 10px rgba(200,170,110,0.6)",
      }}
    />
  );
}
