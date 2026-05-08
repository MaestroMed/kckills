import { SkeletonKillCard } from "@/components/Skeleton";

/**
 * /week loading skeleton — Wave 20.2.
 *
 * Mirrors the page : breadcrumb + title + 7-day window stats hero +
 * top 3 hero cards + grid of remaining cards.
 */
export default function Loading() {
  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <div className="skel-hextech h-3 w-16 rounded" />
        <span className="text-[var(--gold)]/30">&#x25C6;</span>
        <div className="skel-hextech h-3 w-24 rounded" />
      </div>

      {/* Title + subtitle */}
      <div className="space-y-2">
        <div className="skel-hextech h-12 w-72 rounded-lg" />
        <div className="skel-hextech h-4 w-72 rounded" />
      </div>

      {/* Stats hero — 4 metric tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/40 p-5 space-y-2"
          >
            <div className="skel-hextech h-3 w-20 rounded" />
            <div className="skel-hextech h-8 w-16 rounded" />
          </div>
        ))}
      </div>

      {/* Top 3 hero cards */}
      <section className="space-y-3">
        <div className="skel-hextech h-6 w-40 rounded" />
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <SkeletonKillCard key={`hero-${i}`} />
          ))}
        </div>
      </section>

      {/* Remaining grid — 6-9 cards */}
      <section className="space-y-3">
        <div className="skel-hextech h-6 w-44 rounded" />
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <SkeletonKillCard key={`grid-${i}`} />
          ))}
        </div>
      </section>
    </div>
  );
}
