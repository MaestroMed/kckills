import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ClipReel } from "@/components/ClipReel";
import { ClipCard } from "@/components/tcg/ClipCard";
import { PageHero } from "@/components/ui/PageHero";
import { getPublishedKills, type PublishedKillRow } from "@/lib/supabase/kills";

export const revalidate = 300; // 5 min — best of needs to feel live

export const metadata: Metadata = {
  title: "Meilleurs Clips KC",
  description:
    "Les highlights les mieux notes par l'algo + la communaute. Pentakills, baron steals, outplays 1v3, comebacks legendaires Karmine Corp.",
  alternates: { canonical: "/best" },
  openGraph: {
    title: "Meilleurs Clips Karmine Corp \u2014 KCKILLS",
    description:
      "La selection curatee : score IA + rating communaute + multi-kills + first bloods.",
    type: "website",
  },
};

/**
 * /best — la page "Meilleurs Clips" pour la home tile + le hero browse.
 *
 * Curation 100 % donnees : on combine highlight_score (Gemini) + avg_rating
 * (communaute) + un boost multi-kill / first blood / shutdown. Pas de tag
 * humain a maintenir, pas de hand-curation a faire vivre — la qualite
 * monte naturellement quand le tagging Phase 1 s'enrichit.
 *
 * Trois sections :
 *   1. Hall of Fame — les 12 clips au score composite le plus haut
 *   2. Pentakills + multi-kills — quadras et pentas, classes par rating
 *   3. Clutch & First Bloods — les actions decisives
 */

interface ScoredKill {
  kill: PublishedKillRow;
  composite: number;
}

function compositeScore(k: PublishedKillRow): number {
  // Highlight score (0-10) : poids 50%
  const hl = (k.highlight_score ?? 5) / 10;

  // Community rating (0-5) : poids 30% — mais seulement si n >= 3
  const rt = k.rating_count >= 3 ? (k.avg_rating ?? 0) / 5 : 0.5;

  // Engagement signal (impressions + comments par session)
  const engagement =
    k.impression_count > 10
      ? Math.min(1, (k.rating_count + k.comment_count) / k.impression_count)
      : 0.3;

  let score = hl * 0.5 + rt * 0.3 + engagement * 0.2;

  // Multi-kill multipliers — un penta vaut 2x un solo bien note
  if (k.multi_kill === "penta") score *= 2.0;
  else if (k.multi_kill === "quadra") score *= 1.6;
  else if (k.multi_kill === "triple") score *= 1.25;

  // First Blood + KC kill bonus
  if (k.is_first_blood) score *= 1.1;
  if (k.tracked_team_involvement === "team_killer") score *= 1.15;

  return score;
}

