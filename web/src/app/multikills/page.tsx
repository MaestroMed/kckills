import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { championIconUrl } from "@/lib/constants";
import { PageHero } from "@/components/ui/PageHero";
import { DiscoverMore } from "@/components/DiscoverMore";
import { getClipsFiltered, type FilteredClip } from "@/lib/supabase/clips";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Multi-kills",
  description:
    "Tous les multi-kills KC : pentas, quadras, triples, doubles. Le contenu le plus rare et le plus regard\u00e9 du catalogue.",
  alternates: { canonical: "/multikills" },
  openGraph: {
    title: "Multi-kills \u2014 KCKILLS",
    description: "Pentas, quadras, triples, doubles : tous les multi-kills KC.",
    type: "website",
  },
};

const RANK = { penta: 5, quadra: 4, triple: 3, double: 2 } as const;
type RankKey = keyof typeof RANK;

const TIER_VISUAL: Record<RankKey, {
  label: string;
  accent: string;
  glow: string;
  border: string;
  text: string;
  description: string;
  icon: string;
}> = {
  penta: {
    label: "PENTAKILL",
    accent: "var(--orange)",
    glow: "rgba(255,152,0,0.45)",
    border: "rgba(255,152,0,0.6)",
    text: "var(--orange)",
    description: "Le saint Graal du carry. 5 ennemis tomb\u00e9s sans respawn.",
    icon: "★★★★★",
  },
  quadra: {
    label: "QUADRAKILL",
    accent: "var(--gold)",
    glow: "rgba(200,170,110,0.4)",
    border: "rgba(200,170,110,0.55)",
    text: "var(--gold)",
    description: "4 kills d\u2019affil\u00e9e. Penta vol\u00e9 ou v\u00e9ritable show solo.",
    icon: "★★★★",
  },
  triple: {
    label: "TRIPLEKILL",
    accent: "var(--cyan)",
    glow: "rgba(10,200,185,0.4)",
    border: "rgba(10,200,185,0.5)",
    text: "var(--cyan)",
    description: "3 ennemis en une window. Le plus souvent : un teamfight bascul\u00e9.",
    icon: "★★★",
  },
  double: {
    label: "DOUBLEKILL",
    accent: "var(--green)",
    glow: "rgba(0,200,83,0.35)",
    border: "rgba(0,200,83,0.45)",
    text: "var(--green)",
    description: "2 kills back-to-back. Le minimum syndical du carry.",
    icon: "★★",
  },
};

