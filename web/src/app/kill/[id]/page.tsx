import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { loadRealData, displayRole } from "@/lib/real-data";
import { championIconUrl } from "@/lib/constants";
import { computeKillScore } from "@/lib/feed-algorithm";
import { getKillById, getPublishedKills, type PublishedKillRow } from "@/lib/supabase/kills";
import { KillInteractions } from "./interactions";
import type { Metadata } from "next";

// ISR: pre-render the top N clips at build time, regenerate every 10 min
// so freshly-rated kills bubble up without a deploy.
export const revalidate = 600;
// Other ids fall back to on-demand SSG with the same revalidate window.
export const dynamicParams = true;

/**
 * Pre-render the 100 top-scored published clips at build time. This is
 * the V1 SEO requirement (cf. AUDIT.md §6.3 — Google must be able to
 * index at least the top 100 clip pages on launch). Everything beyond
 * the top 100 is rendered on first hit and cached for `revalidate`s.
 *
 * Fails open: if Supabase is unreachable at build (cold deploy on a
 * fresh env), we return an empty list — every page still works via
 * dynamicParams fallback, just without prerender benefit.
 */
export async function generateStaticParams(): Promise<{ id: string }[]> {
  try {
    const kills = await getPublishedKills(100);
    return kills.map((k) => ({ id: k.id }));
  } catch {
    return [];
  }
}

interface Props {
  params: Promise<{ id: string }>;
}

// ─── ID detection ──────────────────────────────────────────────────────
// Supabase kill ids are UUIDs. Legacy aggregate ids are of the form
// `{matchId}-{gameNumber}-{playerName}`.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

// ─── Legacy kill index ─────────────────────────────────────────────────

interface LegacyKill {
  id: string;
  playerName: string;
  champion: string;
  opponentName: string;
  opponentChampion: string;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  cs: number;
  matchId: string;
  matchDate: string;
  opponent: string;
  opponentFull: string;
  stage: string;
  gameNumber: number;
  gameKcKills: number;
  gameOppKills: number;
  kcWon: boolean;
  isKcKiller: boolean;
  score: number;
  role: string;
  multiKill: string | null;
}

function buildLegacyKillIndex(data: ReturnType<typeof loadRealData>): LegacyKill[] {
  const kills: LegacyKill[] = [];
  for (const match of data.matches) {
    for (const game of match.games) {
      for (const p of game.kc_players) {
        if (!p.name.startsWith("KC ")) continue;
        if (p.kills === 0 && p.deaths === 0) continue;
        const bestOpp = [...game.opp_players].sort((a, b) => b.deaths - a.deaths)[0];
        const cleanName = p.name.replace("KC ", "");
        kills.push({
          id: `${match.id}-${game.number}-${cleanName}`,
          playerName: cleanName,
          champion: p.champion,
          opponentName: bestOpp ? bestOpp.name.replace(/^[A-Z]+ /, "") : "?",
          opponentChampion: bestOpp?.champion ?? "?",
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          gold: p.gold,
          cs: p.cs,
          matchId: match.id,
          matchDate: match.date,
          opponent: match.opponent.code,
          opponentFull: match.opponent.name,
          stage: match.stage,
          gameNumber: game.number,
          gameKcKills: game.kc_kills,
          gameOppKills: game.opp_kills,
          kcWon: match.kc_won,
          isKcKiller: p.kills > 0,
          score: computeKillScore(p.kills, p.deaths, p.assists, game.kc_kills, true, match.kc_won),
          role: p.role,
          multiKill: p.kills >= 5 ? "penta" : p.kills >= 4 ? "quadra" : p.kills >= 3 ? "triple" : p.kills >= 2 ? "double" : null,
        });
      }
    }
  }
  return kills;
}

function opponentFromMatchExternalId(
  matchExternalId: string,
  data: ReturnType<typeof loadRealData>
): { code: string; name: string } {
  const hit = data.matches.find((m) => m.id === matchExternalId);
  if (hit) return { code: hit.opponent.code, name: hit.opponent.name };
  return { code: "LEC", name: "LEC" };
}

