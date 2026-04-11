export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Header: logos + score */}
      <div className="flex items-center gap-6">
        <div className="skel-hextech h-16 w-16 rounded-xl" />
        <div className="skel-hextech h-10 w-10 rounded-lg" />
        <div className="skel-hextech h-16 w-16 rounded-xl" />
        <div className="flex-1 space-y-2">
          <div className="skel-hextech h-7 w-56 rounded-lg" />
          <div className="skel-hextech h-3 w-32 rounded" />
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skel-hextech h-20 rounded-xl" />
        ))}
      </div>

      {/* Game tables */}
      {[0, 1].map((i) => (
        <div key={i} className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="skel-hextech h-12 rounded-none" />
          <div className="p-4 space-y-2">
            {[0, 1, 2, 3, 4].map((j) => (
              <div key={j} className="skel-hextech h-12 rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
