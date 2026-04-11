import { SkeletonKillCard } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Hero banner (champion splash bg) */}
      <div className="relative -mx-4 -mt-6 h-[320px] overflow-hidden rounded-b-2xl">
        <div className="skel-hextech absolute inset-0 rounded-none" />
        <div className="absolute inset-x-0 bottom-0 p-6 space-y-3">
          <div className="skel-hextech h-3 w-24 rounded" />
          <div className="skel-hextech h-12 w-64 rounded-lg" />
          <div className="skel-hextech h-4 w-40 rounded" />
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 space-y-2">
            <div className="skel-hextech h-3 w-16 rounded" />
            <div className="skel-hextech h-8 w-20 rounded-lg" />
          </div>
        ))}
      </div>

      {/* Best kills grid */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="skel-hextech h-5 w-32 rounded" />
          <div className="h-px flex-1 bg-[var(--border-gold)]" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonKillCard key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
