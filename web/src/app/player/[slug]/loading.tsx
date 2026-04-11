export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-[280px] -mx-4 -mt-6 rounded-b-2xl bg-[var(--bg-elevated)]" />
      <div className="flex gap-4 items-end">
        <div className="h-24 w-32 rounded-xl bg-[var(--bg-surface)]" />
        <div className="grid grid-cols-4 gap-3 flex-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-[var(--bg-surface)]" />
          ))}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-[var(--bg-surface)]" />
        ))}
      </div>
    </div>
  );
}
