export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-pulse">
      <div className="h-4 w-40 rounded bg-[var(--bg-elevated)]" />
      <div className="aspect-video rounded-xl bg-[var(--bg-surface)]" />
      <div className="rounded-xl bg-[var(--bg-surface)] p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-[var(--bg-elevated)]" />
          <div className="space-y-2 flex-1">
            <div className="h-5 w-32 rounded bg-[var(--bg-elevated)]" />
            <div className="h-3 w-24 rounded bg-[var(--bg-elevated)]" />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-[var(--bg-primary)]" />
          ))}
        </div>
      </div>
    </div>
  );
}
