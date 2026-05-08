import { SkeletonKillCard } from "@/components/Skeleton";

/**
 * /champion/[name] loading skeleton — Wave 20.2.
 *
 * Mirrors the page : breadcrumb + champion hero + 3 ClipReel sections
 * (top kills 9 cards, multi-kills 6 cards, victim-side 6 cards).
 */
export default function Loading() {
  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <div className="skel-hextech h-3 w-16 rounded" />
        <span className="text-[var(--gold)]/30">&#x25C6;</span>
        <div className="skel-hextech h-3 w-20 rounded" />
        <span className="text-[var(--gold)]/30">&#x25C6;</span>
        <div className="skel-hextech h-3 w-16 rounded" />
      </div>

      {/* Champion hero */}
      <header className="flex items-center gap-5 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/40 p-6">
        <div className="skel-hextech h-20 w-20 rounded-full flex-shrink-0" />
        <div className="space-y-2 flex-1 min-w-0">
          <div className="skel-hextech h-9 w-64 rounded-lg" />
          <div className="skel-hextech h-4 w-80 rounded" />
        </div>
      </header>

      {/* Top kills — 9 cards */}
      <section className="space-y-4">
        <div className="space-y-2">
          <div className="skel-hextech h-3 w-24 rounded" />
          <div className="skel-hextech h-8 w-72 rounded" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <SkeletonKillCard key={`top-${i}`} />
          ))}
        </div>
      </section>

      {/* Multi-kills — 6 cards */}
      <section className="space-y-4">
        <div className="space-y-2">
          <div className="skel-hextech h-3 w-20 rounded" />
          <div className="skel-hextech h-8 w-80 rounded" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonKillCard key={`multi-${i}`} />
          ))}
        </div>
      </section>

      {/* Victim side — 6 cards */}
      <section className="space-y-4">
        <div className="space-y-2">
          <div className="skel-hextech h-3 w-28 rounded" />
          <div className="skel-hextech h-8 w-72 rounded" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonKillCard key={`victim-${i}`} />
          ))}
        </div>
      </section>
    </div>
  );
}
