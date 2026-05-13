import Image from "next/image";
import Link from "next/link";
import { pickAssetUrl } from "@/lib/kill-assets";
import type { PublishedKillRow } from "@/lib/supabase/kills";

/**
 * FullKillsGrid — desktop : 4-col grid of every clip in the match.
 * Mobile : horizontal snap-x scroll of 9:16 cards.
 *
 * Pure server component. Each card links to `/kill/[id]` ; the
 * MatchTimeline + KillSidePanel are the interactive surface for clip
 * preview, this grid is the "I want to scan every clip at once" view.
 */

export interface FullKillsGridProps {
  kills: PublishedKillRow[];
  opponentCode: string;
  /** Anchor id — referenced by the hero CTA + page nav. */
  anchorId?: string;
}

function formatMinSec(seconds: number | null): string {
  if (seconds == null) return "—";
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

const MULTI_KILL_LABEL: Record<string, string> = {
  penta: "PENTAKILL",
  quadra: "QUADRA",
  triple: "TRIPLE",
  double: "DOUBLE",
};

export function FullKillsGrid({
  kills,
  opponentCode,
  anchorId = "kills-feed",
}: FullKillsGridProps) {
  if (kills.length === 0) {
    return (
      <section
        id={anchorId}
        aria-label="Liste complète des kills"
        className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)] scroll-mt-32"
      >
        Pas encore de clips publiés pour ce match. Le pipeline est en route.
      </section>
    );
  }

  return (
    <section
      id={anchorId}
      aria-labelledby="kills-feed-heading"
      className="space-y-4 scroll-mt-32"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id="kills-feed-heading"
          className="font-display text-xl font-black uppercase tracking-widest text-[var(--gold)]"
        >
          Tous les kills · {kills.length}
        </h2>
        <Link
          href="/scroll"
          className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)]"
        >
          Mode TikTok ›
        </Link>
      </div>

      {/* Mobile : horizontal snap. Desktop : 4-col grid. */}
      <div
        className="flex gap-3 overflow-x-auto pb-3 snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-2 sm:overflow-visible md:grid-cols-3 lg:grid-cols-4"
        role="list"
      >
        {kills.map((kill) => (
          <KillCard
            key={kill.id}
            kill={kill}
            opponentCode={opponentCode}
          />
        ))}
      </div>
    </section>
  );
}

// ─── Single kill card ─────────────────────────────────────────────────

function KillCard({
  kill,
  opponentCode,
}: {
  kill: PublishedKillRow;
  opponentCode: string;
}) {
  const thumb = pickAssetUrl(kill, "thumbnail");
  const score = kill.highlight_score?.toFixed(1) ?? "—";
  const isKc = kill.tracked_team_involvement === "team_killer";
  const multi = kill.multi_kill ? MULTI_KILL_LABEL[kill.multi_kill] : null;
  const matchup = `${kill.killer_champion ?? "?"} → ${kill.victim_champion ?? "?"}`;
  return (
    <Link
      role="listitem"
      href={`/kill/${kill.id}`}
      className="group relative block w-[78vw] sm:w-auto shrink-0 snap-start overflow-hidden rounded-xl border border-[var(--border-gold)] bg-black transition-all hover:border-[var(--gold)]/60 hover:-translate-y-1 hover:shadow-xl hover:shadow-[var(--gold)]/10"
      style={{ aspectRatio: "9 / 16" }}
      aria-label={`Clip : ${matchup} à T+${formatMinSec(kill.game_time_seconds)}, score IA ${score}`}
    >
      {thumb ? (
        <Image
          src={thumb}
          alt=""
          fill
          sizes="(max-width: 640px) 78vw, (max-width: 1024px) 33vw, 22vw"
          className="object-cover transition-transform duration-500 group-hover:scale-110"
          unoptimized
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]">
          <span className="font-display text-2xl text-[var(--gold-dark)]">KC</span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />

      {/* Top chips */}
      <div className="absolute left-2 right-2 top-2 z-10 flex items-start justify-between">
        <span
          className={`rounded-md backdrop-blur px-1.5 py-0.5 font-data text-[9px] font-bold uppercase tracking-widest ${
            isKc
              ? "bg-[var(--gold)]/85 text-black"
              : "bg-[var(--red)]/85 text-white"
          }`}
        >
          {isKc ? "KC" : opponentCode}
        </span>
        <span className="rounded-md bg-black/75 backdrop-blur px-1.5 py-0.5 font-data text-[10px] font-bold text-[var(--gold-bright)]">
          ★ {score}
        </span>
      </div>

      {/* Multi-kill / FB chip — centered */}
      {(multi || kill.is_first_blood) && (
        <div className="absolute left-2 right-2 top-9 z-10 flex flex-wrap items-center justify-center gap-1">
          {multi && (
            <span className="rounded-full border border-[var(--gold-bright)]/70 bg-black/80 backdrop-blur px-2 py-0.5 font-display text-[9px] uppercase tracking-widest text-[var(--gold-bright)]">
              {multi}
            </span>
          )}
          {kill.is_first_blood && (
            <span className="rounded-full bg-[var(--red)]/90 px-2 py-0.5 font-data text-[8px] font-bold uppercase tracking-widest text-white">
              First Blood
            </span>
          )}
        </div>
      )}

      {/* Bottom info */}
      <div className="absolute inset-x-0 bottom-0 z-[5] p-3">
        <p className="font-data text-[9px] uppercase tracking-widest text-[var(--gold)]/85">
          Game {kill.games?.game_number ?? "?"} · T+
          {formatMinSec(kill.game_time_seconds)}
        </p>
        <p className="mt-0.5 font-display text-sm font-black uppercase text-white line-clamp-1 drop-shadow-md">
          {matchup}
        </p>
        {kill.ai_description ? (
          <p className="mt-1 text-[10px] leading-snug text-[var(--text-secondary)] line-clamp-2">
            {kill.ai_description}
          </p>
        ) : null}
      </div>

      {/* Corner ornament */}
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 bottom-2 z-[6] h-2 w-2 rotate-45 border border-[var(--gold)]/40 opacity-70"
      />
    </Link>
  );
}
