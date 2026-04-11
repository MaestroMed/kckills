export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="skel-hextech h-4 w-40 rounded" />
      <div className="skel-hextech aspect-video rounded-2xl" />
      <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="skel-hextech h-14 w-14 rounded-xl" />
          <div className="space-y-2 flex-1">
            <div className="skel-hextech h-5 w-32 rounded" />
            <div className="skel-hextech h-3 w-24 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skel-hextech h-16 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
