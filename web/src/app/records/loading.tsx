import { SkeletonKillCard } from "@/components/Skeleton";

/**
 * /records loading skeleton — Wave 20.2.
 *
 * Mirrors the page layout : breadcrumb + title + 6 category sections,
 * each with 3 top kill cards.
 */
export default function Loading() {
  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <div className="skel-hextech h-3 w-16 rounded" />
        <span className="text-[var(--gold)]/30">&#x25C6;</span>
        <div className="skel-hextech h-3 w-20 rounded" />
      </div>

      {/* Title + subtitle */}
      <div className="space-y-3">
        <div className="skel-hextech h-12 w-80 rounded-lg" />
        <div className="skel-hextech h-4 w-96 rounded" />
      </div>

      {/* 6 category sections — each with 3 cards */}
      {Array.from({ length: 6 }).map((_, sectionIdx) => (
        <section key={sectionIdx} className="space-y-4">
          {/* Category header (icon + title + "voir tout" chip) */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="skel-hextech h-7 w-7 rounded-full" />
              <div className="skel-hextech h-7 w-56 rounded" />
            </div>
            <div className="skel-hextech h-7 w-20 rounded-full" />
          </div>

          {/* Top 3 cards */}
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <SkeletonKillCard key={`${sectionIdx}-${i}`} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
