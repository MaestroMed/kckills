import { SkeletonMatchRow } from "@/components/Skeleton";

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
      <div className="skel-hextech h-10 w-72 rounded-lg" />
      <div className="skel-hextech h-4 w-56 rounded" />

      {/* Year groups */}
      {[2026, 2025, 2024].map((year) => (
        <section key={year} className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="skel-hextech h-6 w-20 rounded" />
            <div className="h-px flex-1 bg-[var(--border-gold)]" />
          </div>
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonMatchRow key={i} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