export default async function BestPage() {
  const all = await getPublishedKills(300);

  // Filter strict : besoin d'un clip vertical + thumbnail pour passer
  const eligible = all.filter(
    (k) =>
      !!k.clip_url_vertical &&
      !!k.thumbnail_url &&
      k.kill_visible !== false &&
      k.tracked_team_involvement === "team_killer",
  );

  const scored: ScoredKill[] = eligible
    .map((kill) => ({ kill, composite: compositeScore(kill) }))
    .sort((a, b) => b.composite - a.composite);

  const hallOfFame = scored.slice(0, 12);
  const multiKills = scored.filter((s) => s.kill.multi_kill).slice(0, 8);
  const totalCount = scored.length;

  return (
    <div className="-mt-6">
      <PageHero
        crumbs={[
          { label: "Accueil", href: "/" },
          { label: "Meilleurs Clips" },
        ]}
        badge={`${totalCount} clips analys\u00e9s`}
        title="MEILLEURS CLIPS"
        subtitle="La selection curatee par l'algorithme : score IA Gemini + rating communaute + bonus multi-kills. Mise a jour live au fil du tagging."
        backgroundSrc="/images/hero-bg.jpg"
      />

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 space-y-16">

        {/* ═══ HERO SLOT — le top 1 mis en avant ═══ */}
        {hallOfFame[0] && <TopClipFeature clip={hallOfFame[0].kill} score={hallOfFame[0].composite} />}

        {/* ═══ HALL OF FAME — top 12 ═══ */}
        <section className="space-y-5">
          <SectionHeader
            kicker="Hall of Fame"
            title="Les 12 plus notes"
            subtitle="Score composite : highlight Gemini + rating communaute + engagement."
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {hallOfFame.slice(1, 13).map(({ kill }, i) => (
              <RankedCard key={kill.id} kill={kill} rank={i + 2} />
            ))}
          </div>
        </section>

        {/* ═══ CARTES PAR RARETE — TCG visual layer ═══ */}
        <section className="space-y-5">
          <SectionHeader
            kicker="Cartes"
            title="Les artefacts du moment"
            subtitle="Chaque clip est un artefact. Rarete calculee depuis le score IA, le multi-kill, le contexte. MYTHIC : score >= 90 (penta + first blood + IA 9+). LEGENDARY : >= 75. Visuel et reflets reels — purement presentationnel, pas de pack ni d'economie."
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {hallOfFame.slice(0, 8).map(({ kill }) => (
              <ClipCard
                key={`tcg-${kill.id}`}
                signals={{
                  id: kill.id,
                  killerChampion: kill.killer_champion,
                  victimChampion: kill.victim_champion,
                  thumbnailUrl: kill.thumbnail_url,
                  aiDescription: kill.ai_description,
                  highlightScore: kill.highlight_score,
                  avgRating: kill.avg_rating,
                  ratingCount: kill.rating_count,
                  multiKill: kill.multi_kill,
                  isFirstBlood: kill.is_first_blood,
                  trackedTeamInvolvement: kill.tracked_team_involvement,
                  fightType: kill.fight_type,
                }}
                variant="portrait"
              />
            ))}
          </div>
        </section>

        {/* ═══ MULTI-KILLS ═══ */}
        {multiKills.length > 0 && (
          <section className="space-y-5">
            <SectionHeader
              kicker="Carry Mode"
              title="Multi-kills"
              subtitle="Triples, quadras, pentas. Les moments ou un seul joueur prend le contr\u00f4le."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {multiKills.map(({ kill }) => (
                <MultiKillCard key={kill.id} kill={kill} />
              ))}
            </div>
          </section>
        )}

        {/* ═══ Per-player reels (powered by ClipReel platform) ═══ */}
        <section className="space-y-5">
          <SectionHeader
            kicker="Par joueur"
            title="Les meilleurs kills du roster"
            subtitle="Top 6 par joueur, score IA \u2265 7. Powered by la plateforme clip-centric."
          />
          {(["Caliste", "Canna", "Yike", "Kyeahoo", "Busio"] as const).map((ign) => (
            <PlayerReel key={ign} ign={ign} />
          ))}
        </section>
      </div>
    </div>
  );
}

// ─── Composants ────────────────────────────────────────────────────────

function SectionHeader({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <header>
      <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
        {kicker}
      </p>
      <h2 className="font-display text-2xl md:text-3xl font-black text-[var(--text-primary)]">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1 text-sm text-[var(--text-muted)] max-w-2xl">{subtitle}</p>
      )}
    </header>
  );
}

