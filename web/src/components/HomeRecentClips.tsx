import Link from "next/link";
import Image from "next/image";
import { getRecentPublishedKills } from "@/lib/supabase/kills";
import { TEAM_LOGOS } from "@/lib/kc-assets";
import { championIconUrl } from "@/lib/constants";
import { getServerT } from "@/lib/i18n/server-lang";

/**
 * HomeRecentClips — horizontal strip of the 8 most recent clips.
 * Server component. Hidden if no clips are available.
 *
 * Each card shows: thumbnail, opponent badge, killer→victim, score.
 * Click → /scroll?kill=<id> to open in TikTok feed.
 *
 * Wave 36 audit fix : sources from getRecentPublishedKills (created_at
 * DESC) instead of getPublishedKills (highlight_score DESC) + client
 * re-sort — genuinely new low-score clips now appear, so the "{n}
 * récents" label is truthful.
 */
export async function HomeRecentClips() {
  // buildTime: true uses the cookie-less anon Supabase client to keep the
  // host page cacheable (cookies() opts into dynamic rendering otherwise).
  // The loader already orders by recency and filters to team_killer +
  // visible + has-clip server-side, so we fetch exactly the 8 we render.
  const cards = await getRecentPublishedKills(8, { buildTime: true });

  if (cards.length === 0) return null;

  const { t } = await getServerT();

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
            {t("p6_home1.recent_clips_kicker")}
          </span>
          <span className="text-xs text-[var(--text-muted)]">{t("p6_home1.recent_count", { n: cards.length })}</span>
        </div>
        <Link
          href="/clips"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--gold)] uppercase tracking-widest font-bold"
        >
          {t("p6_home1.all_arrow")}
        </Link>
      </div>

      {/* Horizontal scroll on mobile, grid on desktop */}
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory md:grid md:grid-cols-4 lg:grid-cols-8 md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0">
        {cards.map((k) => {
          const matchExt = k.games?.matches?.external_id;
          const opp = matchExt ? matchExt.split("_").pop()?.toUpperCase().slice(0, 4) : "";
          return (
            <Link
              key={k.id}
              href={`/scroll?kill=${k.id}`}
              className="group flex-shrink-0 w-32 md:w-auto snap-start relative aspect-[9/16] overflow-hidden rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] hover:border-[var(--gold)]/60 hover:-translate-y-0.5 transition-all"
            >
              {k.thumbnail_url && (
                <Image
                  src={k.thumbnail_url}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 128px, 12vw"
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                />
              )}

              {/* Top: opponent + score */}
              <div className="absolute top-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1 z-10">
                <span className="rounded bg-black/70 backdrop-blur-sm px-1.5 py-0.5 text-[8px] font-bold text-white">
                  KC vs {opp || "?"}
                </span>
                {k.highlight_score !== null && (
                  <span className="rounded bg-black/70 backdrop-blur-sm px-1.5 py-0.5 text-[8px] font-bold text-[var(--gold)]">
                    {k.highlight_score.toFixed(1)}
                  </span>
                )}
              </div>

              {/* Multi-kill badge */}
              {k.multi_kill && (
                <div className="absolute top-7 left-1.5 z-10">
                  <span className="rounded bg-[var(--orange)]/90 px-1.5 py-0.5 text-[8px] font-black uppercase text-black">
                    ⚡ {k.multi_kill}
                  </span>
                </div>
              )}

              {/* Bottom: champions */}
              <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/95 to-transparent z-10">
                <div className="flex items-center gap-1">
                  <Image
                    src={championIconUrl(k.killer_champion ?? "Aatrox")}
                    alt=""
                    width={20}
                    height={20}
                    className="rounded border border-[var(--gold)]/60"
                  />
                  <span className="text-[var(--gold)] text-[9px]">→</span>
                  <Image
                    src={championIconUrl(k.victim_champion ?? "Aatrox")}
                    alt=""
                    width={16}
                    height={16}
                    className="rounded border border-white/20 opacity-70"
                  />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
