import Link from "next/link";
import Image from "next/image";
import { getClipsFiltered, type ClipFilter, type FilteredClip } from "@/lib/supabase/clips";

interface ClipReelProps {
  /** Server-side filter — same shape as `ClipFilter` from supabase/clips. */
  filter: ClipFilter;
  /** Visual variant. Pick `compact-grid` for sidebars / dense pages,
   *  `parallax-ribbon` (heavier) for hero-of-secondary-page treatments. */
  variant?: "compact-grid" | "parallax-ribbon";
  /** Optional eyebrow line above the title. */
  kicker?: string;
  /** Section title — kept short, the count chip carries the rest. */
  title: string;
  /** Optional subtitle / context line below the title. */
  subtitle?: string;
  /** Hard cap on the number of clips fetched. Defaults to 12 for compact. */
  limit?: number;
  /** Optional CTA shown when at least one clip is returned. */
  ctaHref?: string;
  ctaLabel?: string;
  /** What to show when the filter returns zero clips. Defaults to a calm
   *  hint so the section never looks broken. Pass `null` to render nothing
   *  on empty (the parent decides). */
  emptyState?: React.ReactNode | null;
}

/**
 * Server component — the reusable clip reel that any page can drop in.
 *
 * Pulls the filtered slice through `fn_get_clips_filtered` (RPC), then
 * hands off to a presentational variant. The carousel-style ribbon is a
 * V2 follow-up that reuses the YouTubeParallaxCarousel engine; for now we
 * ship the compact grid that fits inside any layout without dominating it.
 *
 * Stays a server component so the SQL trip happens close to the data and
 * we never ship the full clip metadata over the wire to the client.
 */
export async function ClipReel({
  filter,
  variant = "compact-grid",
  kicker,
  title,
  subtitle,
  limit = 12,
  ctaHref,
  ctaLabel,
  emptyState,
}: ClipReelProps) {
  const clips = await getClipsFiltered(filter, limit);

  if (clips.length === 0) {
    if (emptyState === null) return null;
    return (
      <section className="space-y-3">
        <ClipReelHeader kicker={kicker} title={title} subtitle={subtitle} count={0} />
        {emptyState ?? (
          <div className="rounded-2xl border border-dashed border-[var(--border-gold)] bg-[var(--bg-surface)]/40 p-10 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              Aucun clip ne correspond pour l&apos;instant. Reviens dès le prochain match.
            </p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <ClipReelHeader kicker={kicker} title={title} subtitle={subtitle} count={clips.length} ctaHref={ctaHref} ctaLabel={ctaLabel} />
      {variant === "compact-grid" ? <CompactGrid clips={clips} /> : <CompactGrid clips={clips} />}
    </section>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────

function ClipReelHeader({
  kicker,
  title,
  subtitle,
  count,
  ctaHref,
  ctaLabel,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  count: number;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <header className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        {kicker && (
          <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
            {kicker}
          </p>
        )}
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="font-display text-2xl md:text-3xl font-black text-[var(--text-primary)]">
            {title}
          </h2>
          <span className="font-data text-xs uppercase tracking-widest text-[var(--text-muted)]">
            {count} clip{count > 1 ? "s" : ""}
          </span>
        </div>
        {subtitle && (
          <p className="mt-1 text-sm text-[var(--text-muted)] max-w-2xl">{subtitle}</p>
        )}
      </div>
      {ctaHref && ctaLabel && (
        <Link
          href={ctaHref}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-bold text-[var(--gold)] transition-colors hover:bg-[var(--gold)]/10"
        >
          {ctaLabel}
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      )}
    </header>
  );
}

// ─── Compact grid variant ───────────────────────────────────────────────

function CompactGrid({ clips }: { clips: FilteredClip[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {clips.map((c) => (
        <ClipCard key={c.id} clip={c} />
      ))}
    </div>
  );
}

function ClipCard({ clip }: { clip: FilteredClip }) {
  const isKcKill = clip.trackedTeamInvolvement === "team_killer";
  const minuteLabel = formatGameTime(clip.gameTimeSeconds);
  return (
    <Link
      href={`/kill/${clip.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-black transition-all hover:-translate-y-0.5 hover:border-[var(--gold)]/50 hover:shadow-2xl hover:shadow-[var(--gold)]/15"
      style={{ aspectRatio: "16/10" }}
    >
      {clip.thumbnailUrl ? (
        <Image
          src={clip.thumbnailUrl}
          alt={`${clip.killerChampion ?? "?"} kills ${clip.victimChampion ?? "?"}`}
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />

      {/* Top badges — KC tag + scoring */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={`rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] ${
              isKcKill
                ? "bg-[var(--gold)]/15 border border-[var(--gold)]/40 text-[var(--gold)]"
                : "bg-[var(--red)]/15 border border-[var(--red)]/40 text-[var(--red)]"
            }`}
          >
            {isKcKill ? "KC kill" : "KC death"}
          </span>
          {clip.multiKill && (
            <span className="rounded-md bg-[var(--orange)]/15 border border-[var(--orange)]/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--orange)]">
              {clip.multiKill}
            </span>
          )}
          {clip.isFirstBlood && (
            <span className="rounded-md bg-[var(--red)]/15 border border-[var(--red)]/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--red)]">
              first
            </span>
          )}
        </div>
        {clip.highlightScore != null && (
          <span className="rounded-md bg-black/60 backdrop-blur-sm border border-[var(--gold)]/30 px-2 py-0.5 text-[10px] font-data font-bold text-[var(--gold)]">
            {clip.highlightScore.toFixed(1)}
          </span>
        )}
      </div>

      {/* Bottom — matchup + meta */}
      <div className="absolute inset-x-3 bottom-3 z-10">
        <p className="font-display font-black text-white leading-tight text-sm md:text-base">
          <span className={isKcKill ? "text-[var(--gold)]" : "text-white"}>
            {clip.killerChampion ?? "?"}
          </span>
          <span className="text-[var(--gold)] mx-1.5">→</span>
          <span className={!isKcKill ? "text-[var(--gold)]" : "text-white/85"}>
            {clip.victimChampion ?? "?"}
          </span>
        </p>
        {clip.aiDescription && (
          <p className="mt-1 text-[11px] text-white/75 italic line-clamp-2">
            « {clip.aiDescription} »
          </p>
        )}
        <p className="mt-2 text-[10px] font-data uppercase tracking-wider text-white/50">
          {clip.opponentCode ? `vs ${clip.opponentCode}` : clip.matchStage ?? ""}
          {clip.gameNumber ? ` · G${clip.gameNumber}` : ""}
          {minuteLabel ? ` · T+${minuteLabel}` : ""}
        </p>
      </div>

      {/* Centred play affordance on hover */}
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      >
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--gold)]/25 backdrop-blur-md border-2 border-[var(--gold)]/70 shadow-[0_0_30px_rgba(200,170,110,0.4)]"
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