function TopClipFeature({ clip, score }: { clip: PublishedKillRow; score: number }) {
  const isPenta = clip.multi_kill === "penta";
  return (
    <Link
      href={`/kill/${clip.id}`}
      className="group relative block overflow-hidden rounded-3xl border-2 transition-all hover:scale-[1.005] hover:-translate-y-0.5"
      style={{
        borderColor: isPenta ? "rgba(255,215,0,0.5)" : "rgba(200,170,110,0.4)",
        boxShadow: isPenta
          ? "0 30px 90px rgba(255,215,0,0.18), 0 0 0 1px rgba(255,215,0,0.35), 0 0 60px rgba(255,215,0,0.15)"
          : "0 30px 90px rgba(200,170,110,0.15), 0 0 0 1px rgba(200,170,110,0.35), 0 0 50px rgba(200,170,110,0.12)",
        aspectRatio: "21/9",
      }}
    >
      {clip.thumbnail_url ? (
        <Image
          src={clip.thumbnail_url}
          alt=""
          fill
          priority
          sizes="(max-width: 768px) 100vw, 1280px"
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />
      <div
        className="absolute inset-0 mix-blend-overlay opacity-30"
        style={{
          background: isPenta
            ? "radial-gradient(circle at 50% 30%, rgba(255,215,0,0.5) 0%, transparent 70%)"
            : "radial-gradient(circle at 50% 30%, rgba(200,170,110,0.4) 0%, transparent 70%)",
        }}
      />

      {/* Top-left: rank #1 badge */}
      <div className="absolute top-5 left-5 z-10 flex items-center gap-3">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full font-display text-xl font-black text-black"
          style={{
            backgroundColor: isPenta ? "#FFD700" : "var(--gold)",
            boxShadow: `0 0 30px ${isPenta ? "#FFD700" : "var(--gold)"}80`,
          }}
        >
          1
        </span>
        <div className="flex flex-col">
          <span
            className="font-data text-[10px] uppercase tracking-[0.25em] font-bold"
            style={{ color: isPenta ? "#FFD700" : "var(--gold)" }}
          >
            #1 du moment
          </span>
          <span className="font-data text-[10px] text-white/55">
            score {score.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Top-right: highlight score */}
      {clip.highlight_score != null && (
        <div className="absolute top-5 right-5 z-10 rounded-full bg-black/60 backdrop-blur-md border border-[var(--gold)]/50 px-4 py-1.5">
          <span className="font-data text-base font-bold text-[var(--gold)]">
            {clip.highlight_score.toFixed(1)}
          </span>
          <span className="font-data text-[10px] text-white/50 ml-1">/10</span>
        </div>
      )}

      {/* Centred play affordance */}
      <span aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span
          className="flex h-20 w-20 md:h-24 md:w-24 items-center justify-center rounded-full backdrop-blur-md transition-transform duration-300 group-hover:scale-110"
          style={{
            backgroundColor: isPenta ? "rgba(255,215,0,0.2)" : "rgba(200,170,110,0.18)",
            border: `2px solid ${isPenta ? "rgba(255,215,0,0.7)" : "rgba(200,170,110,0.7)"}`,
            boxShadow: `0 0 50px ${isPenta ? "rgba(255,215,0,0.5)" : "rgba(200,170,110,0.4)"}`,
          }}
        >
          <svg className="h-9 w-9 md:h-10 md:w-10 translate-x-0.5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>

      {/* Bottom info */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {clip.multi_kill && (
            <span className="rounded-md bg-[var(--gold)]/25 border border-[var(--gold)]/60 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--gold)]">
              {clip.multi_kill} kill
            </span>
          )}
          {clip.is_first_blood && (
            <span className="rounded-md bg-[var(--red)]/25 border border-[var(--red)]/60 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--red)]">
              First Blood
            </span>
          )}
          <span className="rounded-md bg-black/60 border border-white/15 px-3 py-1 text-[10px] font-bold text-white/85 uppercase tracking-wider">
            KC kill
          </span>
        </div>
        <h3 className="font-display text-3xl md:text-5xl font-black text-white leading-tight mb-2">
          <span className="text-[var(--gold)]">{clip.killer_champion}</span>
          <span className="text-white/55 mx-3">→</span>
          <span className="text-white/85">{clip.victim_champion}</span>
        </h3>
        {clip.ai_description && (
          <p className="text-base md:text-lg text-white/85 italic max-w-3xl leading-snug">
            « {clip.ai_description} »
          </p>
        )}
      </div>
    </Link>
  );
}

function RankedCard({ kill, rank }: { kill: PublishedKillRow; rank: number }) {
  return (
    <Link
      href={`/kill/${kill.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-black transition-all hover:-translate-y-0.5 hover:border-[var(--gold)]/50 hover:shadow-2xl hover:shadow-[var(--gold)]/15"
      style={{ aspectRatio: "16/10" }}
    >
      {kill.thumbnail_url ? (
        <Image
          src={kill.thumbnail_url}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />

      {/* Rank badge */}
      <span
        className="absolute top-3 left-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 backdrop-blur-sm border border-[var(--gold)]/40 font-data text-sm font-black text-[var(--gold)]"
      >
        {rank}
      </span>

      {/* Highlight score */}
      {kill.highlight_score != null && (
        <span className="absolute top-3 right-3 z-10 rounded-md bg-[var(--gold)]/15 border border-[var(--gold)]/40 px-2 py-0.5 font-data text-[10px] font-bold text-[var(--gold)]">
          {kill.highlight_score.toFixed(1)}
        </span>
      )}

      {/* Bottom */}
      <div className="absolute inset-x-3 bottom-3 z-10">
        {(kill.multi_kill || kill.is_first_blood) && (
          <div className="flex items-center gap-1.5 mb-1.5">
            {kill.multi_kill && (
              <span className="rounded bg-[var(--gold)]/20 border border-[var(--gold)]/45 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--gold)]">
                {kill.multi_kill}
              </span>
            )}
            {kill.is_first_blood && (
              <span className="rounded bg-[var(--red)]/20 border border-[var(--red)]/45 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--red)]">
                FB
              </span>
            )}
          </div>
        )}
        <p className="font-display font-black text-white text-sm leading-tight">
          <span className="text-[var(--gold)]">{kill.killer_champion}</span>
          <span className="text-white/50 mx-1.5">→</span>
          <span>{kill.victim_champion}</span>
        </p>
        {kill.ai_description && (
          <p className="mt-1 text-[11px] text-white/70 italic line-clamp-2">
            {kill.ai_description}
          </p>
        )}
      </div>
    </Link>
  );
}

function MultiKillCard({ kill }: { kill: PublishedKillRow }) {
  const isPenta = kill.multi_kill === "penta";
  const isQuadra = kill.multi_kill === "quadra";
  const accent = isPenta ? "#FFD700" : isQuadra ? "#FF9800" : "var(--gold)";
  return (
    <Link
      href={`/kill/${kill.id}`}
      className="group relative block overflow-hidden rounded-2xl border-2 transition-all hover:-translate-y-1 hover:scale-[1.02]"
      style={{
        borderColor: `${accent}50`,
        boxShadow: `0 12px 32px ${accent}20, 0 0 24px ${accent}15`,
        aspectRatio: "9/16",
      }}
    >
      {kill.thumbnail_url ? (
        <Image
          src={kill.thumbnail_url}
          alt=""
          fill
          sizes="(max-width: 768px) 50vw, 25vw"
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent" />

      <span
        className="absolute top-3 left-1/2 -translate-x-1/2 z-10 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.25em]"
        style={{
          backgroundColor: `${accent}25`,
          border: `1px solid ${accent}80`,
          color: accent,
          boxShadow: `0 0 15px ${accent}50`,
        }}
      >
        {kill.multi_kill}!
      </span>

      <div className="absolute inset-x-3 bottom-3 z-10 text-center">
        <p className="font-display text-xs font-black text-white leading-tight">
          {kill.killer_champion}
        </p>
        <p className="text-[10px] text-white/60 mt-0.5">
          {kill.killer_champion} kill
        </p>
      </div>
    </Link>
  );
}

async function PlayerReel({ ign }: { ign: string }) {
  // Need to resolve the player UUID — same pattern as /player/[slug]
  const { getPlayerByIgn } = await import("@/lib/supabase/players");
  const player = await getPlayerByIgn(ign);
  if (!player) return null;
  return (
    <ClipReel
      kicker={ign}
      title={`Top 6 \u2014 ${ign}`}
      filter={{
        killerPlayerId: player.id,
        trackedTeamInvolvement: "team_killer",
        minHighlight: 7,
      }}
      limit={6}
      ctaHref={`/player/${encodeURIComponent(ign)}`}
      ctaLabel={`Tout voir ${ign}`}
      emptyState={null}
    />
  );
}
