import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { championIconUrl } from "@/lib/constants";
import { PageHero } from "@/components/ui/PageHero";
import { DiscoverMore } from "@/components/DiscoverMore";
import { getClipsFiltered, type FilteredClip } from "@/lib/supabase/clips";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "First Bloods",
  description:
    "Tous les first bloods Karmine Corp en LEC. Le sang qui change le tempo : qui ouvre, qui se fait piquer, et \u00e0 quelle minute.",
  alternates: { canonical: "/first-bloods" },
  openGraph: {
    title: "First Bloods \u2014 KCKILLS",
    description: "Tous les first bloods KC en LEC.",
    type: "website",
  },
};

const TIME_BUCKETS = ["0-5", "5-10", "10-15", "15-20", "20-25", "25-30", "30-35", "35+"] as const;
type TimeBucket = (typeof TIME_BUCKETS)[number];

export default async function FirstBloodsPage() {
  // First bloods are scarce by definition — one per game max — so 200 is
  // more than enough headroom for the entire backlog.
  const clips = await getClipsFiltered({ isFirstBlood: true }, 200);

  // Split by side: KC drew first blood (good) vs KC bled first (bad).
  const kcDrew = clips.filter((c) => c.trackedTeamInvolvement === "team_killer");
  const kcBled = clips.filter((c) => c.trackedTeamInvolvement === "team_victim");

  // Bucket by minute for the time-of-tempo distribution chart.
  const byBucket = new Map<TimeBucket, number>();
  let withBucket = 0;
  for (const c of clips) {
    const b = c.minuteBucket as TimeBucket | null;
    if (b && TIME_BUCKETS.includes(b)) {
      byBucket.set(b, (byBucket.get(b) ?? 0) + 1);
      withBucket += 1;
    }
  }
  const maxBucket = Math.max(1, ...byBucket.values());

  // Find the earliest first blood — the most savage tempo grab.
  const earliest = clips
    .filter((c) => c.gameTimeSeconds > 0)
    .sort((a, b) => a.gameTimeSeconds - b.gameTimeSeconds)[0];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "First Bloods Karmine Corp",
    description:
      "Tous les first bloods Karmine Corp en LEC. Le sang qui change le tempo : qui ouvre, qui se fait piquer, et à quelle minute.",
    inLanguage: "fr-FR",
    url: "https://kckills.com/first-bloods",
    isPartOf: { "@type": "WebSite", name: "KCKILLS", url: "https://kckills.com" },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: clips.length,
      itemListElement: clips.slice(0, 20).map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `https://kckills.com/kill/${c.id}`,
      })),
    },
  };

  return (
    <div className="-mt-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PageHero
        crumbs={[
          { label: "Accueil", href: "/" },
          { label: "First Bloods" },
        ]}
        badge={`${clips.length} first bloods`}
        title="FIRST BLOODS"
        subtitle="Le premier sang change le tempo. Qui ouvre la game, qui se fait piquer, et à quelle minute le couteau sort."
        backgroundSrc="/images/hero-bg.jpg"
      />

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 space-y-12">
        {/* ─── Quick stats ─── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="KC ouvre" value={kcDrew.length} accent="var(--green)" />
          <StatTile label="KC se fait piquer" value={kcBled.length} accent="var(--red)" />
          <StatTile
            label="Plus rapide"
            value={earliest ? formatGameTime(earliest.gameTimeSeconds) : "—"}
            accent="var(--orange)"
          />
          <StatTile
            label="Win rate ouvert"
            value={
              clips.length > 0
                ? `${Math.round((kcDrew.length / clips.length) * 100)}%`
                : "—"
            }
            accent="var(--gold)"
          />
        </div>

        {/* ─── Time-of-FB distribution ─── */}
        {withBucket > 0 && (
          <section className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-3">
            <header className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-base font-bold text-[var(--text-primary)]">
                Distribution dans le temps
              </h2>
              <span className="text-[10px] font-data uppercase tracking-widest text-white/45">
                {withBucket} clips taggés
              </span>
            </header>
            <ul className="space-y-2">
              {TIME_BUCKETS.map((b) => {
                const count = byBucket.get(b) ?? 0;
                if (count === 0) return null;
                const pct = (count / maxBucket) * 100;
                return (
                  <li key={b} className="flex items-center gap-3 text-xs">
                    <span className="w-12 font-data text-white/65 tabular-nums">{b}</span>
                    <div className="flex-1 h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: "var(--red)",
                          boxShadow: "0 0 8px rgba(232,64,87,0.4)",
                        }}
                      />
                    </div>
                    <span className="w-10 text-right font-data tabular-nums text-white/65">
                      {count}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ─── KC drew first blood ─── */}
        {kcDrew.length > 0 && (
          <FBSection
            title="KC ouvre la game"
            subtitle="KC dégaine en premier — le tempo s'installe."
            accent="var(--green)"
            clips={kcDrew}
          />
        )}

        {/* ─── KC bled first ─── */}
        {kcBled.length > 0 && (
          <FBSection
            title="KC se fait piquer"
            subtitle="L'adversaire ouvre — KC doit revenir."
            accent="var(--red)"
            clips={kcBled}
          />
        )}

        {clips.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--border-gold)] bg-[var(--bg-surface)]/40 p-10 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              Aucun first blood n&apos;a encore été tagué dans le catalogue.
            </p>
          </div>
        )}

        <DiscoverMore excludeHrefs={["/first-bloods"]} />
      </div>
    </div>
  );
}

