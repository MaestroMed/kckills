import { SkeletonRankRow } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <div className="skel-hextech h-3 w-16 rounded" />
        <span className="text-[var(--gold)]/30">&#x25C6;</span>
        <div className="skel-hextech h-3 w-14 rounded" />
      </div>

      {/* Title */}
      <div className="skel-hextech h-10 w-80 rounded-lg" />
      <div className="skel-hextech h-4 w-64 rounded" />

      {/* Filters bar */}
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="skel-hextech h-9 w-24 rounded-full" />
        ))}
      </div>

      {/* Leaderboard rows */}
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonRankRow key={i} rank={i + 1} />
        ))}
      </div>
    </div>
  );
}