export default async function MultiKillsPage() {
  // One RPC trip to pull every multi-kill (≥double), then bucket in JS.
  // Cheaper than 4 RPC calls and the data is small (the catalogue has ~50
  // multi-kills total, so the limit of 200 is comfortable headroom).
  const all = await getClipsFiltered({ multiKillMin: "double" }, 200);

  const buckets: Record<RankKey, FilteredClip[]> = {
    penta: [],
    quadra: [],
    triple: [],
    double: [],
  };
  for (const c of all) {
    const k = (c.multiKill as RankKey | null);
    if (k && k in RANK) buckets[k].push(c);
  }

  const totalMulti = all.length;
  const orderedTiers: RankKey[] = ["penta", "quadra", "triple", "double"];

  return (
    <div className="-mt-6">
      <PageHero
        crumbs={[
          { label: "Accueil", href: "/" },
          { label: "Multi-kills" },
        ]}
        badge={`${totalMulti} multi-kills`}
        title="MULTI-KILLS"
        subtitle="Le contenu le plus rare du catalogue. Pentas, quadras, triples, doubles, classés du plus prestigieux au plus fréquent."
        backgroundSrc="/images/hero-bg.jpg"
      />

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 space-y-6">
        {/* ─── Tier counts strip ─── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {orderedTiers.map((tier) => {
            const v = TIER_VISUAL[tier];
            const count = buckets[tier].length;
            return (
              <div
                key={tier}
                className="rounded-2xl border bg-[var(--bg-surface)] p-4 text-center transition-transform hover:-translate-y-0.5"
                style={{ borderColor: v.border }}
              >
                <p className="font-data text-[10px] uppercase tracking-[0.3em]" style={{ color: v.text }}>
                  {v.icon}
                </p>
                <p className="font-display text-3xl md:text-4xl font-black mt-1" style={{ color: v.accent, textShadow: `0 0 24px ${v.glow}` }}>
                  {count}
                </p>
                <p className="font-data text-[10px] uppercase tracking-widest text-white/65 mt-1">
                  {v.label}
                </p>
              </div>
            );
          })}
        </div>

        {totalMulti === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-gold)] bg-[var(--bg-surface)]/40 p-10 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              Aucun multi-kill n&apos;a encore été publié dans le catalogue. Reviens
              vite : le penta de la saison arrive.
            </p>
          </div>
        ) : (
          <div className="space-y-12">
            {orderedTiers.map((tier) => {
              const clips = buckets[tier];
              if (clips.length === 0) return null;
              return <TierSection key={tier} tier={tier} clips={clips} />;
            })}
          </div>
        )}

        <DiscoverMore excludeHrefs={["/multikills"]} />
      </div>
    </div>
  );
}

// ─── Tier section ──────────────────────────────────────────────────────

function TierSection({ tier, clips }: { tier: RankKey; clips: FilteredClip[] }) {
  const v = TIER_VISUAL[tier];
  const isHero = tier === "penta" || tier === "quadra";

  return (
    <section className="space-y-5">
      <header className="flex items-center gap-4">
        <span className="h-px flex-1" style={{ backgroundColor: v.border }} />
        <div className="text-center">
          <p
            className="font-display text-2xl md:text-3xl font-black tracking-wider"
            style={{ color: v.accent, textShadow: `0 0 24px ${v.glow}` }}
          >
            {v.label}
          </p>
          <p className="font-data text-[10px] uppercase tracking-widest text-white/55 mt-1">
            {clips.length} clip{clips.length > 1 ? "s" : ""} · {v.description}
          </p>
        </div>
        <span className="h-px flex-1" style={{ backgroundColor: v.border }} />
      </header>

      <div
        className={
          isHero
            ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            : "grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
        }
      >
        {clips.map((c) => (
          <MultiKillCard key={c.id} clip={c} tier={tier} />
        ))}
      </div>
    </section>
  );
}

function MultiKillCard({ clip, tier }: { clip: FilteredClip; tier: RankKey }) {
  const v = TIER_VISUAL[tier];
  const isKcKill = clip.trackedTeamInvolvement === "team_killer";

  return (
    <Link
      href={`/kill/${clip.id}`}
      className="group relative block overflow-hidden rounded-2xl border bg-black transition-all hover:-translate-y-0.5"
      style={{
        borderColor: v.border,
        boxShadow: tier === "penta" ? `0 0 40px ${v.glow}` : undefined,
        aspectRatio: "9/16",
      }}
    >
      {clip.thumbnailUrl ? (
        <Image
          src={clip.thumbnailUrl}
          alt={`${clip.killerChampion ?? "?"} ${v.label} on ${clip.victimChampion ?? "?"}`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 33vw, 25vw"
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />

      {/* Tier crown */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-start justify-between gap-2">
        <span
          className="rounded-md border px-2.5 py-1 font-data text-[10px] font-black tracking-[0.18em]"
          style={{
            color: v.text,
            backgroundColor: `${v.accent}20`,
            borderColor: v.border,
          }}
        >
          {v.icon} {v.label}
        </span>
        {clip.highlightScore != null && (
          <span className="rounded-md bg-black/60 backdrop-blur-sm border border-[var(--gold)]/30 px-2 py-0.5 text-[10px] font-data font-bold text-[var(--gold)]">
            {clip.highlightScore.toFixed(1)}
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
          <span className={isKcKill ? "text-[var(--gold)]" : "text-[var(--red)]"}>
            {isKcKill ? "KC" : "vs KC"}
          </span>
          {clip.opponentCode ? ` · vs ${clip.opponentCode}` : ""}
          {clip.gameNumber ? ` · G${clip.gameNumber}` : ""}
        </p>
      </div>

      {/* Hover play button */}
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      >
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full backdrop-blur-md border-2 shadow-lg"
          style={{
            backgroundColor: `${v.accent}25`,
            borderColor: v.border,
            boxShadow: `0 0 30px ${v.glow}`,
          }}
        >
          <svg className="h-5 w-5 translate-x-0.5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>
    </Link>
  );
}
