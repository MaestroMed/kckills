export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center gap-6">
        <div className="h-14 w-14 rounded-xl bg-[var(--bg-surface)]" />
        <div className="h-8 w-8 rounded bg-[var(--bg-elevated)]" />
        <div className="h-14 w-14 rounded-xl bg-[var(--bg-surface)]" />
        <div className="space-y-2 flex-1">
          <div className="h-6 w-48 rounded bg-[var(--bg-surface)]" />
          <div className="h-3 w-32 rounded bg-[var(--bg-elevated)]" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-[var(--bg-surface)]" />
        ))}
      </div>
      {[1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="h-12 bg-[var(--bg-primary)]" />
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map((j) => (
              <div key={j} className="h-12 rounded-lg bg-[var(--bg-primary)]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
