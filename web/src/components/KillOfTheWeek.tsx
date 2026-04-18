import Link from "next/link";
import Image from "next/image";
import { getPublishedKills, type PublishedKillRow } from "@/lib/supabase/kills";
import { championIconUrl } from "@/lib/constants";
import { isDescriptionClean } from "@/lib/scroll/sanitize-description";

/**
 * Kill of the Week — auto-highlights the top-scored kill from the last 7 days.
 *
 * Server component (RSC). Falls back to nothing if no kills exist or
 * Supabase is unreachable. Shown on the homepage above the clips showcase.
 */
export async function KillOfTheWeek() {
  const kills = await getPublishedKills(1);
  if (kills.length === 0) return null;

  const kill = kills[0]; // already sorted by highlight_score desc
  const isKc = kill.tracked_team_involvement === "team_killer";
  const gt = kill.game_time_seconds ?? 0;
  const mm = Math.floor(gt / 60);
  const ss = gt % 60;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--gold)]/30 bg-gradient-to-r from-[var(--gold)]/10 via-[var(--bg-surface)] to-[var(--bg-surface)]">
      <div className="flex flex-col md:flex-row items-stretch">
        {/* Video thumbnail / preview */}
        <Link
          href={`/kill/${kill.id}`}
          className="group relative w-full md:w-80 aspect-video md:aspect-auto flex-shrink-0 overflow-hidden"
        >
          {kill.thumbnail_url ? (
            <Image
              src={kill.thumbnail_url}
              alt={`${kill.killer_champion} vs ${kill.victim_champion}`}
              fill
              sizes="(max-width: 768px) 100vw, 320px"
              className="object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full bg-[var(--bg-primary)]" />
          )}
          {/* Play overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/10 transition-colors">
            <div className="h-14 w-14 rounded-full bg-[var(--gold)]/30 backdrop-blur-sm border border-[var(--gold)]/50 flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg className="h-6 w-6 text-[var(--gold)] translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </Link>

        {/* Info */}
        <div className="flex-1 p-5 md:p-6 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-3">
            <span className="h-2 w-2 rounded-full bg-[var(--gold)] animate-pulse" />
            <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
              Kill of the week
            </span>
            {kill.highlight_score != null && (
              <span className="ml-auto font-data text-lg font-black text-[var(--gold)]">
                {kill.highlight_score.toFixed(1)}/10
              </span>
            )}
          </div>

          {/* Matchup */}
          <div className="flex items-center gap-3 mb-3">
            <Image
              src={championIconUrl(kill.killer_champion ?? "Aatrox")}
              alt={kill.killer_champion ?? "?"}
              width={40}
              height={40}
              className={`rounded-xl border-2 ${isKc ? "border-[var(--gold)]/60" : "border-white/20"}`}
            />
            <span className="font-display text-xl md:text-2xl font-black text-white">
              {kill.killer_champion}
            </span>
            <span className="text-[var(--gold)] text-lg">&rarr;</span>
            <Image
              src={championIconUrl(kill.victim_champion ?? "Aatrox")}
              alt={kill.victim_champion ?? "?"}
              width={40}
              height={40}
              className={`rounded-xl border-2 ${!isKc ? "border-[var(--gold)]/60" : "border-[var(--red)]/40"}`}
            />
            <span className="font-display text-xl md:text-2xl font-black text-white/80">
              {kill.victim_champion}
            </span>
          </div>

          {/* AI description — guarded by isDescriptionClean (audit Opus 4.7) */}
          {isDescriptionClean(kill.ai_description) && (
            <p className="text-sm text-white/80 italic mb-3 line-clamp-2">
              &laquo; {kill.ai_description} &raquo;
            </p>
          )}

          {/* Meta */}
          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
            <span>T+{mm.toString().padStart(2, "0")}:{ss.toString().padStart(2, "0")}</span>
            {kill.games?.matches?.stage && <span>&middot; {kill.games.matches.stage}</span>}
            <Link
              href={`/kill/${kill.id}`}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/10 px-3 py-1.5 text-[10px] font-bold text-[var(--gold)] uppercase tracking-wider hover:bg-[var(--gold)]/20 transition-colors"
            >
              Voir le clip
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