// ─── Components ────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-center">
      <p
        className="font-display text-3xl md:text-4xl font-black tabular-nums"
        style={{ color: accent, textShadow: `0 0 24px ${accent}33` }}
      >
        {value}
      </p>
      <p className="mt-1 text-[10px] font-data uppercase tracking-widest text-white/55">{label}</p>
    </div>
  );
}

function FBSection({
  title,
  subtitle,
  accent,
  clips,
}: {
  title: string;
  subtitle: string;
  accent: string;
  clips: FilteredClip[];
}) {
  return (
    <section className="space-y-4">
      <header className="flex items-center gap-3">
        <span className="h-px flex-1" style={{ backgroundColor: `${accent}55` }} />
        <div className="text-center">
          <p className="font-display text-xl md:text-2xl font-black" style={{ color: accent }}>
            {title}
          </p>
          <p className="font-data text-[10px] uppercase tracking-widest text-white/55 mt-1">
            {clips.length} clip{clips.length > 1 ? "s" : ""} · {subtitle}
          </p>
        </div>
        <span className="h-px flex-1" style={{ backgroundColor: `${accent}55` }} />
      </header>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {clips.map((c) => (
          <FBCard key={c.id} clip={c} accent={accent} />
        ))}
      </div>
    </section>
  );
}

function FBCard({ clip, accent }: { clip: FilteredClip; accent: string }) {
  return (
    <Link
      href={`/kill/${clip.id}`}
      className="group relative block overflow-hidden rounded-2xl border bg-black transition-all hover:-translate-y-0.5"
      style={{ borderColor: `${accent}55`, aspectRatio: "9/16" }}
    >
      {clip.thumbnailUrl ? (
        <Image
          src={clip.thumbnailUrl}
          alt={`First Blood: ${clip.killerChampion ?? "?"} → ${clip.victimChampion ?? "?"}`}
          fill
          sizes="(max-width: 640px) 100vw, 25vw"
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />

      {/* FB badge crown */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-start justify-between gap-2">
        <span
          className="rounded-md border px-2.5 py-1 font-data text-[10px] font-black tracking-[0.18em]"
          style={{ color: accent, borderColor: `${accent}80`, backgroundColor: `${accent}25` }}
        >
          FIRST BLOOD
        </span>
        {clip.gameTimeSeconds > 0 && (
          <span className="rounded-md bg-black/60 backdrop-blur-sm border border-white/20 px-2 py-0.5 text-[10px] font-data font-bold text-white/85">
            T+{formatGameTime(clip.gameTimeSeconds)}
          </span>
        )}
      </div>

      {/* Bottom: matchup + meta */}
      <div className="absolute inset-x-3 bottom-3 z-10 space-y-2">
        <div className="flex items-center gap-2">
          {clip.killerChampion && (
            <div className="relative h-8 w-8 rounded-md overflow-hidden border border-[var(--gold)]/40 flex-shrink-0">
              <Image
                src={championIconUrl(clip.killerChampion)}
                alt={clip.killerChampion}
                fill
                sizes="32px"
                className="object-cover"
              />
            </div>
          )}
          <p className="font-display font-black text-white leading-tight text-sm flex-1 min-w-0 truncate">
            {clip.killerName ?? clip.killerChampion ?? "?"}
          </p>
        </div>
        {clip.aiDescription && (
          <p className="text-[11px] text-white/75 italic line-clamp-2">
            « {clip.aiDescription} »
          </p>
        )}
        <p className="text-[10px] font-data uppercase tracking-wider text-white/55">
          {clip.killerChampion} → {clip.victimChampion}
          {clip.opponentCode ? ` · vs ${clip.opponentCode}` : ""}
        </p>
      </div>

      {/* Hover play */}
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      >
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full backdrop-blur-md border-2 shadow-lg"
          style={{ backgroundColor: `${accent}25`, borderColor: `${accent}80` }}
        >
          <svg className="h-5 w-5 translate-x-0.5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>
    </Link>
  );
}

function formatGameTime(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
