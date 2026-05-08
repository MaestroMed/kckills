import { SkeletonPlayerCard } from "@/components/Skeleton";

/**
 * /players loading skeleton — Wave 20.2.
 *
 * Mirrors the actual page layout : breadcrumb + title + active-roster
 * grid (5 cards) + recent-alumni grid (~5 cards) + earlier-alumni
 * grid (~10-15 cards). Hextech-themed via `skel-hextech`.
 */
export default function Loading() {
  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <div className="skel-hextech h-3 w-16 rounded" />
        <span className="text-[var(--gold)]/30">&#x25C6;</span>
        <div className="skel-hextech h-3 w-14 rounded" />
      </div>

      {/* Title + subtitle */}
      <div className="space-y-2">
        <div className="skel-hextech h-10 w-72 rounded-lg" />
        <div className="skel-hextech h-4 w-56 rounded" />
      </div>

      {/* Active roster — 5 cards */}
      <section className="space-y-4">
        <div className="skel-hextech h-6 w-40 rounded" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonPlayerCard key={`active-${i}`} />
          ))}
        </div>
      </section>

      {/* Recent alumni — 5 cards */}
      <section className="space-y-4">
        <div className="skel-hextech h-6 w-44 rounded" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonPlayerCard key={`recent-${i}`} />
          ))}
        </div>
      </section>

      {/* Earlier alumni — 8 cards */}
      <section className="space-y-4">
        <div className="skel-hextech h-6 w-32 rounded" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonPlayerCard key={`older-${i}`} />
          ))}
        </div>
      </section>
    </div>
  );
}
