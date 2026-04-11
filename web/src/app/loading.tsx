export default function Loading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-[60vh] rounded-2xl bg-[var(--bg-surface)]" />
      <div className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-64 rounded-xl bg-[var(--bg-surface)]" />
        ))}
      </div>
    </div>
  );
}