// ─── Metadata ──────────────────────────────────────────────────────────

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;

  if (isUuid(id)) {
    const kill = await getKillById(id);
    if (kill) {
      const title = `${kill.killer_champion ?? "?"} \u2192 ${kill.victim_champion ?? "?"} \u2014 KCKILLS`;
      const description = kill.ai_description ?? `Highlight score ${kill.highlight_score?.toFixed(1) ?? "?"}/10`;
      const canonicalPath = `/kill/${id}`;
      return {
        title,
        description,
        alternates: { canonical: canonicalPath },
        openGraph: {
          title,
          description,
          type: "video.other",
          url: canonicalPath,
          siteName: "KCKILLS",
          locale: "fr_FR",
          images: kill.og_image_url ? [kill.og_image_url] : undefined,
          videos: kill.clip_url_horizontal
            ? [
                {
                  url: kill.clip_url_horizontal,
                  width: 1920,
                  height: 1080,
                  type: "video/mp4",
                },
              ]
            : undefined,
        },
        twitter: {
          card: "player",
          title,
          description,
          images: kill.og_image_url ? [kill.og_image_url] : undefined,
        },
      };
    }
  }

  const data = loadRealData();
  const kills = buildLegacyKillIndex(data);
  const kill = kills.find((k) => k.id === id);
  if (!kill) return { title: "Kill introuvable \u2014 KCKILLS" };

  const title = `${kill.playerName} (${kill.champion}) vs ${kill.opponent} \u2014 KCKILLS`;
  return {
    title,
    description: `${kill.kills}/${kill.deaths}/${kill.assists} \u2014 ${kill.stage} \u2014 KC vs ${kill.opponent}`,
    openGraph: { title, description: `Score: ${kill.score}` },
  };
}

// ─── Page ──────────────────────────────────────────────────────────────

export default async function KillDetailPage({ params }: Props) {
  const { id } = await params;

  if (isUuid(id)) {
    const kill = await getKillById(id);
    if (kill) {
      const data = loadRealData();
      const opponent = opponentFromMatchExternalId(
        kill.games?.matches?.external_id ?? "",
        data
      );

      // JSON-LD VideoObject for SEO — helps Google index clips as videos
      // and surface them in the video search vertical. Schema.org spec:
      // https://schema.org/VideoObject
      const canonicalUrl = `https://kckills.com/kill/${id}`;
      const videoJsonLd = kill.clip_url_horizontal ? {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        name: `${kill.killer_champion} \u2192 ${kill.victim_champion} \u2014 KC vs ${opponent.code}`,
        description:
          kill.ai_description ??
          `Kill highlight from KC vs ${opponent.code} \u2014 ${kill.killer_champion} eliminates ${kill.victim_champion}.`,
        thumbnailUrl: kill.thumbnail_url ?? kill.og_image_url ?? undefined,
        contentUrl: kill.clip_url_horizontal,
        embedUrl: canonicalUrl,
        uploadDate: kill.created_at,
        // Duration is best-effort: V1 clips average ~14-22s, we use a
        // conservative 18s pending a `duration_seconds` column in the
        // schema (Phase 1 metadata foundation).
        duration: "PT18S",
        inLanguage: "fr-FR",
        isFamilyFriendly: true,
        keywords: [
          "League of Legends",
          "esport",
          "Karmine Corp",
          "KC",
          "LEC",
          kill.killer_champion ?? "",
          kill.victim_champion ?? "",
          ...(Array.isArray(kill.ai_tags) ? kill.ai_tags : []),
        ].filter(Boolean).join(", "),
        publisher: {
          "@type": "Organization",
          name: "KCKILLS",
          url: "https://kckills.com",
          logo: {
            "@type": "ImageObject",
            url: "https://kckills.com/icons/icon-512.png",
          },
        },
        ...(kill.rating_count > 0 && kill.avg_rating != null
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: kill.avg_rating.toFixed(1),
                ratingCount: kill.rating_count,
                bestRating: 5,
                worstRating: 1,
              },
            }
          : {}),
        ...(kill.impression_count > 0
          ? {
              interactionStatistic: {
                "@type": "InteractionCounter",
                interactionType: { "@type": "WatchAction" },
                userInteractionCount: kill.impression_count,
              },
            }
          : {}),
      } : null;

      return (
        <>
          {videoJsonLd && (
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{ __html: JSON.stringify(videoJsonLd) }}
            />
          )}
          <VideoKillDetail kill={kill} opponent={opponent} id={id} />
        </>
      );
    }
  }

  const data = loadRealData();
  const kills = buildLegacyKillIndex(data);
  const kill = kills.find((k) => k.id === id);
  if (!kill) notFound();
  return <LegacyKillDetail kill={kill} id={id} />;
}

