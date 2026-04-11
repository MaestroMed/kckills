export default function Loading() {
  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="skel-hextech h-[60vh] rounded-2xl" />

      {/* Roster strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skel-hextech aspect-[3/4] rounded-xl" />
        ))}
      </div>

      {/* Highlights title */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[var(--border-gold)]" />
        <div className="skel-hextech h-6 w-48 rounded-lg" />
        <div className="h-px flex-1 bg-[var(--border-gold)]" />
      </div>

      {/* Clip grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="skel-hextech aspect-video rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