// ─── Video detail view (Supabase-backed) ───────────────────────────────

function VideoKillDetail({
  kill,
  opponent,
  id,
}: {
  kill: PublishedKillRow;
  opponent: { code: string; name: string };
  id: string;
}) {
  const gameTime = kill.game_time_seconds ?? 0;
  const gtMin = Math.floor(gameTime / 60);
  const gtSec = gameTime % 60;
  const matchExternalId = kill.games?.matches?.external_id ?? "";
  const matchScheduled = kill.games?.matches?.scheduled_at ?? kill.created_at;
  const stage = kill.games?.matches?.stage ?? "LEC";
  const gameNumber = kill.games?.game_number ?? 1;
  const isKcKill = kill.tracked_team_involvement === "team_killer";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        {matchExternalId ? (
          <Link href={`/match/${matchExternalId}`} className="hover:text-[var(--gold)]">
            KC vs {opponent.code}
          </Link>
        ) : (
          <span>KC vs {opponent.code}</span>
        )}
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>Game {gameNumber}</span>
      </nav>

      {/* ═══ REAL VIDEO CLIP ═══ */}
      <div className="relative w-full overflow-hidden rounded-xl border border-[var(--border-gold)] bg-black">
        <video
          className="aspect-video w-full"
          src={kill.clip_url_horizontal ?? kill.clip_url_vertical ?? undefined}
          poster={kill.thumbnail_url ?? undefined}
          controls
          playsInline
          preload="metadata"
        />
        <div className="absolute top-3 left-3 flex items-center gap-2">
          {kill.is_first_blood && (
            <span className="rounded-md bg-[var(--red)]/20 border border-[var(--red)]/40 px-2.5 py-1 text-[10px] font-black text-[var(--red)] uppercase tracking-[0.15em]">
              First Blood
            </span>
          )}
          {kill.multi_kill && (
            <span className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
              kill.multi_kill === "penta" ? "badge-penta bg-[var(--gold)]/20 border border-[var(--gold)]/40" :
              kill.multi_kill === "quadra" ? "text-[var(--orange)] bg-[var(--orange)]/15 border border-[var(--orange)]/30" :
              kill.multi_kill === "triple" ? "text-[var(--orange)] bg-[var(--orange)]/10 border border-[var(--orange)]/20" :
              "text-[var(--text-secondary)] bg-white/5 border border-white/10"
            }`}>
              {kill.multi_kill} kill
            </span>
          )}
          {kill.highlight_score != null && (
            <span className="rounded-md bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2 py-1 text-[10px] font-data font-bold text-[var(--gold)]">
              {kill.highlight_score.toFixed(1)}/10
            </span>
          )}
        </div>
      </div>

      {/* Kill info card */}
      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 space-y-4">
        {/* Matchup */}
        <div className="flex items-center gap-4">
          <div className={`overflow-hidden rounded-xl border-2 ${isKcKill ? "border-[var(--gold)]/60" : "border-white/20"}`}>
            <Image
              src={championIconUrl(kill.killer_champion ?? "Aatrox")}
              alt={kill.killer_champion ?? "?"}
              width={72}
              height={72}
            />
          </div>
          <div className="flex flex-col items-center">
            <svg className="h-6 w-6 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            <span className="mt-1 font-data text-[10px] text-[var(--text-muted)]">
              T+{gtMin.toString().padStart(2, "0")}:{gtSec.toString().padStart(2, "0")}
            </span>
          </div>
          <div className={`overflow-hidden rounded-xl border-2 ${!isKcKill ? "border-[var(--gold)]/60" : "border-[var(--red)]/40"}`}>
            <Image
              src={championIconUrl(kill.victim_champion ?? "Aatrox")}
              alt={kill.victim_champion ?? "?"}
              width={72}
              height={72}
            />
          </div>
          <div className="ml-auto text-right">
            <p className={`font-display text-xs font-black uppercase tracking-widest ${isKcKill ? "text-[var(--gold)]" : "text-[var(--red)]"}`}>
              {isKcKill ? "KC Kill" : "KC Death"}
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">
              {kill.killer_champion}
              <span className="mx-1">&rarr;</span>
              {kill.victim_champion}
            </p>
          </div>
        </div>

        {/* AI description */}
        {kill.ai_description && (
          <blockquote className="rounded-lg border-l-2 border-[var(--gold)]/40 bg-[var(--bg-primary)] px-4 py-3 text-sm italic text-white/90">
            &laquo; {kill.ai_description} &raquo;
          </blockquote>
        )}

        {/* AI tags */}
        {kill.ai_tags && kill.ai_tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {kill.ai_tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2.5 py-0.5 text-[10px] font-data text-[var(--gold)]"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Rating summary */}
        {kill.rating_count > 0 && kill.avg_rating != null && (
          <div className="flex items-center gap-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-gold)] p-3">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <svg
                  key={s}
                  className={`h-4 w-4 ${(kill.avg_rating ?? 0) >= s - 0.25 ? "text-[var(--gold)]" : "text-white/20"}`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
            <span className="font-data text-sm font-bold text-[var(--gold)]">
              {kill.avg_rating.toFixed(1)}/5
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              {kill.rating_count} votes &middot; {kill.comment_count} comments
            </span>
          </div>
        )}

        {/* Match context */}
        {matchExternalId ? (
          <Link
            href={`/match/${matchExternalId}`}
            className="block rounded-lg bg-[var(--bg-primary)] border border-[var(--border-gold)] p-3 text-sm hover:border-[var(--gold)]/40 transition-colors"
          >
            <p className="font-medium">KC vs {opponent.name}</p>
            <p className="text-xs text-[var(--text-muted)]">
              {stage} &middot; Game {gameNumber}
              {matchScheduled && (
                <>
                  {" "}&middot;{" "}
                  {new Date(matchScheduled).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                </>
              )}
            </p>
          </Link>
        ) : (
          <div className="rounded-lg bg-[var(--bg-primary)] border border-[var(--border-gold)] p-3 text-sm">
            <p className="font-medium">KC vs {opponent.name}</p>
            <p className="text-xs text-[var(--text-muted)]">
              {stage} &middot; Game {gameNumber}
            </p>
          </div>
        )}
      </div>

      <KillInteractions killId={id} />

      <p className="text-[10px] text-[var(--text-disabled)] text-center">
        KCKILLS was created under Riot Games&apos; &quot;Legal Jibber Jabber&quot; policy.
        Riot Games does not endorse or sponsor this project.
      </p>
    </div>
  );
}

// ─── Legacy aggregate detail view ──────────────────────────────────────

function LegacyKillDetail({ kill, id }: { kill: LegacyKill; id: string }) {
  const kda = kill.deaths > 0
    ? ((kill.kills + kill.assists) / kill.deaths).toFixed(1)
    : "Perfect";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <Link href={`/match/${kill.matchId}`} className="hover:text-[var(--gold)]">
          KC vs {kill.opponent}
        </Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>Game {kill.gameNumber}</span>
      </nav>

      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--border-gold)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${kill.champion}_0.jpg`}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-30"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/50" />
        <div className="relative z-10 flex h-full items-center justify-center">
          <div className="flex items-center gap-6">
            <div className="overflow-hidden rounded-xl border-2 border-[var(--gold)]/40 shadow-lg shadow-[var(--gold)]/10">
              <Image src={championIconUrl(kill.champion)} alt={kill.champion} width={100} height={100} />
            </div>
            <div className="flex flex-col items-center">
              <div className="h-12 w-12 flex items-center justify-center rounded-full bg-[var(--gold)]/20 border border-[var(--gold)]/30">
                <svg className="h-6 w-6 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border-2 border-[var(--red)]/40">
              <Image src={championIconUrl(kill.opponentChampion)} alt={kill.opponentChampion} width={100} height={100} />
            </div>
          </div>
        </div>
        <div className="absolute bottom-3 left-0 right-0 text-center">
          <span className="rounded-full bg-black/60 backdrop-blur-sm px-3 py-1 text-[10px] text-[var(--text-muted)]">
            Clip bient&ocirc;t disponible
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Image src={championIconUrl(kill.champion)} alt={kill.champion} width={48} height={48}
            className="rounded-xl border border-[var(--gold)]/30" />
          <div>
            <h1 className="font-display text-xl font-bold text-[var(--gold)]">{kill.playerName}</h1>
            <p className="text-sm text-[var(--text-muted)]">{kill.champion} &middot; {displayRole(kill.role)}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="font-data text-2xl font-bold">
              <span className="text-[var(--green)]">{kill.kills}</span>
              /<span className="text-[var(--red)]">{kill.deaths}</span>
              /<span className="text-[var(--text-secondary)]">{kill.assists}</span>
            </p>
            <p className="text-xs text-[var(--text-muted)]">KDA {kda}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {kill.multiKill && (
            <span className={`rounded-md px-3 py-1 text-xs font-black uppercase tracking-wider ${
              kill.multiKill === "penta" ? "badge-penta bg-[var(--gold)]/20 border border-[var(--gold)]/40" :
              kill.multiKill === "quadra" ? "text-[var(--orange)] bg-[var(--orange)]/15 border border-[var(--orange)]/30" :
              kill.multiKill === "triple" ? "text-[var(--orange)] bg-[var(--orange)]/10 border border-[var(--orange)]/20" :
              "text-[var(--text-secondary)] bg-white/5 border border-white/10"
            }`}>
              {kill.multiKill} kill
            </span>
          )}
          {kill.deaths === 0 && kill.kills >= 2 && (
            <span className="rounded-full bg-[var(--green)]/10 border border-[var(--green)]/20 px-2.5 py-0.5 text-[10px] text-[var(--green)]">#clean</span>
          )}
          {kill.kills >= 3 && kill.deaths <= 1 && (
            <span className="rounded-full bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2.5 py-0.5 text-[10px] text-[var(--gold)]">#outplay</span>
          )}
          {kill.kills >= 5 && (
            <span className="rounded-full bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2.5 py-0.5 text-[10px] text-[var(--gold)]">#carry</span>
          )}
          {kill.gameKcKills > kill.gameOppKills * 2 && (
            <span className="rounded-full bg-[var(--cyan)]/10 border border-[var(--cyan)]/20 px-2.5 py-0.5 text-[10px] text-[var(--cyan)]">#stomp</span>
          )}
        </div>

        <div className="flex items-center gap-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-gold)] p-3">
          <div className="flex items-center gap-1.5">
            <svg className="h-4 w-4 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span className="font-data text-lg font-black text-[var(--gold)]">{kill.score}</span>
            <span className="text-[10px] text-[var(--text-muted)]">pts</span>
          </div>
          <span className="text-[10px] text-[var(--text-disabled)]">Score composite (KDA, kill participation, victoire)</span>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div className="stat-card rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] p-3 text-center">
            <p className="font-data text-lg font-bold text-[var(--gold)]">{kill.score}</p>
            <p className="text-[10px] text-[var(--text-muted)]">Score</p>
          </div>
          <div className="stat-card rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] p-3 text-center">
            <p className="font-data text-lg font-bold">{(kill.gold / 1000).toFixed(1)}k</p>
            <p className="text-[10px] text-[var(--text-muted)]">Gold</p>
          </div>
          <div className="stat-card rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] p-3 text-center">
            <p className="font-data text-lg font-bold">{kill.cs}</p>
            <p className="text-[10px] text-[var(--text-muted)]">CS</p>
          </div>
          <div className="stat-card rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] p-3 text-center">
            <p className={`font-data text-lg font-bold ${kill.kcWon ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
              {kill.kcWon ? "W" : "L"}
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">Result</p>
          </div>
        </div>

        <Link href={`/match/${kill.matchId}`}
          className="block rounded-lg bg-[var(--bg-primary)] border border-[var(--border-gold)] p-3 text-sm hover:border-[var(--gold)]/40 transition-colors">
          <p className="font-medium">KC vs {kill.opponentFull}</p>
          <p className="text-xs text-[var(--text-muted)]">
            {kill.stage} &middot; Game {kill.gameNumber} &middot;{" "}
            <span className="font-data">{kill.gameKcKills}-{kill.gameOppKills}</span> &middot;{" "}
            {new Date(kill.matchDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </Link>
      </div>

      <KillInteractions killId={id} />

      <p className="text-[10px] text-[var(--text-disabled)] text-center">
        KCKILLS was created under Riot Games&apos; &quot;Legal Jibber Jabber&quot; policy.
        Riot Games does not endorse or sponsor this project.
      </p>
    </div>
  );
}
